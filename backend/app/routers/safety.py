from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.report import Report
from app.models.user import Block, User
from app.schemas import MessageResponse
from app.schemas.social import (
    REPORT_REASONS,
    BlockOut,
    ReportCreate,
    ReportOut,
    ReportStatusUpdate,
)
from app.security.auth import get_current_user, require_moderator
from app.services.serializers import user_to_public

router = APIRouter(prefix="/safety", tags=["Safety & Moderation"])


@router.post("/block/{user_id}", response_model=BlockOut, status_code=status.HTTP_201_CREATED, summary="Block a user")
def block_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot block yourself.",
        )

    target = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    existing = (
        db.query(Block)
        .filter(Block.blocker_id == current_user.id, Block.blocked_id == user_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already blocked.",
        )

    block = Block(blocker_id=current_user.id, blocked_id=user_id)
    db.add(block)
    db.commit()
    db.refresh(block)
    return BlockOut(
        id=block.id,
        blocked_id=block.blocked_id,
        blocked_user=user_to_public(db, target),
        created_at=block.created_at,
    )


@router.delete("/block/{user_id}", response_model=MessageResponse, summary="Unblock a user")
def unblock_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    block = (
        db.query(Block)
        .filter(Block.blocker_id == current_user.id, Block.blocked_id == user_id)
        .first()
    )
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block record not found.")

    db.delete(block)
    db.commit()
    return MessageResponse(message="User unblocked successfully.")


@router.get("/blocked", response_model=List[BlockOut], summary="List users blocked by current user")
def list_blocked_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Block)
        .filter(Block.blocker_id == current_user.id)
        .order_by(Block.created_at.desc())
        .all()
    )
    return [
        BlockOut(
            id=row.id,
            blocked_id=row.blocked_id,
            blocked_user=user_to_public(db, row.blocked),
            created_at=row.created_at,
        )
        for row in rows
        if row.blocked is not None
    ]


@router.post("/report", response_model=ReportOut, status_code=status.HTTP_201_CREATED, summary="Report a user")
def report_user(
    payload: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.reported_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot report yourself.",
        )

    cleaned_reason = payload.reason.strip().lower()
    if cleaned_reason not in REPORT_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid report reason. Allowed reasons: {', '.join(REPORT_REASONS)}",
        )

    target = db.query(User).filter(User.id == payload.reported_user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reported user not found.")

    report = Report(
        reporter_id=current_user.id,
        reported_user_id=payload.reported_user_id,
        reason=cleaned_reason,
        description=payload.description.strip() if payload.description else None,
        status="pending",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return ReportOut.model_validate(report, from_attributes=True)


@router.get("/reports", response_model=List[ReportOut], summary="Inspect moderation reports (moderators only)")
def list_reports(
    _moderator: User = Depends(require_moderator),
    db: Session = Depends(get_db),
):
    rows = db.query(Report).order_by(Report.created_at.desc()).all()
    return [ReportOut.model_validate(row, from_attributes=True) for row in rows]


@router.put("/reports/{report_id}", response_model=ReportOut, summary="Update report moderation status (moderators only)")
def update_report_status(
    report_id: int,
    payload: ReportStatusUpdate,
    _moderator: User = Depends(require_moderator),
    db: Session = Depends(get_db),
):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    report.status = payload.status
    db.add(report)
    db.commit()
    db.refresh(report)
    return ReportOut.model_validate(report, from_attributes=True)
