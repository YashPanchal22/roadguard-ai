"""File storage helpers.

Layout (all under ``settings.storage_dir``)::

    _tmp/<analysis_id>/original.jpg
    _tmp/<analysis_id>/annotated.jpg
    _tmp/<analysis_id>/meta.json
    reports/<report_id>/<image_id>_original.jpg
    reports/<report_id>/<image_id>_annotated.jpg

Only relative paths are stored in the database; the API serves files through
``/api/v1/media/...`` which resolves inside the storage root and rejects
traversal attempts.
"""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.errors import AppError

TMP_TTL_SECONDS = 60 * 60 * 4  # analyses not attached to a report expire after 4h


def tmp_root() -> Path:
    path = settings.storage_dir / "_tmp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def reports_root() -> Path:
    path = settings.storage_dir / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_component(value: str) -> str:
    """Reject anything that could escape the storage root."""
    cleaned = Path(str(value)).name
    if cleaned != str(value) or not cleaned or cleaned in {".", ".."}:
        raise AppError("INVALID_PATH", "Invalid file reference.", status_code=400)
    if "/" in cleaned or "\\" in cleaned or "\x00" in cleaned:
        raise AppError("INVALID_PATH", "Invalid file reference.", status_code=400)
    return cleaned


def resolve_media(relative_path: str) -> Path:
    """Resolve a stored relative path and guarantee it stays inside storage_dir."""
    if not relative_path:
        raise AppError("INVALID_PATH", "Empty file reference.", status_code=400)
    root = settings.storage_dir.resolve()
    candidate = (root / relative_path).resolve()
    if not str(candidate).startswith(str(root) + "/") or not candidate.is_file():
        raise AppError("NOT_FOUND", "File not found.", status_code=404)
    return candidate


def new_analysis_id() -> str:
    return uuid.uuid4().hex


def save_analysis(
    *,
    original_bytes: bytes,
    annotated_bytes: bytes | None,
    meta: dict[str, Any],
) -> str:
    analysis_id = new_analysis_id()
    folder = tmp_root() / analysis_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "original.jpg").write_bytes(original_bytes)
    if annotated_bytes:
        (folder / "annotated.jpg").write_bytes(annotated_bytes)
    payload = dict(meta)
    payload["created"] = time.time()
    (folder / "meta.json").write_text(json.dumps(payload, default=str), encoding="utf-8")
    return analysis_id


def load_analysis(analysis_id: str) -> dict[str, Any]:
    folder = tmp_root() / safe_component(analysis_id)
    meta_file = folder / "meta.json"
    if not meta_file.is_file():
        raise AppError(
            "ANALYSIS_EXPIRED",
            "This detection result is no longer available. Please upload the photo again.",
            status_code=410,
        )
    if time.time() - meta_file.stat().st_mtime > TMP_TTL_SECONDS:
        shutil.rmtree(folder, ignore_errors=True)
        raise AppError(
            "ANALYSIS_EXPIRED",
            "This detection result expired. Please upload the photo again.",
            status_code=410,
        )
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    meta["_folder"] = folder
    return meta


def finalize_analysis(analysis_id: str, report_id: str) -> dict[str, Any]:
    """Move a temp analysis into the permanent report folder.

    Returns the analysis metadata with ``original_rel`` / ``annotated_rel``
    pointing at the final locations.
    """
    meta = load_analysis(analysis_id)
    folder: Path = meta["_folder"]
    image_id = uuid.uuid4().hex
    target_dir = reports_root() / safe_component(report_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    original_name = f"{image_id}_original{meta.get('extension', '.jpg')}"
    shutil.move(str(folder / "original.jpg"), str(target_dir / original_name))
    meta["original_rel"] = f"reports/{report_id}/{original_name}"

    if (folder / "annotated.jpg").is_file():
        annotated_name = f"{image_id}_annotated.jpg"
        shutil.move(str(folder / "annotated.jpg"), str(target_dir / annotated_name))
        meta["annotated_rel"] = f"reports/{report_id}/{annotated_name}"
    else:
        meta["annotated_rel"] = None

    meta["image_id"] = image_id
    shutil.rmtree(folder, ignore_errors=True)
    return meta


def discard_analysis(analysis_id: str) -> None:
    try:
        shutil.rmtree(tmp_root() / safe_component(analysis_id), ignore_errors=True)
    except AppError:
        pass


def cleanup_tmp(ttl_seconds: int = TMP_TTL_SECONDS) -> int:
    """Remove expired temporary analyses. Returns the number removed."""
    removed = 0
    root = tmp_root()
    cutoff = time.time() - ttl_seconds
    for child in root.iterdir() if root.exists() else []:
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
        except OSError:  # pragma: no cover
            continue
    return removed


def delete_report_files(report_id: str) -> None:
    shutil.rmtree(reports_root() / safe_component(report_id), ignore_errors=True)
