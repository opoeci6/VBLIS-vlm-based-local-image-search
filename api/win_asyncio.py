"""Windows only: when a browser resets a connection, Python's proactor transport (3.11) lets the
shutdown() in its cleanup raise ConnectionResetError. That prints "Exception in callback
_ProactorBasePipeTransport._call_connection_lost" and skips the rest of the cleanup: the socket stays
open until garbage collection and the server's connection count isn't lowered. Browsers reset
connections all the time; a video player drops its range requests while it buffers or seeks.

install() wraps the method so a failed shutdown() is ignored and the cleanup finishes."""
import sys


def finish_after_reset(original):
    """`original` (the transport's _call_connection_lost), finishing its cleanup when shutdown() fails."""

    def _call_connection_lost(self, exc):
        try:
            original(self, exc)
        except OSError as error:
            if self._sock is None:
                raise  # not from shutdown(): the original finished its cleanup before this
            # What the original's `finally` skipped after shutdown() raised
            self._sock.close()
            self._sock = None
            server = self._server
            if server is not None:
                server._detach()
                self._server = None
            self._called_connection_lost = True
            # An error from the protocol itself, which the failed shutdown() replaced, still counts
            if error.__context__ is not None:
                raise error.__context__ from None

    _call_connection_lost.vblis_original = original
    return _call_connection_lost


def install() -> bool:
    """Wrap the proactor transport's cleanup, once. True when it is in place (always False off Windows)."""
    if sys.platform != "win32":
        return False
    from asyncio import proactor_events

    transport = proactor_events._ProactorBasePipeTransport
    current = getattr(transport, "_call_connection_lost", None)
    if current is None:
        return False
    if getattr(current, "vblis_original", None) is None:
        transport._call_connection_lost = finish_after_reset(current)
    return True
