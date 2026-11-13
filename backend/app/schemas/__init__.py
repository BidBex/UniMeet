"""Pydantic request and response schemas package."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    environment: str
    database: str


class MessageResponse(BaseModel):
    message: str
