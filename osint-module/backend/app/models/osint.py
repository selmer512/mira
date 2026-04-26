from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class InputType(str, Enum):
    username = "username"
    email = "email"
    image = "image"
    domain = "domain"
    auto = "auto"


class IngestRequest(BaseModel):
    type: InputType = InputType.auto
    value: str = Field(..., min_length=1)
    source_label: Optional[str] = "manual"


class SourceRecord(BaseModel):
    name: str
    url: Optional[str] = None
    collected_at: Optional[str] = None
    method: str = "public_lookup"
    raw: Dict[str, Any] = Field(default_factory=dict)


class Entity(BaseModel):
    entity_type: str
    value: str
    attributes: Dict[str, Any] = Field(default_factory=dict)
    sources: List[SourceRecord] = Field(default_factory=list)


class CorrelationResult(BaseModel):
    profile_id: str
    confidence: float
    entities: List[Entity]
    relationships: List[Dict[str, Any]] = Field(default_factory=list)


class ProfileResponse(BaseModel):
    profile_id: str
    confidence: float
    aliases: List[str] = Field(default_factory=list)
    emails: List[str] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)
    websites: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    timeline: List[Dict[str, Any]] = Field(default_factory=list)
    sources: List[SourceRecord] = Field(default_factory=list)


class AsyncIngestResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
