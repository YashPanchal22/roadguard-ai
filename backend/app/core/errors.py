"""Uniform error envelope used by every endpoint."""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Domain error carrying an HTTP status and a machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
        hints: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.hints = hints or []

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        if self.hints:
            body["hints"] = self.hints
        return {"error": body}


class ModelUnavailableError(AppError):
    def __init__(self, message: str, hints: list[str] | None = None, details: dict | None = None):
        super().__init__(
            "MODEL_UNAVAILABLE",
            message,
            status_code=503,
            details=details,
            hints=hints,
        )
