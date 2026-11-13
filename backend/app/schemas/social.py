from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.auth import UserPublicOut
from app.schemas.event import EventOut

REPORT_REASONS = [
    "harassment",
    "spam",
    "inappropriate_content",
    "fake_profile",
    "safety_concern",
    "other",
]


class UserLikeRequest(BaseModel):
    receiver_id: int = Field(gt=0)
    event_id: int = Field(gt=0)


class MatchOut(BaseModel):
    id: int
    user1_id: int
    user2_id: int
    event_id: int
    event_title: str
    other_user: UserPublicOut
    conversation_id: Optional[int] = None
    status: str
    created_at: datetime


class LikeResponse(BaseModel):
    liked: bool
    is_match: bool
    match: Optional[MatchOut] = None


class GroupCreate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=5, max_length=2000)
    event_id: Optional[int] = Field(default=None, gt=0)
    max_members: int = Field(default=8, ge=2, le=100)
    is_public: bool = True
    university: Optional[str] = Field(default=None, max_length=150)
    location: Optional[str] = Field(default=None, max_length=150)
    interests_summary: Optional[str] = Field(default=None, max_length=300)


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=120)
    description: Optional[str] = Field(default=None, min_length=5, max_length=2000)
    event_id: Optional[int] = Field(default=None, gt=0)
    max_members: Optional[int] = Field(default=None, ge=2, le=100)
    is_public: Optional[bool] = None
    university: Optional[str] = Field(default=None, max_length=150)
    location: Optional[str] = Field(default=None, max_length=150)
    interests_summary: Optional[str] = Field(default=None, max_length=300)


class GroupMemberOut(BaseModel):
    id: int
    user_id: int
    role: str
    status: str
    joined_at: datetime
    user: UserPublicOut


class GroupOut(BaseModel):
    id: int
    name: str
    description: str
    creator_id: int
    event_id: Optional[int] = None
    event_title: Optional[str] = None
    max_members: int
    member_count: int
    is_public: bool
    university: Optional[str] = None
    location: Optional[str] = None
    interests_summary: Optional[str] = None
    is_member: bool = False
    membership_status: Optional[str] = None
    conversation_id: Optional[int] = None
    created_at: datetime


class GroupInviteRequest(BaseModel):
    user_id: int = Field(gt=0)


class SoloCreate(BaseModel):
    event_id: int = Field(gt=0)
    message: str = Field(min_length=5, max_length=500)
    expires_hours: int = Field(default=48, ge=1, le=336)


class SoloInterestRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=300)


class SoloOut(BaseModel):
    id: int
    user_id: int
    event_id: int
    message: str
    status: str
    created_at: datetime
    expires_at: datetime
    user: UserPublicOut
    event_title: str
    event_city: str
    event_start_datetime: datetime
    interest_count: int = 0
    has_expressed_interest: bool = False


class SoloInterestResponse(BaseModel):
    solo_id: int
    conversation_id: int
    message: str


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    content: str
    created_at: datetime
    is_read: bool


class ConversationOut(BaseModel):
    id: int
    match_id: Optional[int] = None
    group_id: Optional[int] = None
    title: str
    other_user: Optional[UserPublicOut] = None
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0
    created_at: datetime


class ConversationDetailOut(BaseModel):
    conversation: ConversationOut
    messages: List[MessageOut]


class WsTicketOut(BaseModel):
    ticket: str
    expires_in_seconds: int = 30


class BlockOut(BaseModel):
    id: int
    blocked_id: int
    blocked_user: UserPublicOut
    created_at: datetime


class ReportCreate(BaseModel):
    reported_user_id: int = Field(gt=0)
    reason: str = Field(min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=1500)


class ReportOut(BaseModel):
    id: int
    reporter_id: int
    reported_user_id: int
    reason: str
    description: Optional[str] = None
    status: str
    created_at: datetime


class ReportStatusUpdate(BaseModel):
    status: str = Field(pattern=r"^(pending|reviewed|resolved|dismissed)$")


class UniversityStatsOut(BaseModel):
    university: str
    student_count: int
    event_count: int
    group_count: int


class CommunityOut(BaseModel):
    university: Optional[str] = None
    students: List[UserPublicOut]
    events: List[EventOut]
    groups: List[GroupOut]
