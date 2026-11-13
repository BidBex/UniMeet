from collections import defaultdict
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.group import Group, GroupMember
from app.models.user import User
from app.schemas.event import EventOut
from app.schemas.social import CommunityOut, GroupOut, UniversityStatsOut
from app.security.auth import get_optional_current_user
from app.services.compatibility import compute_compatibility
from app.services.serializers import event_to_out, get_blocked_user_ids, user_to_public

router = APIRouter(prefix="/community", tags=["University Community"])


@router.get("", response_model=CommunityOut, summary="Explore university community hub")
def get_community(
    university: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    target_uni = university.strip() if university else (current_user.university if current_user else None)
    blocked = get_blocked_user_ids(db, current_user.id) if current_user else set()

    user_q = db.query(User).filter(User.is_active.is_(True))
    if current_user:
        user_q = user_q.filter(User.id != current_user.id)
    if blocked:
        user_q = user_q.filter(~User.id.in_(blocked))
    if target_uni:
        user_q = user_q.filter(User.university.ilike(f"%{target_uni}%"))
    if city:
        user_q = user_q.filter(User.city.ilike(f"%{city.strip()}%"))

    students_raw = user_q.order_by(User.created_at.desc()).limit(24).all()
    students = []
    for stu in students_raw:
        compat = compute_compatibility(db, current_user, stu) if current_user else None
        students.append(user_to_public(db, stu, compatibility=compat))

    event_q = db.query(Event).filter(Event.is_active.is_(True))
    if blocked:
        event_q = event_q.filter(~Event.creator_id.in_(blocked))
    if target_uni:
        event_q = event_q.filter(Event.university.ilike(f"%{target_uni}%"))
    if city:
        event_q = event_q.filter(Event.city.ilike(f"%{city.strip()}%"))
    events_raw = event_q.order_by(Event.start_datetime.asc()).limit(20).all()
    uid = current_user.id if current_user else None
    events = [event_to_out(db, ev, current_user_id=uid) for ev in events_raw]

    group_q = db.query(Group).filter(Group.is_public.is_(True))
    if blocked:
        group_q = group_q.filter(~Group.creator_id.in_(blocked))
    if target_uni:
        group_q = group_q.filter(Group.university.ilike(f"%{target_uni}%"))
    if city:
        group_q = group_q.filter(Group.location.ilike(f"%{city.strip()}%"))
    groups_raw = group_q.order_by(Group.created_at.desc()).limit(20).all()
    groups: List[GroupOut] = []
    for grp in groups_raw:
        active_count = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == grp.id, GroupMember.status == "active")
            .count()
        )
        membership = None
        if current_user:
            membership = (
                db.query(GroupMember)
                .filter(GroupMember.group_id == grp.id, GroupMember.user_id == current_user.id)
                .first()
            )
        groups.append(
            GroupOut(
                id=grp.id,
                name=grp.name,
                description=grp.description,
                creator_id=grp.creator_id,
                event_id=grp.event_id,
                event_title=grp.event.title if grp.event else None,
                max_members=grp.max_members,
                member_count=active_count,
                is_public=grp.is_public,
                university=grp.university,
                location=grp.location,
                interests_summary=grp.interests_summary,
                is_member=membership is not None and membership.status == "active",
                membership_status=membership.status if membership else None,
                conversation_id=None,
                created_at=grp.created_at,
            )
        )

    return CommunityOut(
        university=target_uni,
        students=students,
        events=events,
        groups=groups,
    )


@router.get("/universities", response_model=List[UniversityStatsOut], summary="List universities with activity counts")
def list_universities(db: Session = Depends(get_db)):
    stats = defaultdict(lambda: {"students": 0, "events": 0, "groups": 0})

    for (uni,) in db.query(User.university).filter(User.is_active.is_(True), User.university.isnot(None)).all():
        clean = uni.strip()
        if clean:
            stats[clean]["students"] += 1

    for (uni,) in db.query(Event.university).filter(Event.is_active.is_(True), Event.university.isnot(None)).all():
        clean = uni.strip()
        if clean:
            stats[clean]["events"] += 1

    for (uni,) in db.query(Group.university).filter(Group.is_public.is_(True), Group.university.isnot(None)).all():
        clean = uni.strip()
        if clean:
            stats[clean]["groups"] += 1

    result = [
        UniversityStatsOut(
            university=uni,
            student_count=counts["students"],
            event_count=counts["events"],
            group_count=counts["groups"],
        )
        for uni, counts in sorted(stats.items(), key=lambda kv: kv[0])
    ]
    return result


@router.get("/events", response_model=List[EventOut], summary="List university-related events")
def list_university_events(
    university: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Event).filter(Event.is_active.is_(True))
    if current_user:
        blocked = get_blocked_user_ids(db, current_user.id)
        if blocked:
            query = query.filter(~Event.creator_id.in_(blocked))

    if university:
        query = query.filter(Event.university.ilike(f"%{university.strip()}%"))
    else:
        query = query.filter(Event.university.isnot(None))

    if city:
        query = query.filter(Event.city.ilike(f"%{city.strip()}%"))
    if category:
        query = query.filter(Event.category.ilike(category.strip()))

    rows = query.order_by(Event.start_datetime.asc()).all()
    uid = current_user.id if current_user else None
    return [event_to_out(db, ev, current_user_id=uid) for ev in rows]
