"""Bounded Tier A/B observations; no trained forgery model or issuer assertion."""
import io
import os
import re
import shutil
import subprocess
import tempfile
import warnings
from collections import Counter
from datetime import date

from . import VERSION
from .address import compare
from .fields import classify, extract, consistency
from .safety import MAX_BYTES, MAX_PAGES, MAX_PIXELS, UnsafeDocument, identify, digest


def finding(code, module, severity="information", page=None, bbox=None):
    return {"code": code, "module": module, "severity": severity, "page": page,
            "bbox": list(bbox) if bbox is not None else None, "confidence": None,
            "limitation": "This observation does not establish forgery or authenticity."}


def image_observations(data, page=1):
    from PIL import Image, ImageOps, ImageFilter, ImageStat
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_PIXELS or getattr(source, "n_frames", 1) != 1:
                    raise UnsafeDocument("image_complexity")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
        except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
            raise UnsafeDocument("invalid_image") from None
    width, height = image.size
    gray = image.convert("L")
    tiny = list(gray.resize((9, 8)).get_flattened_data())
    bits = [tiny[y * 9 + x] > tiny[y * 9 + x + 1] for y in range(8) for x in range(8)]
    dhash = f"{sum(int(bit) << i for i, bit in enumerate(bits)):016x}"
    sample = gray.copy(); sample.thumbnail((768, 768))
    observations = []
    if min(width, height) < 600:
        observations.append(finding("low_resolution", "quality", "review", page))
    if ImageStat.Stat(sample).stddev[0] < 12:
        observations.append(finding("low_contrast", "quality", "review", page))
    # Descriptive edge statistic, not calibrated blur or manipulation probability.
    edge_energy = round(ImageStat.Stat(sample.filter(ImageFilter.FIND_EDGES)).mean[0], 2)
    if edge_energy < 1:
        observations.append(finding("little_visible_detail", "quality", "review", page))
    lines, limitations = [], []
    tesseract = shutil.which("tesseract")
    if tesseract and os.getenv("DOCUMENT_OCR_ENABLED") == "true":
        # Metadata-free derivative; original bytes are never overwritten.
        image.thumbnail((2000, 2000))
        with tempfile.TemporaryDirectory(prefix="lockd-ocr-") as folder:
            source_path = os.path.join(folder, "page.png")
            output_path = os.path.join(folder, "text")
            image.save(source_path, "PNG")
            try:
                subprocess.run([tesseract, source_path, output_path, "-l", "eng", "--psm", "3", "tsv"],
                               check=True, timeout=8, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                tsv_path = output_path + ".tsv"
                if os.path.getsize(tsv_path) > 200000:
                    raise UnsafeDocument("ocr_complexity")
                with open(tsv_path, encoding="utf-8") as result:
                    rows = result.read().splitlines()[1:]
                grouped = {}
                for row in rows:
                    parts = row.split("\t", 11)
                    if len(parts) != 12 or parts[0] != "5" or not parts[11].strip():
                        continue
                    group = tuple(parts[1:5]); x, y, w, h = map(int, parts[6:10])
                    grouped.setdefault(group, []).append((parts[11], x, y, x+w, y+h, float(parts[10])))
                for words in grouped.values():
                    lines.append({"text": " ".join(w[0] for w in words), "page": page,
                                  "bbox": [min(w[1] for w in words)/image.width, min(w[2] for w in words)/image.height,
                                           max(w[3] for w in words)/image.width, max(w[4] for w in words)/image.height],
                                  "source": "tesseract", "confidence": round(sum(w[5] for w in words)/len(words)/100, 3)})
            except (subprocess.SubprocessError, OSError, ValueError):
                limitations.append("ocr_unavailable_or_timed_out")
    else:
        limitations.append("ocr_not_configured")
    return lines, observations, {"width": width, "height": height, "dhash": dhash, "edge_energy": edge_energy}, limitations


def pdf_observations(data, password=None):
    import pymupdf
    findings, lines, pages, limitations = [], [], [], []
    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if document.needs_pass and (not password or not document.authenticate(password)):
                raise UnsafeDocument("encrypted_pdf")
            if not 1 <= document.page_count <= MAX_PAGES or document.xref_length() > 5000:
                raise UnsafeDocument("pdf_complexity")
            if document.embfile_count():
                raise UnsafeDocument("embedded_files")
            if b"/JavaScript" in data or b"/Launch" in data or b"/OpenAction" in data:
                raise UnsafeDocument("active_pdf_content")
            if len(re.findall(rb"startxref", data)) > 1:
                findings.append(finding("incremental_updates_present", "pdf"))
            if b"/ByteRange" in data:
                findings.append(finding("signature_present_not_validated", "pdf"))
                limitations.append("signature_chain_validation_not_available")
            for number, page in enumerate(document, 1):
                rect = page.rect
                if min(rect.width, rect.height) < 10 or max(rect.width, rect.height) > 2000:
                    raise UnsafeDocument("page_dimensions")
                fonts = Counter()
                # Exclude embedded image bytes from text extraction to bound memory.
                text = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
                if len(text["blocks"]) > 2000:
                    raise UnsafeDocument("text_complexity")
                for block in text["blocks"]:
                    for line in block.get("lines", []):
                        spans = line["spans"]
                        value = "".join(span["text"] for span in spans)
                        if len(value) > 4000:
                            raise UnsafeDocument("text_complexity")
                        if value.strip():
                            box = line["bbox"]
                            lines.append({"text": value, "page": number, "bbox": [box[0]/rect.width, box[1]/rect.height, box[2]/rect.width, box[3]/rect.height], "source": "embedded_text"})
                            for span in spans:
                                fonts[(span["font"], round(span["size"], 1))] += len(span["text"])
                annotations = list(page.annots() or [])
                if len(annotations) > 100 or len(page.get_images()) > 100:
                    raise UnsafeDocument("page_complexity")
                for annotation in annotations[:20]:
                    a = annotation.rect
                    findings.append(finding("annotation_layer_present", "pdf", "information", number,
                                            [a.x0/rect.width, a.y0/rect.height, a.x1/rect.width, a.y1/rect.height]))
                if len(fonts) > 6:
                    findings.append(finding("varied_typography", "typography", "information", number))
                if not any(line["page"] == number for line in lines):
                    # Only small bounded rasterisation for a scanned page.
                    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
                    ocr_lines, observations, _, missing = image_observations(pixmap.tobytes("png"), number)
                    lines.extend(ocr_lines); findings.extend(observations); limitations.extend(missing)
                pages.append({"page": number, "width": rect.width, "height": rect.height, "font_variants": len(fonts), "annotations": len(annotations)})
            if len({(round(p["width"]), round(p["height"])) for p in pages}) > 1:
                findings.append(finding("mixed_page_dimensions", "pdf", "information"))
    except UnsafeDocument:
        raise
    except Exception:
        raise UnsafeDocument("invalid_pdf") from None
    return lines, findings, pages, limitations


def analyze_scanned(data, declared_address="", today=None, method=None, password=None):
    """Call ONLY after malware scan. Worker enforces process and execution bounds."""
    mime = identify(data)
    if mime == "application/pdf":
        lines, findings, pages, limitations = pdf_observations(data, password=password)
    else:
        lines, findings, page, limitations = image_observations(data)
        pages = [page]
    if len(lines) > 3000 or sum(len(line["text"]) for line in lines) > 100000:
        raise UnsafeDocument("text_complexity")
    text = "\n".join(line["text"] for line in lines)
    pagination = {(int(a), int(b)) for a, b in re.findall(r'(?i)\bpage\s+(\d{1,3})\s+(?:of|/)\s*(\d{1,3})\b', text)}
    if pagination and (len({total for _, total in pagination}) != 1 or {number for number, _ in pagination} != set(range(1, max(total for _, total in pagination) + 1))):
        findings.append(finding('incomplete_page_sequence', 'semantic', 'review'))
    classification = classify(text)
    from .providers import classify_provider
    provider = classify_provider(text)
    fields = extract(lines)
    findings.extend(consistency(fields, today))
    if "service_address" not in fields and method not in ('mpesa','bank'):
        findings.append(finding("address_not_extracted", "fields", "review"))
    if not text.strip():
        findings.append(finding("no_readable_text", "quality", "review"))
    if classification["type"] == "uncertain":
        findings.append(finding("unrecognized_document_type", "classification", "review"))
    match = compare(declared_address, fields.get("service_address", {}).get("value", ""))
    quality = any(f["module"] == "quality" and f["severity"] == "review" for f in findings)
    status = "document_quality_insufficient" if quality else "manual_review_required" if any(f["severity"] == "review" for f in findings) else "no_material_anomalies_detected"
    result = {"version": VERSION, "sha256": digest(data), "mime": mime, "pages": pages,
            "classification": classification, "provider": provider, "fields": fields, "findings": findings,
            "address_match": match, "screening_status": status, "issuer_status": "not_independently_verified",
            "trained_model": False, "template_version": None, "review_required": True,
            "limitations": sorted(set(limitations + ["No lawfully validated issuer templates configured.",
                "No calibrated manipulation model, compression/noise detector or copy-move detector configured.",
                "Missing pages, cropping and text overlays cannot be reliably ruled out.",
                "Absence of anomalies does not prove authenticity."]))}
    if method in ('mpesa', 'bank'):
        from .financial import parse
        result['financial'] = parse(lines, method)
        result['fields'] = result['financial']['fields']
        result['classification'] = {'type': method + '_statement', 'method': 'declared_workflow', 'confidence': None}
        result['review_required'] = True
    return result
