"""One-shot, isolated analysis; stdin bytes, stdout bounded JSON, no network calls."""
import json
import os
import sys

if os.name == "posix":
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (18, 18))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024,) * 2)

from .analyze import analyze_scanned
from .safety import MAX_BYTES, UnsafeDocument, utility_photo

try:
    raw = sys.stdin.buffer.read(MAX_BYTES + 1029)
    method = next((value.split('=', 1)[1] for value in sys.argv if value.startswith('--method=')), None)
    # The optional PDF password travels only through the inherited private pipe,
    # never argv/environment/queue/storage/logs. No password means normal durable processing.
    password = None
    if '--password-pipe' in sys.argv:
        import struct
        if len(raw) < 4:
            raise UnsafeDocument('invalid_envelope')
        length = struct.unpack('!I', raw[:4])[0]
        if length > 1024 or len(raw) < 4 + length:
            raise UnsafeDocument('invalid_envelope')
        password = raw[4:4 + length].decode('utf-8')
        raw = raw[4 + length:]
    if '--utility-photo' in sys.argv:
        utility_photo(raw)
    output = analyze_scanned(raw, method=method, password=password)
    password = None
    encoded = json.dumps(output)
    if len(encoded.encode()) > 250000:
        raise UnsafeDocument("analysis_complexity")
    print(encoded)
except UnsafeDocument as error:
    print(json.dumps({"error_code": str(error)}))
    sys.exit(2)
except Exception:
    print('{"error_code":"analysis_unavailable"}')
    sys.exit(3)
