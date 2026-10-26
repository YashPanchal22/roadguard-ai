"""Shared FastAPI dependencies: authentication, roles, rate limits."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import check_rate_limit
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models.entities import Role, User

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise AppError(
            "AUTH_REQUIRED",
            "Sign in to perform this action.",
            status_code=401,
            hints=["Use POST /api/v1/auth/login, then send 'Authorization: Bearer <token>'."],
        )
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception as exc:  # expired or tampered token
        raise AppError("INVALID_TOKEN", "Session token is invalid or expired.", status_code=401) from exc
    user = db.execute(select(User).where(User.id == payload.get("sub"))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AppError("INVALID_TOKEN", "This account is no longer active.", status_code=401)
    return user


def get_optional_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User | None:
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:
        return None
    return db.execute(select(User).where(User.id == payload.get("sub"))).scalar_one_or_none()


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_reviewer(user: CurrentUser) -> User:
    if user.role not in {Role.reviewer.value, Role.admin.value}:
        raise AppError("FORBIDDEN", "Reviewer or admin role required.", status_code=403)
    return user


def require_admin(user: CurrentUser) -> User:
    if user.role != Role.admin.value:
        raise AppError("FORBIDDEN", "Administrator role required.", status_code=403)
    return user


ReviewerUser = Annotated[User, Depends(require_reviewer)]
AdminUser = Annotated[User, Depends(require_admin)]


def detection_rate_limit(request: Request) -> None:
    check_rate_limit(
        request,
        scope="detection",
        limit=settings.rate_limit_detection_per_window,
        window_seconds=settings.rate_limit_window_seconds,
    )
