from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.auth import UserPublicOut

EVENT_CATEGORIES = [
    "Concerts",
    "Parties",
    "Cinema",
    "Theatre",
    "Festivals",
    "Sports",
    "Food",
    "Travel",
    "Gaming",
    "Other",
]


class EventCreate(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=4000)
    category: str = Field(min_length=2, max_length=60)
    location: str = Field(min_length=2, max_length=200)
    city: str = Field(min_length=2, max_length=100)
    university: Optional[str] = Field(default=None, max_length=150)
    start_datetime: datetime
    end_datetime: Optional[datetime] = None
    image_url: Optional[str] = Field(default=None, max_length=500)
    max_participants: Optional[int] = Field(default=None, ge=2, le=5000)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in EVENT_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(EVENT_CATEGORIES)}")
        return cleaned


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=160)
    description: Optional[str] = Field(default=None, min_length=10, max_length=4000)
    category: Optional[str] = Field(default=None, min_length=2, max_length=60)
    location: Optional[str] = Field(default=None, min_length=2, max_length=200)
    city: Optional[str] = Field(default=None, min_length=2, max_length=100)
    university: Optional[str] = Field(default=None, max_length=150)
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    image_url: Optional[str] = Field(default=None, max_length=500)
    max_participants: Optional[int] = Field(default=None, ge=2, le=5000)
    is_active: Optional[bool] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if cleaned not in EVENT_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(EVENT_CATEGORIES)}")
        return cleaned


class ParticipantOut(BaseModel):
    id: int
    user_id: int
    status: str
    joined_at: datetime
    user: UserPublicOut


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    category: str
    location: str
    city: str
    university: Optional[str] = None
    start_datetime: datetime
    end_datetime: Optional[datetime] = None
    image_url: Optional[str] = None
    creator_id: int
    creator_name: Optional[str] = None
    max_participants: Optional[int] = None
    participant_count: int = 0
    like_count: int = 0
    is_joined: bool = False
    is_liked: bool = False
    created_at: datetime
    is_active: bool


class EventListOut(BaseModel):
    items: List[EventOut]
    total: int
    page: int
    limit: int
    pages: int
