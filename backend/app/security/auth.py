from datetime import datetime, timedelta, timezone
import secrets
from typing import Dict, Optional, Tuple

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User

settings = get_settings()
_password_hasher = PasswordHasher()

CSRF_COOKIE_NAME = "unimeet_csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Short-lived, single-use WebSocket connection tickets: ticket -> (user_id, expires_at)
_ws_tickets: Dict[str, Tuple[int, datetime]] = {}


def hash_password(plain_password: str) -> str:
    return _password_hasher.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return _password_hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if payload.get("type") != "access":
            return None
        sub = payload.get("sub")
        return int(sub) if sub is not None else None
    except (InvalidTokenError, ValueError, TypeError):
        return None


def set_auth_cookies(response: Response, token: str) -> str:
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=max_age,
        path="/",
    )
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=max_age,
        path="/",
    )
    return csrf_token


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key=settings.COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")


def extract_token_from_request(request: Request) -> Tuple[Optional[str], bool]:
    """Return (token, used_cookie_auth)."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip(), False

    cookie_token = request.cookies.get(settings.COOKIE_NAME)
    if cookie_token:
        return cookie_token, True
    return None, False


def _enforce_csrf_if_needed(request: Request, used_cookie_auth: bool) -> None:
    if not used_cookie_auth:
        return
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    # Enforce CSRF double-submit check when browser sends Origin or explicit CSRF header
    origin = request.headers.get("Origin")
    csrf_header = request.headers.get(CSRF_HEADER_NAME)
    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
    if origin is not None or csrf_header is not None:
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed.",
            )


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token, used_cookie = extract_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _enforce_csrf_if_needed(request, used_cookie)

    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found or inactive.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    token, _ = extract_token_from_request(request)
    if not token:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()


def require_moderator(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Moderator privileges required.",
        )
    return current_user


def create_ws_ticket(user_id: int, ttl_seconds: int = 30) -> str:
    now = datetime.now(timezone.utc)
    # Prune expired tickets
    expired = [k for k, (_, exp) in _ws_tickets.items() if exp <= now]
    for k in expired:
        _ws_tickets.pop(k, None)

    ticket = secrets.token_urlsafe(32)
    _ws_tickets[ticket] = (user_id, now + timedelta(seconds=ttl_seconds))
    return ticket


def consume_ws_ticket(ticket: str) -> Optional[int]:
    now = datetime.now(timezone.utc)
    entry = _ws_tickets.pop(ticket, None)
    if entry is None:
        return None
    user_id, exp = entry
    if exp <= now:
        return None
    return user_id
