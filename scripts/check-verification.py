"""Read-only verification checks. No sample statements, mocked providers or database writes."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services/intelligence'))
from documents.financial import money, amount, parse, rental_assessment
from documents.safety import identify, UnsafeDocument
from documents.fields import classify
from decimal import Decimal

count = 0
def check(name, run):
    global count
    run()
    count += 1
    print('PASS ' + name)

def arithmetic():
    assert amount(money('1,000.01') + money('0.09')) == '1000.10'
    assert money(None) is None
    for value in ('NaN', 'Infinity', '1e9', '1,00', '-1', '9999999999999', '1.001'):
        try:
            money(value)
        except ValueError:
            continue
        raise AssertionError('Unsafe amount accepted')
check('Money uses exact Decimal arithmetic and rejects ambiguous amounts', arithmetic)

def absent_evidence():
    for method in ('mpesa', 'bank'):
        result = parse([], method)
        assert result['summary'] is None and result['transactions'] == []
        assert 'statement_layout_not_supported' in result['signals']
    result = rental_assessment(None, None, 'KES')
    assert result['booking_authorized'] is False and result['automatic_rejection'] is False
    assert result['obligation_to_inflows'] is None
check('Missing evidence cannot become transactions, approval or a credit score', absent_evidence)

def unsupported_file():
    try:
        identify(Path(__file__).read_bytes())
    except UnsafeDocument:
        return
    raise AssertionError('Source code accepted as evidence')
check('The actual source file is rejected as an unsupported document', unsupported_file)

def architecture():
    sql = (root / 'supabase/migrations/20261102_0023_lockd_verification_orchestration.sql').read_text(encoding='utf-8')
    for token in ["check(environment='sandbox')", 'customer_id=auth.uid()', "purpose='credit'", 'policy_approved_at is not null',
                  'lockd_verification_sandbox_members', 'p_version', 'a different reviewer is required.',
                  'enable row level security', 'num_nonnulls(case_id,verification_case_id)=1']:
        assert token.casefold() in sql.casefold(), token
    assert 'insert into public.lockd_verification_passport' not in sql.casefold()
    assert 'update public.lockd_bookings' not in sql.casefold()
    assert 'create table public.lockd_document_jobs' not in sql.casefold()
    assert "https://sandbox.peleza.com" in (root / 'services/intelligence/peleza.py').read_text(encoding='utf-8')
    assert "https://api.peleza.com" not in (root / 'services/intelligence/peleza.py').read_text(encoding='utf-8')
check('Sandbox checks reuse the queue and cannot write production booking/passport decisions', architecture)

def kra_removed():
    assert not (root / 'services/intelligence/documents/kra.py').exists()
    for file in ['api/documents.js', 'verification.html', 'verification.mjs', 'services/intelligence/documents/fields.py']:
        assert 'kra_certificate' not in (root / file).read_text(encoding='utf-8')
check('KRA is absent from active intake, UI and classification', kra_removed)
print(f'{count} verification checks passed; genuine financial documents and provider credentials are still required for integration tests.')
