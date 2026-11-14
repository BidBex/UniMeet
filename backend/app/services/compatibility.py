from typing import Set

from sqlalchemy.orm import Session

from app.models.event import Event, EventLike, EventParticipant
from app.models.interest import Interest, UserInterest
from app.models.user import User
from app.schemas.auth import CompatibilityOut


def _user_interest_names(db: Session, user_id: int) -> list[str]:
    rows = (
        db.query(Interest.name)
        .join(UserInterest, UserInterest.interest_id == Interest.id)
        .filter(UserInterest.user_id == user_id)
        .order_by(Interest.name.asc())
        .all()
    )
    return [row[0] for row in rows]


def _user_event_categories(db: Session, user_id: int) -> Set[str]:
    liked = (
        db.query(Event.category)
        .join(EventLike, EventLike.event_id == Event.id)
        .filter(EventLike.user_id == user_id)
        .all()
    )
    joined = (
        db.query(Event.category)
        .join(EventParticipant, EventParticipant.event_id == Event.id)
        .filter(EventParticipant.user_id == user_id)
        .all()
    )
    return {row[0] for row in (*liked, *joined) if row[0]}


def compute_compatibility(db: Session, user_a: User, user_b: User) -> CompatibilityOut:
    """
    Explainable compatibility score (0-100):
    - Shared interests: 60%
    - Same university: 20%
    - Same city: 10%
    - Similar event categories: 10%
    Never uses age, gender, ethnicity, religion, or sensitive attributes.
    """
    interests_a = set(_user_interest_names(db, user_a.id))
    interests_b = set(_user_interest_names(db, user_b.id))
    shared_interests = sorted(interests_a & interests_b)

    interest_score = 0.0
    if interests_a and interests_b:
        union_size = len(interests_a | interests_b)
        overlap_ratio = len(shared_interests) / union_size if union_size else 0.0
        # Reward meaningful shared interest overlap smoothly up to full 60 pts
        interest_score = min(60.0, overlap_ratio * 90.0)

    uni_a = (user_a.university or "").strip().lower()
    uni_b = (user_b.university or "").strip().lower()
    same_university = bool(uni_a and uni_b and uni_a == uni_b)
    university_score = 20.0 if same_university else 0.0

    city_a = (user_a.city or "").strip().lower()
    city_b = (user_b.city or "").strip().lower()
    same_city = bool(city_a and city_b and city_a == city_b)
    city_score = 10.0 if same_city else 0.0

    cats_a = _user_event_categories(db, user_a.id)
    cats_b = _user_event_categories(db, user_b.id)
    shared_categories = sorted(cats_a & cats_b)
    category_score = 0.0
    if cats_a and cats_b:
        cat_union = len(cats_a | cats_b)
        category_score = (len(shared_categories) / cat_union) * 10.0 if cat_union else 0.0

    total_score = int(round(min(100.0, max(0.0, interest_score + university_score + city_score + category_score))))

    reasons = []
    if shared_interests:
        preview = ", ".join(shared_interests[:3])
        reasons.append(f"shared interests in {preview}")
    if same_university:
        reasons.append(f"both study at {user_a.university}")
    if same_city and not same_university:
        reasons.append(f"both are based in {user_a.city}")
    if shared_categories:
        reasons.append(f"similar event tastes ({', '.join(shared_categories[:2])})")

    if reasons:
        explanation = "You connect through " + " and ".join(reasons[:2]) + "."
    else:
        explanation = "Fresh match potential — explore upcoming events together to find shared interests."

    return CompatibilityOut(
        compatibility=total_score,
        shared_interests=shared_interests,
        shared_categories=shared_categories,
        explanation=explanation,
    )
