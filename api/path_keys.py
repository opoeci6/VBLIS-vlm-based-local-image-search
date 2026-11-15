"""Case folding for path comparisons. Windows file systems ignore case, so paths are compared
lower-cased there; on Linux and other POSIX systems they are compared as they are.
fold() must stay exactly str.lower on Windows: its result is stored in video record ids
(indexer._video_source_key), and os.path.normcase differs from it for a few characters."""
import os

FOLD_CASE = os.name == "nt"


def fold(path: str) -> str:
    return path.lower() if FOLD_CASE else path


def is_valid_name(name: str) -> bool:
    """False for a file or folder name that can't be written as UTF-8: on Linux a name whose bytes aren't
    valid UTF-8, on Windows one with unpaired UTF-16 surrogates (Python keeps both as lone surrogates).
    Such a path can't be stored in the index, the media registry or JSON, so folder walks skip it."""
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


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
