"""Controlled synthetic fixtures. None are real bills, issuer confirmations or ML evaluation."""
import io
import os
import unittest
from unittest.mock import patch
from datetime import date
import pymupdf
from PIL import Image
from documents.address import compare
from documents.fields import classify, extract, consistency
from documents.safety import identify, scan, UnsafeDocument, ScannerUnavailable, MAX_BYTES
from documents.analyze import analyze_scanned
from documents.jobs import process_one, isolated
from persona import IntegrationUnavailable


def pdf(text=None, pages=1):
    with pymupdf.open() as doc:
        for _ in range(pages):
            page = doc.new_page()
            if text:
                page.insert_text((50, 50), text)
        return doc.tobytes()


class AddressTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(compare("Juja, Kiambu Rd", "JUJA KIAMBU ROAD")["status"], "exact_match")

    def test_postal_not_residential(self):
        self.assertEqual(compare("P.O. Box 123-00100", "P O Box 123-00100")["status"], "insufficient_information")

    def test_fuzzy_spelling(self):
        self.assertEqual(compare("Ruiru Membley Estate", "Ruiru Membley Est.")["status"], "exact_match")
        self.assertIn(compare("Ruiru Membley Estate", "Ruiru Membly Estate")["status"], ["strong_match", "partial_match"])

    def test_unit_difference_never_exact(self):
        self.assertEqual(compare("Juja house 12", "Juja house 21")["status"], "partial_match")

    def test_different_locations(self):
        self.assertEqual(compare("Kisumu Milimani", "Mombasa Nyali")["status"], "mismatch")

    def test_missing_bill_not_fraud(self):
        self.assertEqual(compare("University hostel", "")["status"], "insufficient_information")


