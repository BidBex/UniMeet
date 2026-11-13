from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.interest import Interest, UserInterest
from app.models.user import User
from app.schemas.auth import (
    CompatibilityOut,
    InterestOut,
    UserInterestsResponse,
    UserInterestsUpdateRequest,
    UserPrivateOut,
    UserPublicOut,
    UserUpdateRequest,
)
from app.security.auth import get_current_user
from app.services.compatibility import compute_compatibility
from app.services.serializers import (
    get_blocked_user_ids,
    get_user_interests,
    is_blocked_between,
    user_to_private,
    user_to_public,
)

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserPrivateOut, summary="Get own profile")
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return user_to_private(db, current_user)


@router.put("/me", response_model=UserPrivateOut, summary="Update own profile")
def update_my_profile(
    payload: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(current_user, field, value)

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return user_to_private(db, current_user)


@router.get("/interests", response_model=UserInterestsResponse, summary="Get user and available interests")
def get_my_interests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    selected = get_user_interests(db, current_user)
    available = [
        InterestOut.model_validate(item)
        for item in db.query(Interest).order_by(Interest.category.asc(), Interest.name.asc()).all()
    ]
    return UserInterestsResponse(selected_interests=selected, available_interests=available)


@router.put("/interests", response_model=UserInterestsResponse, summary="Replace user selected interests")
def update_my_interests(
    payload: UserInterestsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    unique_ids = list(dict.fromkeys(payload.interest_ids))
    if unique_ids:
        existing = db.query(Interest).filter(Interest.id.in_(unique_ids)).all()
        if len(existing) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more selected interest IDs do not exist.",
            )

    db.query(UserInterest).filter(UserInterest.user_id == current_user.id).delete()
    for interest_id in unique_ids:
        db.add(UserInterest(user_id=current_user.id, interest_id=interest_id))
    db.commit()

    return get_my_interests(current_user=current_user, db=db)


@router.get("/discover", response_model=List[UserPublicOut], summary="Discover students with compatibility")
def discover_users(
    university: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blocked_ids = get_blocked_user_ids(db, current_user.id)
    excluded_ids = blocked_ids | {current_user.id}

    query = db.query(User).filter(User.is_active.is_(True), ~User.id.in_(excluded_ids))
    if university:
        query = query.filter(User.university.ilike(f"%{university.strip()}%"))
    if city:
        query = query.filter(User.city.ilike(f"%{city.strip()}%"))

    candidates = query.order_by(User.created_at.desc()).limit(limit * 2).all()
    scored = []
    for candidate in candidates:
        compat = compute_compatibility(db, current_user, candidate)
        scored.append((compat.compatibility, user_to_public(db, candidate, compatibility=compat)))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item[1] for item in scored[:limit]]


@router.get(
    "/{user_id}/compatibility",
    response_model=CompatibilityOut,
    summary="Get explainable compatibility score with another user",
)
def get_user_compatibility(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot compute compatibility with yourself.",
        )

    other = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not other or is_blocked_between(db, current_user.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    return compute_compatibility(db, current_user, other)


@router.get("/{user_id}", response_model=UserPublicOut, summary="Get public user profile")
def get_public_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user or is_blocked_between(db, current_user.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    compat = None if user.id == current_user.id else compute_compatibility(db, current_user, user)
    return user_to_public(db, user, compatibility=compat)
