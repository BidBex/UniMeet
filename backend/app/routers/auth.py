from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas import MessageResponse
from app.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UserPrivateOut,
)
from app.security.auth import (
    clear_auth_cookies,
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    get_current_user,
    hash_password,
    password_fingerprint,
    set_auth_cookies,
    verify_password,
)
from app.services.serializers import user_to_private

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new UniMeet account",
)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    normalized_email = payload.email.strip().lower()
    normalized_username = payload.username.strip()

    existing_email = db.query(User).filter(User.email.ilike(normalized_email)).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    existing_username = db.query(User).filter(User.username.ilike(normalized_username)).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This username is already taken.",
        )

    user = User(
        username=normalized_username,
        email=normalized_email,
        hashed_password=hash_password(payload.password),
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        age=payload.age,
        university=payload.university.strip() if payload.university else None,
        city=payload.city.strip() if payload.city else None,
        is_active=True,
        is_verified=False,
        is_moderator=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    csrf_token = set_auth_cookies(response, token, request)

    return AuthResponse(
        user=user_to_private(db, user),
        access_token=token,
        token_type="bearer",
        csrf_token=csrf_token,
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Authenticate user and issue JWT/HttpOnly cookie",
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    identifier = payload.identifier.strip()
    user = (
        db.query(User)
        .filter(
            or_(
                User.email.ilike(identifier),
                User.username.ilike(identifier),
            )
        )
        .first()
    )

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated.",
        )

    token = create_access_token(user.id)
    csrf_token = set_auth_cookies(response, token, request)

    return AuthResponse(
        user=user_to_private(db, user),
        access_token=token,
        token_type="bearer",
        csrf_token=csrf_token,
    )


@router.post(
    "/forgot-password",
    response_model=ForgotPasswordResponse,
    summary="Request a password reset link",
)
def forgot_password(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    normalized_email = payload.email.strip().lower()
    user = db.query(User).filter(User.email.ilike(normalized_email)).first()

    reset_token = None
    reset_url = None
    if user and user.is_active:
        reset_token = create_password_reset_token(user, ttl_minutes=30)
        reset_url = f"reset-password.html?token={reset_token}"

    is_prod = settings.ENVIRONMENT.lower() == "production"
    return ForgotPasswordResponse(
        message=(
            "If an active UniMeet account matches that email, password reset instructions have been sent."
            if is_prod
            else "If an active UniMeet account matches that email, a password reset link is ready below."
        ),
        reset_token=None if is_prod else reset_token,
        reset_url=None if is_prod else reset_url,
    )


@router.post(
    "/reset-password",
    response_model=MessageResponse,
    summary="Reset password using a single-use reset token",
)
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    decoded = decode_password_reset_token(payload.token.strip())
    if decoded is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired.",
        )

    user_id, expected_fp = decoded
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user or password_fingerprint(user.hashed_password) != expected_fp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has already been used.",
        )

    user.hashed_password = hash_password(payload.new_password)
    db.add(user)
    db.commit()
    return MessageResponse(message="Password updated successfully. You can now sign in with your new password.")


@router.post(
    "/logout",
    response_model=MessageResponse,
    summary="Clear authentication cookies",
)
def logout(request: Request, response: Response):
    clear_auth_cookies(response, request)
    return MessageResponse(message="Logged out successfully.")


@router.get(
    "/me",
    response_model=UserPrivateOut,
    summary="Return currently authenticated user",
)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return user_to_private(db, current_user)
