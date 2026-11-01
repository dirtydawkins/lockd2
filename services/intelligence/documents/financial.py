"""Conservative statement extraction and Decimal arithmetic, never a credit score.

Only explicit table columns are parsed. Unsupported layouts return no transactions;
there is deliberately no generative reconstruction of missing amounts or rows.
No institution's format is considered verified until a genuine authorized file is tested.
"""
import hashlib
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

VERSION = 'financial-rules-1'
CENT = Decimal('0.01')


def money(value, signed=False):
    if value is None or str(value).strip() in ('', '-', '—'):
        return None
    text = str(value).strip()
    if not re.fullmatch(r'-?(?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,2})?', text):
        raise ValueError('unreadable_amount')
    try:
        amount = Decimal(text.replace(',', ''))
    except InvalidOperation:
        raise ValueError('unreadable_amount') from None
    if not amount.is_finite() or abs(amount) > Decimal('999999999999.99') or (not signed and amount < 0):
        raise ValueError('invalid_amount')
    return amount.quantize(CENT)


def amount(value):
    return None if value is None else format(value.quantize(CENT, rounding=ROUND_HALF_UP), '.2f')


def calendar_date(value):
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%d %b %Y', '%d %B %Y'):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    raise ValueError('unreadable_date')


def metrics(transactions, start=None, end=None, opening=None, closing=None):
    """Accept normalized, source-referenced rows from a trusted parser, not a browser.

    Duplicate references are counted once only if their financial contents agree.
    Conflicts and unlinked reversals prevent an affirmative completeness assessment.
    Ordinary transfers are cash flow, never classified as earnings or salary.
    """
    if len(transactions) > 2000:
        raise ValueError('statement_complexity')
    seen, rejected, signals = {}, set(), []
    for row in transactions:
        ref = row['reference']
        signature = tuple(row.get(k) for k in ('date', 'credit', 'debit', 'balance', 'status', 'reversal_of'))
        if ref in seen:
            if seen[ref][0] != signature:
                rejected.add(ref)
                signals.append('conflicting_duplicate_reference')
            else:
                signals.append('duplicate_reference')
        else:
            seen[ref] = (signature, row)
    rows = [pair[1] for ref, pair in seen.items() if ref not in rejected]
    rows.sort(key=lambda row: (row['date'], row['order']))
    excluded = set()
    by_ref = {row['reference']: row for row in rows}
    for row in rows:
        if row.get('status') == 'reversal':
            target = by_ref.get(row.get('reversal_of'))
            if target and target['credit'] == row['debit'] and target['debit'] == row['credit']:
                excluded.update((target['reference'], row['reference']))
            else:
                signals.append('unlinked_reversal')
    cash_rows = [row for row in rows if row.get('status') == 'completed' and row['reference'] not in excluded]
    incoming = sum((row['credit'] or Decimal(0) for row in cash_rows), Decimal(0))
    outgoing = sum((row['debit'] or Decimal(0) for row in cash_rows), Decimal(0))
    monthly = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for row in cash_rows:
        monthly[row['date'][:7]][0] += row['credit'] or Decimal(0)
        monthly[row['date'][:7]][1] += row['debit'] or Decimal(0)
    # Include zero-activity months only when an explicit statement period establishes coverage.
    days = None
    if start and end:
        if start > end or (end - start).days > 1096:
            raise ValueError('invalid_statement_period')
        days = (end - start).days + 1
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            monthly[f'{year:04}-{month:02}']
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        if any(not start <= date.fromisoformat(row['date']) <= end for row in rows):
            signals.append('transaction_outside_period')
    previous = opening
    checks, mismatches = 0, 0
    for row in rows:
        if row.get('status') not in ('completed', 'reversal'):
            continue
        if row['balance'] is not None and previous is not None:
            checks += 1
            if previous + (row['credit'] or Decimal(0)) - (row['debit'] or Decimal(0)) != row['balance']:
                mismatches += 1
        previous = row['balance']
    if closing is not None and previous is not None:
        checks += 1
        if closing != previous:
            mismatches += 1
    if mismatches:
        signals.append('running_balance_mismatch')
    # A complete statement and complete extraction are different things.
    total_months = len(monthly) if days is not None else 0
    mean_in = incoming / total_months if total_months else None
    mean_out = outgoing / total_months if total_months else None
    volatility = None
    if total_months > 1 and mean_in and mean_in > 0:
        variance = sum(((values[0] - mean_in) ** 2 for values in monthly.values()), Decimal(0)) / total_months
        volatility = str((variance.sqrt() / mean_in).quantize(Decimal('0.0001')))
    return {'version': VERSION, 'total_incoming': amount(incoming), 'total_outgoing': amount(outgoing),
            'net_transaction_flow': amount(incoming - outgoing), 'average_monthly_inflows': amount(mean_in),
            'average_monthly_outflows': amount(mean_out), 'monthly': [
                {'month': month, 'inflows': amount(values[0]), 'outflows': amount(values[1])}
                for month, values in sorted(monthly.items())],
            'coverage_days': days, 'transaction_count': len(cash_rows), 'balance_checks': checks,
            'balance_mismatches': mismatches, 'inflow_volatility': volatility,
            'balance_trend': amount(closing - opening) if opening is not None and closing is not None else None,
            'signals': sorted(set(signals)), 'review_required': True, 'official_credit_score': None,
            'completeness': 'not_independently_established', 'income_classification': 'not_established'}


