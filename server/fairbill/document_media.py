"""Bounded extraction and source locations for versioned imports."""
import math
import os
import re
import shutil
import statistics
from collections import Counter
import subprocess
from xml.etree import ElementTree

import pymupdf

MAX_PIXELS = 16_000_000
MAX_OUTPUT_EDGE = 2600
MAX_PAGE_CHARS = 16000
JPEG_FRAMES = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def media_type(data: bytes) -> str:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise ValueError("Choose a PDF, JPEG or PNG, or paste the text.")


def image_size(data: bytes, mime: str) -> tuple[int, int]:
    if mime == "image/png" and len(data) >= 24 and data[12:16] == b"IHDR":
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if mime == "image/jpeg":
        start = 2
        while start + 4 <= len(data) and data[start] == 0xFF:
            start += 1
            if data[start] == 0xFF:
                continue
            marker = data[start]
            length = int.from_bytes(data[start + 1:start + 3], "big")
            if length < 2 or start + 1 + length > len(data):
                break
            if marker in JPEG_FRAMES and length >= 7:
                height = int.from_bytes(data[start + 4:start + 6], "big")
                width = int.from_bytes(data[start + 6:start + 8], "big")
                return width, height
            if marker in {0xD9, 0xDA}:
                break
            start += 1 + length
    raise ValueError("The image header could not be read.")


