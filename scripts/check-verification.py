"""Read-only verification checks. No sample statements, mocked providers or database writes."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services/intelligence'))
from documents.financial import money, amount, parse, rental_assessment
from documents.safety import identify, UnsafeDocument
from documents.fields import classify
from decimal import Decimal
from documents.comparison import comparisons, compare_names, name_tokens
from documents.jobs import isolated

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

def comparison_boundaries():
    result = comparisons(None, {}, [])
    assert result['comparisons'] == [] and result['identity_provider_compared'] is False
    assert result['automatic_rejection'] is False and result['booking_authorized'] is False
    assert result['account_numbers_compared'] is False
    assert compare_names('', '') == 'insufficient_information'
    assert compare_names('L.', 'L.') == 'insufficient_information'
    assert name_tokens(None) == [] and name_tokens('x' * 401) == []
check('Missing names, initials and unrelated account numbers cannot become identity decisions', comparison_boundaries)

def password_boundaries():
    sql = (root / 'supabase/migrations/20261102_0025_lockd_statement_unlock.sql').read_text(encoding='utf-8')
    for term in ('user_id=auth.uid()', 'unlock_attempts>=5', 'lease_until>now()', 'lockd_require_verification_sandbox', "purpose='processing'", 'p_lease', '30 seconds'):
        assert term in sql, term
    assert 'p_password' not in sql
    api = (root / 'lib/statement-unlock.js').read_text(encoding='utf-8')
    assert 'claim_lockd_statement_unlock' in api and "'/auth/v1/user'" in api
    assert "body.password=''" in api and 'console.' not in api
    jobs = (root / 'services/intelligence/documents/jobs.py').read_text(encoding='utf-8')
    assert "flags.append('--password-pipe')" in jobs and "str(failure) == 'encrypted_pdf'" in jobs
    ui = (root / 'verification-workflow.mjs').read_text(encoding='utf-8')
    assert "password.value=''" in ui and "type:'password'" in ui
    assert "node('pre',JSON.stringify" not in ui
check('Statement unlock uses owner-scoped leases and an ephemeral password pipe without raw review JSON', password_boundaries)

def isolated_boundary():
    # The actual source file is invalid evidence; no financial document is invented.
    try:
        isolated(Path(__file__).read_bytes(), method='bank')
    except UnsafeDocument:
        return
    raise AssertionError('Isolated parser did not preserve document rejection')
check('Actual isolated worker preserves a rejected file instead of masking it as an outage', isolated_boundary)
print(f'{count} verification checks passed; genuine financial documents and provider credentials are still required for integration tests.')
