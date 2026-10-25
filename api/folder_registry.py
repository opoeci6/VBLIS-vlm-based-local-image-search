import os
import json
import pathlib
import threading
from security import is_within
from media_image import IMAGE_EXTENSIONS
from media_video import VIDEO_EXTENSIONS


class FolderRegistry:
    """Per-collection selected-folder state (persisted in indexed_folders.json) and the folder views
    built on it. Every method takes the collection (or its name) explicitly."""

    def __init__(self, data_dir, cache_dir):
        self.data_dir = pathlib.Path(data_dir)
        self.cache_dir = pathlib.Path(cache_dir)
        self.selected_folders_by_collection = {}
        self._roots_synced_collections = set()
        self._roots_sync_lock = threading.Lock()
        self._load()

    def _load(self):
        config_path = self.data_dir / "indexed_folders.json"
        legacy_path = self.cache_dir / "indexed_folders.json"
        target_path = config_path if config_path.exists() else (legacy_path if legacy_path.exists() else None)
        
        if target_path:
            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.selected_folders_by_collection = {
                            k: set(v) for k, v in data.items() if isinstance(v, list)
                        }
                if target_path == legacy_path:
                    self.save()
                    try:
                        legacy_path.unlink()
                    except Exception:
                        pass
            except Exception as e:
                print(f"[Warning] Failed to load indexed_folders.json: {e}")

    def save(self):
        config_path = self.data_dir / "indexed_folders.json"
        try:
            data = {
                k: sorted(list(v)) for k, v in self.selected_folders_by_collection.items()
            }
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Warning] Failed to save indexed_folders.json: {e}")

    def selected(self, collection_name):
        return self.selected_folders_by_collection.setdefault(collection_name, set())

    def add(self, collection_name, folder_path: str):
        norm_new = os.path.abspath(os.path.normpath(folder_path))
        norm_new_lower = norm_new.lower()
        existing = self.selected(collection_name)

        for ex in list(existing):
            ex_lower = os.path.abspath(os.path.normpath(ex)).lower()
            if norm_new_lower == ex_lower or norm_new_lower.startswith(ex_lower + os.sep):
                return
            if ex_lower.startswith(norm_new_lower + os.sep):
                existing.discard(ex)

        existing.add(norm_new)
        self.save()

    def remove(self, collection_name, folder_path: str):
        norm_target = os.path.abspath(os.path.normpath(folder_path)).lower()
        existing = self.selected(collection_name)
        to_remove = {
            ex for ex in existing
            if os.path.abspath(os.path.normpath(ex)).lower() == norm_target
            or os.path.abspath(os.path.normpath(ex)).lower().startswith(norm_target + os.sep)
        }
        for r in to_remove:
            existing.discard(r)
        self.save()

    def forget(self, collection_name):
        """Drop the selected folders of a cleared or deleted collection."""
        self.selected_folders_by_collection.pop(collection_name, None)
        self.save()

    def is_path_allowed(self, path: str, active_collection) -> bool:
        """True when path lies in a folder indexed under any collection (used to restrict file-serving endpoints)."""
        def check():
            roots = [r for folders in list(self.selected_folders_by_collection.values()) for r in list(folders)]
            return is_within(path, roots)

        if check():
            return True
        # Older indexes can hold records whose folders were never written to indexed_folders.json
        # (only get_indexed_folders back-fills them), so do that once per collection on a miss.
        # Concurrent misses (a grid of thumbnails) wait for that back-fill instead of failing early.
        collection = active_collection
        if collection is None:
            return False
        with self._roots_sync_lock:
            if collection.name in self._roots_synced_collections:
                return check()
            # A failed back-fill is not remembered, so the next miss retries it
            if self._record_unlisted_record_folders(collection):
                self._roots_synced_collections.add(collection.name)
        return check()

    def _record_unlisted_record_folders(self, collection) -> bool:
        """Add the topmost folders of records outside every selected folder to the selected folders.
        Works on the given collection (which a model switch may no longer make the active one). Returns
        False if it failed."""
        try:
            results = collection.get(include=["metadatas"])
            selected_folders = self.selected_folders_by_collection.setdefault(collection.name, set())
            roots = list(selected_folders)
            unlisted_parents = set()
            for meta in (results or {}).get("metadatas") or []:
                if meta and "path" in meta:
                    p = os.path.abspath(os.path.normpath(meta["path"]))
                    if not is_within(p, roots):
                        unlisted_parents.add(os.path.dirname(p))
            added = False
            kept = []
            for parent in sorted(unlisted_parents, key=lambda x: len(x)):
                if not any(parent.lower().startswith(top.lower() + os.sep) for top in kept):
                    kept.append(parent)
                    selected_folders.add(parent)
                    added = True
            if added:
                self.save()
            return True
        except Exception as e:
            print(f"[Warning] Failed to record folders of unlisted index records: {e}")
            return False

    def build_tree(self, collection):
        """Get a list of unique parent directories and their subfolders currently indexed with existence status and item counts."""
        try:
            results = collection.get(include=["metadatas"])
            if not results or not results.get("metadatas"):
                return []

            seen_db_keys = set()
            db_items = []
            for meta in results["metadatas"]:
                if meta and "path" in meta:
                    p = os.path.abspath(os.path.normpath(meta["path"]))
                    m_type = meta.get("media_type", "image")
                    key = (p.lower(), m_type)
                    if key not in seen_db_keys:
                        seen_db_keys.add(key)
                        db_items.append({"path": p, "media_type": m_type})

            if not db_items:
                return []

            db_paths = [item["path"] for item in db_items]

            # 1. Start with persisted selected folders for this collection
            selected_folders = self.selected(collection.name)
            selected_before = set(selected_folders)
            active_folders = set()

            for sf in list(selected_folders):
                sf_norm = os.path.abspath(os.path.normpath(sf))
                sf_lower = sf_norm.lower()
                has_items = any(p.lower() == sf_lower or p.lower().startswith(sf_lower + os.sep) for p in db_paths)
                if has_items:
                    active_folders.add(sf_norm)
                elif not os.path.isdir(sf_norm):
                    # Keep a selected folder that exists but has no records yet (its index task just
                    # started), or /image would 403 its files until the first batch lands
                    selected_folders.discard(sf)

            # 2. For any db_paths not covered by active selected folders, find their topmost common roots
            covered_paths = set()
            for sf in active_folders:
                sf_lower = sf.lower()
                for p in db_paths:
                    if p.lower() == sf_lower or p.lower().startswith(sf_lower + os.sep):
                        covered_paths.add(p)

            uncovered_paths = [p for p in db_paths if p not in covered_paths]
            if uncovered_paths:
                uncovered_parents = set(os.path.dirname(p) for p in uncovered_paths)
                sorted_parents = sorted(uncovered_parents, key=lambda x: len(x))
                topmost_parents = set()
                for parent in sorted_parents:
                    parent_lower = parent.lower()
                    if not any(parent_lower.startswith(top.lower() + os.sep) for top in topmost_parents):
                        topmost_parents.add(parent)

                for parent in topmost_parents:
                    active_folders.add(parent)
                    selected_folders.add(parent)

            # 3. Collapse any nested subfolders (parent folder takes precedence as root)
            final_root_folders = set()
            sorted_active = sorted(active_folders, key=lambda x: len(x))
            for f in sorted_active:
                f_lower = f.lower()
                if not any(f_lower.startswith(top.lower() + os.sep) for top in final_root_folders):
                    final_root_folders.add(f)

            # This runs on every poll, so only rewrite indexed_folders.json when the selection changed
            if selected_folders != selected_before:
                self.save()

            # 4. Build hierarchical tree with subfolders and file counts for each root folder
            output = []
            for root_path in sorted(final_root_folders, key=lambda x: x.lower()):
                root_lower = root_path.lower()
                root_items = [
                    it for it in db_items
                    if it["path"].lower() == root_lower or it["path"].lower().startswith(root_lower + os.sep)
                ]

                # Scan disk file counts for this root folder tree
                disk_counts_by_dir = {}
                if os.path.isdir(root_path):
                    try:
                        for r, _, f_list in os.walk(root_path):
                            r_norm = os.path.abspath(os.path.normpath(r))
                            r_lower_dir = r_norm.lower()
                            imgs = 0
                            vids = 0
                            for fname in f_list:
                                ext = os.path.splitext(fname)[1].lower()
                                if ext in IMAGE_EXTENSIONS:
                                    imgs += 1
                                elif ext in VIDEO_EXTENSIONS:
                                    vids += 1
                            if imgs > 0 or vids > 0:
                                disk_counts_by_dir[r_lower_dir] = {"images": imgs, "videos": vids}
                    except Exception:
                        pass

                subfolder_data = {}
                direct_images = 0
                direct_videos = 0

                for it in root_items:
                    file_dir = os.path.dirname(it["path"])
                    is_img = it["media_type"] != "video"

                    if file_dir.lower() == root_lower:
                        if is_img:
                            direct_images += 1
                        else:
                            direct_videos += 1
                    else:
                        if file_dir not in subfolder_data:
                            subfolder_data[file_dir] = {"images": 0, "videos": 0}
                        if is_img:
                            subfolder_data[file_dir]["images"] += 1
                        else:
                            subfolder_data[file_dir]["videos"] += 1

                subfolders_list = []
                for sub_dir, counts in subfolder_data.items():
                    rel = os.path.relpath(sub_dir, root_path)
                    depth = len(rel.split(os.sep))
                    sub_norm = os.path.abspath(os.path.normpath(sub_dir))
                    sub_lower = sub_norm.lower()

                    direct_disk_imgs = disk_counts_by_dir.get(sub_lower, {}).get("images", counts["images"])
                    direct_disk_vids = disk_counts_by_dir.get(sub_lower, {}).get("videos", counts["videos"])
                    sub_disk_imgs = sum(
                        c["images"] for d, c in disk_counts_by_dir.items()
                        if d == sub_lower or d.startswith(sub_lower + os.sep)
                    )
                    sub_disk_vids = sum(
                        c["videos"] for d, c in disk_counts_by_dir.items()
                        if d == sub_lower or d.startswith(sub_lower + os.sep)
                    )

                    subfolders_list.append({
                        "path": sub_dir,
                        "name": os.path.basename(sub_dir) or sub_dir,
                        "relative_path": rel,
                        "depth": depth,
                        "exists": os.path.isdir(sub_dir),
                        "image_count": counts["images"],
                        "video_count": counts["videos"],
                        "item_count": counts["images"] + counts["videos"],
                        "disk_image_count": max(counts["images"], sub_disk_imgs),
                        "disk_video_count": max(counts["videos"], sub_disk_vids),
                        "direct_disk_image_count": max(counts["images"], direct_disk_imgs),
                        "direct_disk_video_count": max(counts["videos"], direct_disk_vids)
                    })

                subfolders_list.sort(key=lambda s: s["relative_path"].lower())

                total_images = direct_images + sum(s["image_count"] for s in subfolders_list)
                total_videos = direct_videos + sum(s["video_count"] for s in subfolders_list)
                root_disk_imgs = sum(c["images"] for c in disk_counts_by_dir.values())
                root_disk_vids = sum(c["videos"] for c in disk_counts_by_dir.values())

                output.append({
                    "path": root_path,
                    "name": os.path.basename(root_path) or root_path,
                    "exists": os.path.isdir(root_path),
                    "direct_image_count": direct_images,
                    "direct_video_count": direct_videos,
                    "image_count": total_images,
                    "video_count": total_videos,
                    "item_count": total_images + total_videos,
                    "total_disk_image_count": max(total_images, root_disk_imgs),
                    "total_disk_video_count": max(total_videos, root_disk_vids),
                    "subfolder_count": len(subfolders_list),
                    "subfolders": subfolders_list
                })

            return output
        except Exception as e:
            print(f"Error getting indexed folders: {e}")
            return []

    def folder_contents(self, collection, folder_path: str, limit: int = 50000):
        """List supported media in a folder with indexing status and ghost record detection."""
        if not os.path.isdir(folder_path):
            raise ValueError("Folder does not exist or is not accessible.")

        normalized_folder = os.path.abspath(os.path.normpath(folder_path))
        norm_folder_lower = normalized_folder.lower()

        # 1. Fetch all indexed paths for this folder from ChromaDB
        indexed_map = {} # path_lower -> {"path": meta_path, "media_type": meta_type}
        if collection is not None:
            try:
                res = collection.get(include=["metadatas"])
                if res and res.get("metadatas"):
                    for meta in res["metadatas"]:
                        if meta and "path" in meta:
                            raw_p = meta["path"]
                            p_norm = os.path.abspath(os.path.normpath(raw_p))
                            p_lower = p_norm.lower()
                            if p_lower == norm_folder_lower or p_lower.startswith(norm_folder_lower + os.sep):
                                if p_lower not in indexed_map:
                                    indexed_map[p_lower] = {
                                        "path": p_norm,
                                        "media_type": meta.get("media_type", "image")
                                    }
            except Exception as e:
                print(f"[Warning] Error querying ChromaDB metadata in get_folder_contents: {e}")

        items = []
        image_count = 0
        video_count = 0
        seen_disk_paths = set()

        # 2. Scan physical files on disk
        for root, _, files in os.walk(normalized_folder):
            for file in files:
                extension = os.path.splitext(file)[1].lower()
                if extension not in IMAGE_EXTENSIONS and extension not in VIDEO_EXTENSIONS:
                    continue

                file_path = os.path.join(root, file)
                p_norm = os.path.abspath(os.path.normpath(file_path))
                p_lower = p_norm.lower()
                seen_disk_paths.add(p_lower)

                media_type = "image" if extension in IMAGE_EXTENSIONS else "video"

                try:
                    stat = os.stat(file_path)
                except OSError:
                    continue

                if media_type == "image":
                    image_count += 1
                else:
                    video_count += 1

                is_indexed = p_lower in indexed_map

                items.append({
                    "name": file,
                    "path": file_path,
                    "relative_path": os.path.relpath(file_path, normalized_folder),
                    "media_type": media_type,
                    "extension": extension,
                    "size": stat.st_size,
                    "modified_at": stat.st_mtime,
                    "is_indexed": is_indexed,
                    "exists_on_disk": True
                })

        # 3. Detect ghost records (in vector DB, but no longer on disk)
        missing_on_disk_items = []
        for p_lower, info in indexed_map.items():
            if p_lower not in seen_disk_paths:
                ghost_path = info["path"]
                ghost_name = os.path.basename(ghost_path) or ghost_path
                ghost_ext = os.path.splitext(ghost_path)[1].lower()
                ghost_media = info.get("media_type", "image")
                missing_on_disk_items.append({
                    "name": ghost_name,
                    "path": ghost_path,
                    "relative_path": os.path.relpath(ghost_path, normalized_folder),
                    "media_type": ghost_media,
                    "extension": ghost_ext,
                    "size": 0,
                    "modified_at": 0,
                    "is_indexed": True,
                    "exists_on_disk": False
                })

        all_items = items + missing_on_disk_items
        all_items.sort(key=lambda item: item["relative_path"].lower())

        indexed_count = sum(1 for it in all_items if it.get("is_indexed"))
        unindexed_count = sum(1 for it in all_items if not it.get("is_indexed") and it.get("exists_on_disk"))
        missing_on_disk_count = len(missing_on_disk_items)
        truncated = len(all_items) > limit

        return {
            "folder_path": normalized_folder,
            "items": all_items[:limit],
            "image_count": image_count,
            "video_count": video_count,
            "total_count": len(all_items),
            "indexed_count": indexed_count,
            "unindexed_count": unindexed_count,
            "missing_on_disk_count": missing_on_disk_count,
            "truncated": truncated,
            "limit": limit
        }
