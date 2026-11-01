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
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if '--utility-photo' in sys.argv:
        utility_photo(raw)
    output = analyze_scanned(raw)
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
