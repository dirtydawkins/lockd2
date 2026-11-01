"""Textual issuer registry, not a claim of an official verification API."""
PROVIDERS = ({'id': 'kenya_power', 'name': 'Kenya Power', 'type': 'electricity',
              'terms': ('kenya power', 'kplc'), 'independent_verification': False},)


def classify_provider(text):
    text = text.casefold()
    matches = [item for item in PROVIDERS if any(term in text for term in item['terms'])]
    if len(matches) != 1:
        return {'id': None, 'name': None, 'type': None, 'independent_verification': False}
    return {key: value for key, value in matches[0].items() if key != 'terms'}