HEADERS = {
    'reference': ('receipt no', 'receipt number', 'transaction reference', 'reference'),
    'date': ('completion time', 'transaction date', 'date'),
    'credit': ('paid in', 'money received', 'credit', 'deposit'),
    'debit': ('withdrawn', 'money sent', 'debit', 'withdrawal'),
    'balance': ('balance', 'running balance'),
    'status': ('transaction status', 'status'),
}


def cells(text):
    return [part.strip() for part in re.split(r'\t|\|| {2,}', text.strip())]


def parse(lines, method):
    if method not in ('mpesa', 'bank'):
        raise ValueError('unsupported_financial_method')
    text = '\n'.join(line['text'] for line in lines)
    fields, rows, warnings, header = {}, [], [], None
    metadata = {
        'account_holder': r'(?:account holder|customer name|account name)\s*:\s*(.+)',
        'institution': r'(?:bank name|institution)\s*:\s*(.+)',
        'account_reference': r'(?:account number|account no\.?|mobile number|phone number)\s*:\s*([+\d *Xx-]+)',
        'statement_start': r'(?:statement start|start date|from date)\s*:\s*(.+)',
        'statement_end': r'(?:statement end|end date|to date)\s*:\s*(.+)',
        'currency': r'(?:account currency|currency)\s*:\s*([A-Z]{3})\b',
        'opening_balance': r'opening balance\s*:\s*([\d,.-]+)',
        'closing_balance': r'closing balance\s*:\s*([\d,.-]+)',
    }
    for line in lines:
        for name, pattern in metadata.items():
            match = re.search(pattern, line['text'], re.I)
            if not match:
                continue
            value = match[1].strip()[:200]
            if name == 'account_reference':
                value = '••••' + value[-4:]
            item = {'value': value, 'page': line['page'], 'bbox': line['bbox'],
                    'extraction': line.get('source', 'embedded_text'), 'confidence': None}
            if name in fields and fields[name]['value'] != value:
                warnings.append('conflicting_' + name)
            else:
                fields[name] = item
        parts = cells(line['text'])
        mapped = {name: next((i for i, part in enumerate(parts) if part.casefold().rstrip('.') in aliases), None)
                  for name, aliases in HEADERS.items()}
        if all(mapped[key] is not None for key in ('reference', 'date', 'credit', 'debit', 'balance')):
            header = mapped
            continue
        if not header:
            continue
        if not any(re.match(r'\d{4}-\d{2}-\d{2}|\d{2}[/\-]\d{2}[/\-]\d{4}', part) for part in parts):
            continue
        try:
            def cell(name):
                index = header.get(name)
                return parts[index] if index is not None else None
            raw_date = cell('date')
            day = calendar_date(raw_date[:10])
            credit, debit, balance = money(cell('credit')), money(cell('debit')), money(cell('balance'), signed=True)
            if (credit is None and debit is None) or (credit and debit):
                raise ValueError('ambiguous_transaction')
            ref = cell('reference')
            if not re.fullmatch(r'[A-Za-z0-9_/-]{3,80}', ref or ''):
                raise ValueError('missing_reference')
            status = (cell('status') or '').casefold()
            if status not in ('completed', 'successful', 'reversal', 'reversed', 'failed', 'cancelled'):
                # A bank statement row has no provider status; retain it as recorded,
                # but never infer M-Pesa transaction success from an amount alone.
                if method == 'bank' and not status:
                    status = 'completed'
                else:
                    raise ValueError('unreadable_transaction_status')
            status = 'reversal' if status in ('reversal', 'reversed') else 'completed' if status in ('completed', 'successful') else status
            rows.append({'reference': hashlib.sha256(ref.encode()).hexdigest(), 'date': day.isoformat(),
                         'credit': credit, 'debit': debit, 'balance': balance, 'status': status,
                         'order': len(rows), 'source': {'page': line['page'], 'bbox': line['bbox']}})
        except (ValueError, IndexError, TypeError):
            warnings.append('unparsed_transaction_row')
    if not header or not rows:
        warnings.append('statement_layout_not_supported')
    start = end = opening = closing = None
    try:
        start = calendar_date(fields['statement_start']['value']) if 'statement_start' in fields else None
        end = calendar_date(fields['statement_end']['value']) if 'statement_end' in fields else None
        opening = money(fields['opening_balance']['value'], signed=True) if 'opening_balance' in fields else None
        closing = money(fields['closing_balance']['value'], signed=True) if 'closing_balance' in fields else None
        summary = metrics(rows, start, end, opening, closing) if rows else None
    except ValueError:
        summary = None
        warnings.append('unreadable_statement_period_or_balance')
    if 'currency' not in fields:
        warnings.append('currency_not_extracted')
    if summary:
        summary['currency'] = fields.get('currency', {}).get('value')
        summary['signals'] = sorted(set(summary['signals'] + warnings))
        if warnings:
            summary['average_monthly_inflows'] = summary['average_monthly_outflows'] = None
    return {'method': method, 'fields': fields, 'summary': summary,
            'transactions': [{**row, 'credit': amount(row['credit']), 'debit': amount(row['debit']),
                              'balance': amount(row['balance'])} for row in rows],
            'signals': sorted(set(warnings)), 'format_verified': False,
            'review_required': True, 'parser_version': VERSION,
            'limitations': ['Only explicitly labelled columns were parsed.',
                            'Coverage and ownership require review of the original statement.',
                            'Cash flow is not disposable income or a credit score.']}


def rental_assessment(summary, obligation, currency):
    """Advisory comparison only. Caller obtains obligation from the booking database."""
    total = money(obligation)
    result = {'version': VERSION, 'decision': 'manual_review', 'booking_authorized': False,
              'credit_check_performed': False, 'automatic_rejection': False,
              'obligation': amount(total), 'currency': currency, 'obligation_to_inflows': None,
              'reasons': ['A statement is only part of a person’s financial position.']}
    if not summary or summary.get('currency') != currency or summary.get('signals'):
        result['reasons'].append('Financial evidence is incomplete or uses a different currency.')
        return result
    average = money(summary.get('average_monthly_inflows'))
    if average and average > 0 and total is not None:
        result['obligation_to_inflows'] = str((total / average).quantize(Decimal('0.0001')))
    return result
