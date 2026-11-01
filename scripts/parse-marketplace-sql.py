"""Parse actual migration source; no database connection, claims or business fixtures."""
from pathlib import Path
from pglast import parse_sql
for path in sorted((Path(__file__).resolve().parents[1] / 'supabase/migrations').glob('*.sql')):
    parsed = parse_sql(path.read_text(encoding='utf-8-sig'))
    print(f'PARSED {path.name}: {len(parsed)} statements')