def enhanced_pixmap(pixmap):
    scale = min(1, MAX_OUTPUT_EDGE / max(pixmap.width, pixmap.height))
    if scale < 1:
        pixmap = pymupdf.Pixmap(pixmap, pixmap.width * scale, pixmap.height * scale)
    if not pixmap.colorspace:
        raise ValueError("The image does not contain a readable colour layer.")
    if pixmap.colorspace.n != 1:
        pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pixmap)
    pixels = pixmap.samples
    if pixmap.alpha:
        # MuPDF samples are premultiplied. Composite transparent areas on white.
        pixels = bytes(gray + 255 - alpha for gray, alpha in zip(pixels[::2], pixels[1::2]))
    histogram = Counter(pixels)
    cutoff = max(1, len(pixels) // 100)
    low, high = 0, 255
    for levels, direction in [(range(256), 1), (range(255, -1, -1), -1)]:
        count = 0
        for level in levels:
            count += histogram[level]
            if count >= cutoff:
                if direction == 1:
                    low = level
                else:
                    high = level
                break
    if high - low >= 24:
        stretch = bytes(max(0, min(255, (sample - low) * 255 // (high - low))) for sample in range(256))
        pixels = pixels.translate(stretch)
    return pymupdf.Pixmap(pymupdf.csGRAY, pixmap.width, pixmap.height, pixels, False)


def _integer_box(rect) -> list[int]:
    return [math.floor(rect.x0), math.floor(rect.y0), math.ceil(rect.x1), math.ceil(rect.y1)]


def _hocr(data: bytes) -> ElementTree.Element:
    if not shutil.which("tesseract"):
        raise ValueError("Local OCR is unavailable. Install Tesseract or paste the document text.")
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "6", "hocr"],
            input=data, capture_output=True, timeout=25, check=True,
            env={**os.environ, "OMP_THREAD_LIMIT": "1"},
        )
        return ElementTree.fromstring(result.stdout)
    except (subprocess.CalledProcessError, OSError, ElementTree.ParseError) as exc:
        raise ValueError("The image could not be read. Retake it or paste the text.") from exc


def _ocr_lines(pixmap, source_transform: pymupdf.Matrix) -> list[dict]:
    prepared = enhanced_pixmap(pixmap)
    transform = pymupdf.Matrix(pixmap.width / prepared.width, pixmap.height / prepared.height) * source_transform
    try:
        markup = _hocr(prepared.tobytes("png"))
    except subprocess.TimeoutExpired:
        prepared = pymupdf.Pixmap(prepared, max(1, prepared.width // 2), max(1, prepared.height // 2))
        transform = pymupdf.Matrix(pixmap.width / prepared.width, pixmap.height / prepared.height) * source_transform
        try:
            markup = _hocr(prepared.tobytes("png"))
        except subprocess.TimeoutExpired as exc:
            raise ValueError("Reading this page timed out. Crop to the itemised charges and try again.") from exc
    baselines = []
    for line in markup.iter():
        if line.get("class") != "ocr_line":
            continue
        match = re.search(r"(?:^|;)\s*baseline\s+(-?\d+(?:\.\d+)?)", line.get("title", ""))
        if match:
            baselines.append(float(match[1]))
    angle = math.degrees(math.atan(statistics.median(baselines))) if len(baselines) >= 2 else 0
    if 1.0 <= abs(angle) <= 12:
        rotation = pymupdf.Matrix(-angle)
        with pymupdf.open() as canvas:
            page = canvas.new_page(width=prepared.width, height=prepared.height)
            page.insert_image(page.rect, pixmap=prepared)
            rotated = page.get_pixmap(matrix=rotation, colorspace=pymupdf.csGRAY)
        try:
            markup = _hocr(rotated.tobytes("png"))
        except subprocess.TimeoutExpired:
            pass  # Keep the first pass and its original coordinates.
        else:
            transform = pymupdf.Matrix(1, 0, 0, 1, rotated.x, rotated.y) * ~rotation * transform

    lines = []
    for line in markup.iter():
        if line.get("class") != "ocr_line":
            continue
        box = re.search(r"(?:^|;)\s*bbox\s+(\d+) (\d+) (\d+) (\d+)", line.get("title", ""))
        words = [word for word in line.iter() if word.get("class") == "ocrx_word"]
        text = " ".join("".join(word.itertext()).strip() for word in words).strip()
        if not text or not box:
            continue
        confidence = []
        for word in words:
            match = re.search(r"(?:^|;)\s*x_wconf\s+(\d+)", word.get("title", ""))
            if match:
                confidence.append(int(match[1]))
        rect = pymupdf.Rect(tuple(map(int, box.groups()))) * transform
        lines.append({
            "raw_text": text,
            "bbox": _integer_box(rect),
            "confidence": sum(confidence) // len(confidence) if confidence else None,
            "source": "ocr",
        })
    return lines


def _pdf_lines(page) -> list[dict]:
    lines = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            if text.strip():
                lines.append({
                    "raw_text": text,
                    "bbox": _integer_box(pymupdf.Rect(line["bbox"])),
                    "confidence": None,
                    "source": "pdf_text",
                })
    return lines


def _bounded(lines: list[dict]) -> list[dict]:
    # Fail rather than silently drop potentially billable lines.
    if sum(len(line["raw_text"]) + 1 for line in lines) > MAX_PAGE_CHARS:
        raise ValueError("A page contains too much extracted text. Split the document into smaller parts.")
    return lines


def extract_versioned(data: bytes, mime: str, max_pages: int) -> list[list[dict]]:
    if mime == "application/pdf":
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.is_encrypted or pdf.metadata.get("encryption") or not 1 <= len(pdf) <= max_pages:
                    raise ValueError(f"Use an unlocked PDF of up to {max_pages} pages.")
                if sum(abs(page.rect.width * page.rect.height) for page in pdf) > 10_000_000:
                    raise ValueError("PDF page dimensions are too large.")
                pages = []
                scans = 0
                for page in pdf:
                    lines = _pdf_lines(page)
                    if not lines:
                        scans += 1
                        if scans > 3:
                            raise ValueError("Import up to three scanned pages at a time.")
                        scale = min(160 / 72, MAX_OUTPUT_EDGE / max(page.rect.width, page.rect.height))
                        raster = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)
                        inverse_scale = pymupdf.Matrix(1 / scale, 1 / scale)
                        lines = _ocr_lines(raster, inverse_scale * page.derotation_matrix)
                    pages.append(_bounded(lines))
                return pages
        except (RuntimeError, pymupdf.FileDataError) as exc:
            raise ValueError("The PDF could not be read.") from exc
    width, height = image_size(data, mime)
    if min(width, height) < 1 or max(width, height) > 10_000 or width * height > MAX_PIXELS:
        raise ValueError("Image dimensions are too large. Resize the photo and try again.")
    try:
        pixmap = pymupdf.Pixmap(data)
        return [_bounded(_ocr_lines(pixmap, pymupdf.Matrix(1, 1)))]
    except (RuntimeError, pymupdf.FileDataError) as exc:
        raise ValueError("The image could not be read.") from exc
