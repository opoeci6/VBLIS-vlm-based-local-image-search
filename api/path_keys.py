"""Case folding for path comparisons. Windows file systems ignore case, so paths are compared
lower-cased there; on Linux and other POSIX systems they are compared as they are.
fold() must stay exactly str.lower on Windows: its result is stored in video record ids
(indexer._video_source_key), and os.path.normcase differs from it for a few characters."""
import os

FOLD_CASE = os.name == "nt"


def fold(path: str) -> str:
    return path.lower() if FOLD_CASE else path


_REPARSE_POINT = 0x400  # stat.FILE_ATTRIBUTE_REPARSE_POINT


def is_link(path: str) -> bool:
    """A symbolic link, or on Windows also a junction (any reparse point). Unreadable counts as one."""
    try:
        info = os.lstat(path)
    except OSError:
        return True
    if os.path.islink(path):
        return True
    return bool(getattr(info, "st_file_attributes", 0) & _REPARSE_POINT)
