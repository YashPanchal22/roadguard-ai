"""Upload validation: extension, declared MIME type, magic bytes, size, integrity.

Every check happens *before* the bytes reach the model. A file that fails any
check never touches the detector and never reaches disk.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

from app.core.config import settings
from app.core.errors import AppError

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Magic-number signatures (first bytes of the file).
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
)

MAX_PIXELS = 40_000_000  # decompression-bomb guard (~40 MP)


@dataclass
class ValidatedImage:
    data: bytes
    extension: str
    mime_type: str
    width: int
    height: int
    file_hash: str
    perceptual_hash: str
    exif_gps_present: bool
    has_alpha: bool


def _sniff_format(head: bytes) -> str | None:
    for sig, fmt in _SIGNATURES:
        if head.startswith(sig):
            return fmt
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def _extract_exif_gps(img: Image.Image) -> bool:
    """True only when real EXIF GPS tags exist. Never derived from pixels."""
    try:
        exif = img.getexif()
    except Exception:  # pragma: no cover - malformed exif block
        return False
    if not exif:
        return False
    # GPS IFD id is 34853
    try:
        gps = exif.get_ifd(34853)
    except Exception:  # pragma: no cover
        return False
    if not gps:
        return False
    return 2 in gps and 4 in gps  # GPSLatitude / GPSLongitude


def validate_upload(
    *,
    filename: str | None,
    content_type: str | None,
    data: bytes,
    max_mb: float | None = None,
) -> ValidatedImage:
    limit = int((max_mb if max_mb is not None else settings.max_upload_mb) * 1024 * 1024)

    if not filename:
        raise AppError("NO_FILE", "No file was provided in the upload.", status_code=400)
    if not data:
        raise AppError("EMPTY_FILE", "The uploaded file is empty.", status_code=400)
    if len(data) > limit:
        raise AppError(
            "FILE_TOO_LARGE",
            f"Image is {len(data) / 1024 / 1024:.1f} MB which exceeds the {limit / 1024 / 1024:.0f} MB limit.",
            status_code=413,
            details={"max_mb": round(limit / 1024 / 1024, 1)},
        )

    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in ALLOWED_EXTENSIONS:
        raise AppError(
            "UNSUPPORTED_EXTENSION",
            f"'{suffix or filename}' is not a supported image extension.",
            status_code=415,
            details={"allowed": sorted(ALLOWED_EXTENSIONS)},
        )

    if content_type:
        declared = content_type.split(";")[0].strip().lower()
        if declared not in ALLOWED_MIME and not declared.startswith("image/"):
            raise AppError(
                "UNSUPPORTED_MIME",
                f"Declared content type '{declared}' is not an accepted image type.",
                status_code=415,
                details={"allowed": sorted(ALLOWED_MIME)},
            )

    sniffed = _sniff_format(data[:16])
    if sniffed is None:
        raise AppError(
            "CORRUPT_IMAGE",
            "The file content is not a valid JPEG, PNG or WEBP image (magic-number check failed).",
            status_code=422,
        )

    # Extension must agree with the real content.
    ext_family = "jpeg" if suffix in {".jpg", ".jpeg"} else suffix.lstrip(".")
    if ext_family != sniffed:
        raise AppError(
            "EXTENSION_MISMATCH",
            f"File extension '{suffix}' does not match the actual image content ({sniffed}).",
            status_code=422,
            details={"extension": suffix, "detected": sniffed},
        )

    try:
        with Image.open(BytesIO(data)) as probe:
            probe.verify()  # structural integrity
    except Exception as exc:
        raise AppError(
            "CORRUPT_IMAGE",
            "The image could not be decoded; it may be truncated or corrupted.",
            status_code=422,
            details={"reason": str(exc)[:200]},
        ) from exc

    try:
        with Image.open(BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            if width < 32 or height < 32:
                raise AppError(
                    "IMAGE_TOO_SMALL",
                    f"Image is {width}x{height}px; at least 32x32px is required.",
                    status_code=422,
                )
            if width * height > MAX_PIXELS:
                raise AppError(
                    "IMAGE_TOO_LARGE",
                    f"Image is {width}x{height}px which exceeds the {MAX_PIXELS // 1_000_000} MP safety limit.",
                    status_code=422,
                )
            has_alpha = img.mode in {"RGBA", "LA"} or "transparency" in img.info
            exif_gps = _extract_exif_gps(img)
            rgb = img.convert("RGB")
            if rgb.width > 1600:  # normalise huge photos before hashing/analysis
                rgb.thumbnail((1600, 1600), Image.LANCZOS)
            perceptual_hash = _phash(rgb)
    except AppError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise AppError(
            "CORRUPT_IMAGE",
            "The image could not be fully decoded.",
            status_code=422,
            details={"reason": str(exc)[:200]},
        ) from exc

    return ValidatedImage(
        data=data,
        extension=".jpg" if suffix in {".jpg", ".jpeg"} else suffix,
        mime_type=ALLOWED_MIME.get((content_type or "").split(";")[0].strip().lower(), f"image/{sniffed}"),
        width=width,
        height=height,
        file_hash=hashlib.sha256(data).hexdigest(),
        perceptual_hash=perceptual_hash,
        exif_gps_present=exif_gps,
        has_alpha=has_alpha,
    )


def _phash(img: Image.Image) -> str:
    """64-bit DCT perceptual hash (hex) used only for duplicate assistance."""
    try:
        import imagehash  # type: ignore

        return str(imagehash.phash(img.convert("L")))
    except Exception:  # pragma: no cover - optional dependency
        return ""


def phash_distance(a: str, b: str) -> int | None:
    if not a or not b or len(a) != len(b):
        return None
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:  # pragma: no cover
        return None


def strip_exif_bytes(data: bytes) -> bytes:
    """Return re-encoded bytes with all EXIF/metadata removed (privacy)."""
    with Image.open(BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        clean = Image.new(img.mode, img.size)
        clean.putdata(list(img.getdata()))
        buf = BytesIO()
        fmt = "PNG" if img.format == "PNG" else "JPEG"
        save_kwargs = {"quality": 92} if fmt == "JPEG" else {}
        clean.save(buf, format=fmt, **save_kwargs)
        return buf.getvalue()


def to_bgr_array(data: bytes) -> np.ndarray:
    import cv2

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise AppError("CORRUPT_IMAGE", "OpenCV could not decode the image.", status_code=422)
    return img
