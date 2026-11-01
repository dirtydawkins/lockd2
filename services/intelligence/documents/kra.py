"""Provider boundary intentionally refuses live checks until an approved contract exists."""
import re


def validate_pin(pin):
    if not isinstance(pin, str) or not re.fullmatch(r"[A-Z][0-9]{9}[A-Z]", pin.strip().upper()):
        raise ValueError("Invalid PIN format")
    value = pin.strip().upper()
    return {"format_valid": True, "masked_reference": value[:1] + "•" * 7 + value[-3:]}


def check(pin, consent=False):
    if consent is not True:
        raise ValueError("Consent required")
    result = validate_pin(pin)
    # Do not infer endpoints, response fields, taxpayer identity or residence.
    return {**result, "status": "kra_provider_unavailable", "pin_verified": False,
            "address_verified": False, "reason": "Approved GavaConnect API contract and credentials are required."}
