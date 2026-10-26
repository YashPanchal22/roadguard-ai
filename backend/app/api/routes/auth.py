"""Authentication endpoints (JWT bearer tokens, PBKDF2 password hashing)."""
from __future__ import annotations

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import check_rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.models.entities import User
from app.schemas.schemas import TokenOut, UserCreate, UserLogin, UserOut
from app.services.reports import audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _token_for(user: User) -> TokenOut:
    token = create_access_token(user.id, {"role": user.role, "name": user.name})
    return TokenOut(
        access_token=token,
        expires_in_minutes=settings.access_token_expire_minutes,
        user=UserOut.model_validate(user),
    )


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a citizen account",
)
def register(payload: UserCreate, db: DbSession, request: Request) -> TokenOut:
    check_rate_limit(request, scope="auth", limit=settings.rate_limit_auth_per_window, window_seconds=60)
    email = payload.email.lower()
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        raise AppError("EMAIL_TAKEN", "An account with this email already exists.", status_code=409)

    # Public self-registration can never grant reviewer/admin rights.
    if payload.role.value != "citizen":
        raise AppError(
            "ROLE_NOT_ALLOWED",
            "Self-registration is limited to the citizen role.",
            status_code=403,
            hints=["Elevated roles are created by an administrator in the database or seed script."],
        )

    user = User(name=payload.name.strip(), email=email, role="citizen", password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    audit(db, entity_type="user", entity_id=user.id, action="user.registered", actor=user)
    db.commit()
    db.refresh(user)
    return _token_for(user)


@router.post("/login", response_model=TokenOut, summary="Sign in and receive a bearer token")
def login(payload: UserLogin, db: DbSession, request: Request) -> TokenOut:
    check_rate_limit(request, scope="auth", limit=settings.rate_limit_auth_per_window, window_seconds=60)
    user = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AppError("INVALID_CREDENTIALS", "Email or password is incorrect.", status_code=401)
    if not user.is_active:
        raise AppError("ACCOUNT_DISABLED", "This account has been disabled.", status_code=403)
    audit(db, entity_type="user", entity_id=user.id, action="user.login", actor=user)
    db.commit()
    return _token_for(user)


@router.get("/me", response_model=UserOut, summary="Current authenticated user")
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