class DocumentTests(unittest.TestCase):
    def test_signature_not_filename(self):
        with self.assertRaises(UnsafeDocument):
            identify(b"<script>not a bill.pdf</script>")
        with self.assertRaises(UnsafeDocument):
            identify(b"%PDF-" + b"a" * MAX_BYTES)

    def test_scanner_absence_fails_closed(self):
        with patch.dict(os.environ, {"DOCUMENT_CLAMD_SOCKET": ""}):
            with self.assertRaises(ScannerUnavailable):
                scan(pdf())

    def test_readable_utility_fields_and_sources(self):
        data = pdf("Kenya Power\nAccount holder: SYNTHETIC TEST ONLY\nService address: Juja Kiambu Road\nAccount number: 1234567890\nIssue date: 2026-10-15\nDue date: 2026-11-15")
        result = analyze_scanned(data, "Juja Kiambu Rd")
        self.assertEqual(result["classification"]["type"], "electricity_bill")
        self.assertEqual(result["fields"]["service_address"]["page"], 1)
        self.assertEqual(len(result["fields"]["service_address"]["bbox"]), 4)
        self.assertNotIn("1234567890", str(result))
        self.assertEqual(result["address_match"]["status"], "exact_match")
        self.assertIsNone(result["fields"]["service_address"]["confidence"])
        self.assertFalse(result["trained_model"])
        self.assertTrue(result["review_required"])
        self.assertEqual(result["issuer_status"], "not_independently_verified")

    def test_missing_address_requires_review(self):
        result = analyze_scanned(pdf("Kenya Power\nAccount holder: SYNTHETIC"))
        self.assertIn("address_not_extracted", [x["code"] for x in result["findings"]])

    def test_multi_page_conflicts_preserved(self):
        with pymupdf.open() as doc:
            for text in ["Kenya Power\nService address: Juja Kiambu", "Service address: Kisumu Milimani"]:
                doc.new_page().insert_text((50, 50), text)
            result = analyze_scanned(doc.tobytes())
        self.assertIn("conflicts", result["fields"]["service_address"])
        self.assertIn("conflicting_service_address", [f["code"] for f in result["findings"]])

    def test_identical_document_digest(self):
        raw = pdf("Synthetic tenancy agreement")
        self.assertEqual(analyze_scanned(raw)["sha256"], analyze_scanned(raw)["sha256"])

    def test_unknown_template_not_forgery(self):
        result = analyze_scanned(pdf("Unrecognized document format"))
        self.assertEqual(result["classification"]["type"], "uncertain")
        self.assertEqual(result["screening_status"], "manual_review_required")

    def test_legitimate_annotation_is_information_only(self):
        with pymupdf.open() as doc:
            page = doc.new_page(); page.insert_text((50, 50), "Synthetic record")
            page.add_text_annot((100, 100), "Legitimate note")
            result = analyze_scanned(doc.tobytes())
        finding = next(f for f in result["findings"] if f["code"] == "annotation_layer_present")
        self.assertEqual(finding["severity"], "information")
        self.assertIn("does not establish", finding["limitation"])

    def test_encrypted_pdf_rejected(self):
        with pymupdf.open() as doc:
            doc.new_page()
            raw = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="synthetic", user_pw="synthetic")
        with self.assertRaisesRegex(UnsafeDocument, "encrypted_pdf"):
            analyze_scanned(raw)

    def test_excessive_pages_rejected(self):
        with self.assertRaisesRegex(UnsafeDocument, "pdf_complexity"):
            analyze_scanned(pdf(pages=6))

    def test_embedded_file_rejected(self):
        with pymupdf.open() as doc:
            doc.new_page();doc.embfile_add("unsafe.exe", b"synthetic")
            raw = doc.tobytes()
        with self.assertRaisesRegex(UnsafeDocument, "embedded_files"):
            analyze_scanned(raw)

    def test_invalid_image_rejected(self):
        with self.assertRaisesRegex(UnsafeDocument, "invalid_image"):
            analyze_scanned(b"\x89PNG\r\n\x1a\n" + b"a" * 100)

    def test_blank_low_resolution_quality(self):
        data = io.BytesIO();Image.new("RGB", (100, 200), "white").save(data, "PNG")
        result = analyze_scanned(data.getvalue())
        self.assertEqual(result["screening_status"], "document_quality_insufficient")
        self.assertIn("ocr_not_configured", result["limitations"])
        self.assertEqual(len(result["pages"][0]["dhash"]), 16)

    def test_dates_are_evidence_not_fraud(self):
        fields = {"issue_date": {"value": "2030-01-01"}, "due_date": {"value": "2026-01-01"}}
        self.assertEqual({f["code"] for f in consistency(fields, date(2026, 11, 1))}, {"future_issue_date", "due_before_issue"})

    def test_isolated_parser_roundtrip(self):
        result = isolated(pdf("Kenya Power\nService address: Juja Kiambu"))
        self.assertEqual(result["fields"]["service_address"]["value"], "Juja Kiambu")

    def test_worker_cannot_run_without_configuration(self):
        with patch.dict(os.environ, {"DOCUMENT_PROCESSING_ENABLED": "false"}):
            with self.assertRaises(IntegrationUnavailable):
                process_one()

    def test_scan_failure_prevents_analysis(self):
        calls=[]
        def rpc(name,args):
            calls.append((name,args))
            if name.startswith("claim"):
                return {"path": "opaque", "document_id": "test", "lease_token": "lease", "mime": "application/pdf", "byte_size": len(raw)}
            return True
        def scanner(raw): raise ScannerUnavailable()
        def analyzer(raw): self.fail("Unscanned file must never reach the parser")
        raw=pdf()
        with patch.dict(os.environ, {"DOCUMENT_PROCESSING_ENABLED": "true", "DOCUMENT_CLAMD_SOCKET": "/fake/socket"}):
            result=process_one(rpc=rpc,downloader=lambda *args: raw,scanner=scanner,analyzer=analyzer)
        self.assertEqual(calls[-1][1]["p_error"], "scanner_unavailable")
        self.assertFalse(result["booking_authorized"])

if __name__ == "__main__":
    unittest.main()
