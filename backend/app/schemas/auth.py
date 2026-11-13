from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class InterestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str


class CompatibilityOut(BaseModel):
    compatibility: int = Field(ge=0, le=100)
    shared_interests: List[str]
    shared_categories: List[str]
    explanation: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    age: Optional[int] = Field(default=None, ge=16, le=120)
    university: Optional[str] = Field(default=None, max_length=150)
    city: Optional[str] = Field(default=None, max_length=100)

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain at least one letter and one number.")
        return value

    @field_validator("username", "first_name", "last_name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be blank.")
        return cleaned


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255, description="Email or username")
    password: str = Field(min_length=1, max_length=128)


class UserPublicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str
    last_name: str
    age: Optional[int] = None
    university: Optional[str] = None
    city: Optional[str] = None
    bio: Optional[str] = None
    profile_picture: Optional[str] = None
    is_verified: bool = False
    interests: List[InterestOut] = []
    compatibility: Optional[CompatibilityOut] = None


class UserPrivateOut(UserPublicOut):
    email: EmailStr
    is_active: bool
    is_moderator: bool
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserPrivateOut
    access_token: str
    token_type: str = "bearer"
    csrf_token: str


class UserUpdateRequest(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    age: Optional[int] = Field(default=None, ge=16, le=120)
    university: Optional[str] = Field(default=None, max_length=150)
    city: Optional[str] = Field(default=None, max_length=100)
    bio: Optional[str] = Field(default=None, max_length=1000)
    profile_picture: Optional[str] = Field(default=None, max_length=500)


class UserInterestsUpdateRequest(BaseModel):
    interest_ids: List[int] = Field(default_factory=list, max_length=25)


class UserInterestsResponse(BaseModel):
    selected_interests: List[InterestOut]
    available_interests: List[InterestOut]
