"""Exit when the launching process (Electron) goes away."""
import os
import sys
import threading


def _exit_when_stdin_closes():
    # Electron keeps our stdin pipe open; EOF means it exited, even by crashing. Don't linger on
    # port 8000 with a token no new window knows (os._exit: the same as being killed, as on quit).
    # os.read, not sys.stdin.buffer.read: a thread blocked inside the BufferedReader holds its
    # lock, and Python 3.11 then dies with a fatal error if the main thread exits meanwhile.
    try:
        fd = sys.stdin.fileno()
        while os.read(fd, 65536):
            pass
    except Exception:
        pass
    os._exit(0)


def start():
    if os.environ.get("VBLIS_EXIT_WITH_PARENT") == "1" and sys.stdin is not None:
        threading.Thread(target=_exit_when_stdin_closes, name="parent-watch", daemon=True).start()
