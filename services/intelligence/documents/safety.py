"""Bound ingress and scan before document parsers. No cloud scanner or raw-data logs."""
import hashlib
import os
import socket
import struct

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_PAGES = 5


class UnsafeDocument(ValueError):
    pass


class ScannerUnavailable(RuntimeError):
    pass


def identify(data):
    if not isinstance(data, bytes) or not 16 <= len(data) <= MAX_BYTES:
        raise UnsafeDocument("file_size")
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise UnsafeDocument("unsupported_signature")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def scan(data):
    """Official ClamD INSTREAM protocol on a local Unix socket; missing scanner fails closed.

    No unencrypted network scanner endpoints; never send client-provided filesystem paths.
    A clean response is malware screening, not an authenticity result.
    """
    identify(data)
    path = os.getenv("DOCUMENT_CLAMD_SOCKET", "")
    if not path.startswith("/") or not hasattr(socket, "AF_UNIX"):
        raise ScannerUnavailable("scanner_unavailable")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(5)
            connection.connect(path)
            connection.sendall(b"zINSTREAM\0")
            for pos in range(0, len(data), 65536):
                chunk = data[pos:pos + 65536]
                connection.sendall(struct.pack("!I", len(chunk)) + chunk)
            connection.sendall(b"\0\0\0\0")
            result = bytearray()
            while len(result) <= 1024 and not result.endswith(b"\0"):
                chunk = connection.recv(1025 - len(result))
                if not chunk:
                    break
                result.extend(chunk)
        if bytes(result) != b"stream: OK\0":
            if b" FOUND\0" in result:
                raise UnsafeDocument("malware_detected")
            raise ScannerUnavailable("scanner_invalid_response")
    except UnsafeDocument:
        raise
    except (OSError, ValueError):
        raise ScannerUnavailable("scanner_unavailable") from None
    return {"engine": "clamd", "status": "clean", "sha256": digest(data)}
