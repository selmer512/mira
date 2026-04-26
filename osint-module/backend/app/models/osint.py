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
    raw: Dict[str, Any] = {}

class Entity(BaseModel):
    entity_type: str
    value: str
    attributes: Dict[str, Any] = {}
    sources: List[SourceRecord] = []

class CorrelationResult(BaseModel):
    profile_id: str
    confidence: float
    entities: List[Entity]
    relationships: List[Dict[str, Any]] = []

class ProfileResponse(BaseModel):
    profile_id: str
    confidence: float
    aliases: List[str] = []
    emails: List[str] = []
    domains: List[str] = []
    websites: List[str] = []
    locations: List[str] = []
    timeline: List[Dict[str, Any]] = []
    sources: List[SourceRecord] = []
