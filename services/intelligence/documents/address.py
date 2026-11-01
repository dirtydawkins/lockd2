"""Conservative, explainable address comparison; no geolocation inference."""
import re
import unicodedata
from difflib import SequenceMatcher

FIELDS = ("county", "sub_county", "town", "neighbourhood", "road", "building", "unit", "plot", "landmark")
ALIASES = {"rd": "road", "st": "street", "apt": "apartment", "est": "estate", "ave": "avenue"}


def normalize(value):
    if not isinstance(value, str) or len(value) > 1000:
        raise ValueError("Invalid address")
    value = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(ALIASES.get(t, t) for t in re.findall(r"[\w]+", value))


def residential(value):
    # Postal components never count as evidence of physical residence.
    value = re.sub(r"(?i)\bp\s*\.?\s*o\s*\.?\s*box\s*[\d\s-]+", " ", value)
    return normalize(value)


def compare(declared, extracted):
    a, b = residential(declared), residential(extracted)
    if min(len(a), len(b)) < 5 or min(len(a.split()), len(b.split())) < 2:
        return {"status": "insufficient_information", "reason": "More physical address detail is needed."}
    if a == b:
        return {"status": "exact_match", "reason": "Normalized physical address text agrees."}
    numeric_a, numeric_b = set(re.findall(r"\b\d+\b", a)), set(re.findall(r"\b\d+\b", b))
    if numeric_a and numeric_b and numeric_a != numeric_b:
        return {"status": "partial_match", "reason": "Building, plot or unit numbers differ; review needed."}
    ratio = SequenceMatcher(None, a, b).ratio()
    overlap = len(set(a.split()) & set(b.split())) / min(len(set(a.split())), len(set(b.split())))
    status = "strong_match" if ratio >= .88 and overlap >= .5 else "partial_match" if ratio >= .55 or overlap >= .5 else "mismatch"
    return {"status": status, "reason": "Text similarity is supporting evidence only; it does not establish residence."}
