"""Cautious same-case comparisons. No identity assertion, score or rejection."""
import re
import unicodedata

from .address import compare as compare_address


def name_tokens(value):
    if not isinstance(value, str) or len(value) > 400:
        return []
    normalized = unicodedata.normalize('NFKC', value).casefold()
    return re.findall(r'[^\W\d_]+', normalized, re.UNICODE)[:12]


def compare_names(first, second):
    a, b = name_tokens(first), name_tokens(second)
    if not a or not b or sum(len(t) > 1 for t in a) < 2 or sum(len(t) > 1 for t in b) < 2:
        return 'insufficient_information'
    if sorted(a) == sorted(b):
        return 'normalized_text_agrees'
    shared = {t for t in a if len(t) > 1} & {t for t in b if len(t) > 1}
    # Initials and extra surnames are reviewable variations, never a fraud verdict.
    if shared or any(len(x) == 1 and any(y.startswith(x) for y in b) for x in a):
        return 'name_variation_for_review'
    return 'different_text_for_review'


def comparisons(document_id, fields, context):
    result = []
    for other in context[:5] if isinstance(context, list) else []:
        previous = other.get('fields')
        if not isinstance(previous, dict):
            continue
        for field in ('account_holder', 'service_address'):
            first, second = fields.get(field), previous.get(field)
            if not isinstance(first, dict) or not isinstance(second, dict):
                continue
            a, b = first.get('value'), second.get('value')
            if not isinstance(a, str) or not isinstance(b, str):
                continue
            state = compare_names(a, b) if field == 'account_holder' else compare_address(a, b)['status']
            result.append({'field': field, 'document_id': document_id, 'other_document_id': other['document_id'],
                           'state': state, 'review_required': True})
    return {'version': 'comparison-rules-1', 'comparisons': result,
            'identity_provider_compared': False, 'account_numbers_compared': False,
            'automatic_rejection': False, 'booking_authorized': False,
            'limitations': ['Text agreement does not establish identity or residence.',
                            'Spelling, initials, family names and shared household evidence need human review.',
                            'No independently verified Persona identity attributes are available to this comparison.']}
