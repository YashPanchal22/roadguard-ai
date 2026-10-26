"""Tiny in-process sliding-window rate limiter.

Suitable for a single-node pilot deployment. Behind multiple workers or a
public deployment, terminate rate limiting at the reverse proxy (documented in
docs/DEPLOYMENT.md) because counters are per process.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request

from app.core.errors import AppError

_WINDOWS: dict[str, deque[float]] = defaultdict(deque)
_LOCK = Lock()


def _client_key(request: Request, scope: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    return f"{scope}:{ip}"


def check_rate_limit(request: Request, *, scope: str, limit: int, window_seconds: int) -> None:
    key = _client_key(request, scope)
    now = time.monotonic()
    with _LOCK:
        bucket = _WINDOWS[key]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = int(window_seconds - (now - bucket[0])) + 1
            raise AppError(
                "RATE_LIMITED",
                f"Too many requests. Try again in {retry_after} seconds.",
                status_code=429,
                details={"limit": limit, "window_seconds": window_seconds, "retry_after": retry_after},
            )
        bucket.append(now)


def reset_limits() -> None:  # used by tests
    with _LOCK:
        _WINDOWS.clear()
