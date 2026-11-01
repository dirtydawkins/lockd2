"""Versioned parsing rules. No issuer templates or trained confidence are fabricated."""
import re
from datetime import date

RULES = {
    "account_holder": r"(?:account holder|customer name|taxpayer name|tenant name|student name|name)\s*[:\-]\s*(.+)",
    "service_address": r"(?:service address|supply address|physical address|registered address|residential address|residence)\s*[:\-]\s*(.+)",
    "account_reference": r"account (?:number|no\.?|reference)\s*[:\-]\s*([A-Za-z0-9\-/]+)",
    "postal_address": r"postal address\s*[:\-]\s*(.+)",
    "meter_reference": r"meter (?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-/]+)",
    "amount_due": r"(?:amount due|total due)\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)",
    "currency": r"currency\s*[:\-]\s*([A-Z]{3})\b",
    "issue_date": r"(?:issue date|date issued|bill date)\s*[:\-]\s*(\d{4}-\d{2}-\d{2})",
    "due_date": r"(?:due date|pay by)\s*[:\-]\s*(\d{4}-\d{2}-\d{2})",
    "billing_period": r"billing period\s*[:\-]\s*(.+)",
    "document_reference": r"(?:invoice (?:number|no\.?)|bill reference|certificate (?:number|no\.?))\s*[:\-]\s*([A-Za-z0-9\-/]+)",
}


def classify(text):
    text = text.casefold()
    matches = []
    for kind, terms in {
        "electricity_bill": ("kenya power", "electricity bill"),
        "water_bill": ("water bill", "water and sewerage"),
        "tenancy": ("tenancy agreement", "lease agreement"),
        "student": ("accommodation confirmation", "hostel allocation"),
        "landlord": ("landlord confirmation",),
    }.items():
        if any(term in text for term in terms):
            matches.append(kind)
    return {"type": matches[0] if len(matches) == 1 else "uncertain", "method": "keyword_rules", "confidence": None}


def extract(lines):
    fields = {}
    for key, pattern in RULES.items():
        found = []
        for line in lines:
            match = re.search(pattern, line["text"], re.I)
            if match:
                value = match[1].strip()[:400]
                if key in ("account_reference", "meter_reference"):
                    value = "•" * max(0, len(value) - 4) + value[-4:]
                found.append({"value": value, "page": line["page"], "bbox": line["bbox"],
                              "extraction": line.get("source", "embedded_text"),
                              "ocr_confidence": line.get("confidence"), "confidence": None})
        if found:
            fields[key] = found[0]
            # Conflicting fields are retained privately for human review, never silently merged.
            if len({item["value"] for item in found}) > 1:
                fields[key]["conflicts"] = found[1:5]
    return fields


def consistency(fields, today=None):
    today = today or date.today()
    findings = []
    for key, field in fields.items():
        if field.get("conflicts"):
            findings.append({"code": "conflicting_" + key, "module": "semantic", "page": field["page"], "bbox": field["bbox"], "severity": "review"})
    dates = {}
    for key in ("issue_date", "due_date"):
        if key in fields:
            try:
                dates[key] = date.fromisoformat(fields[key]["value"])
            except ValueError:
                findings.append({"code": "unreadable_" + key, "module": "semantic", "severity": "review"})
    if "issue_date" in dates and dates["issue_date"] > today:
        findings.append({"code": "future_issue_date", "module": "semantic", "severity": "review"})
    if set(dates) == {"issue_date", "due_date"} and dates["due_date"] < dates["issue_date"]:
        findings.append({"code": "due_before_issue", "module": "semantic", "severity": "review"})
    return findings
