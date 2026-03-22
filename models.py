"""
Data models for API Key Manager
"""
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field, field_validator, constr, root_validator
from enum import Enum


class KeyStatus(str, Enum):
    """API Key status enumeration"""
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    ROTATED = "rotated"


class KeyType(str, Enum):
    """API Key type enumeration"""
    PERSONAL = "personal"
    BUSINESS = "business"
    TEMPORARY = "temporary"


class APIKeyCreate(BaseModel):
    """Schema for creating an API key"""
    name: constr(strip_whitespace=True, min_length=1, max_length=100) = Field(
        description="Key name/label"
    )
    user_email: EmailStr = Field(
        description="Associated user email"
    )
    key_type: KeyType = Field(
        default=KeyType.PERSONAL,
        description="Type of API key"
    )
    expires_in_hours: Optional[int] = Field(
        default=None,
        ge=1,
        le=8760,  # Max 1 year
        description="Key expiration in hours"
    )
    rate_limit: int = Field(
        default=100,
        ge=1,
        le=10000,
        description="Requests per hour limit"
    )

    @field_validator('user_email')
    @classmethod
    def validate_email(cls, v: EmailStr) -> EmailStr:
        """Validate email format"""
        return v

    @root_validator
    def validate_expiration(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Validate that expires_in_hours is set when key_type is TEMPORARY"""
        if values.get('key_type') == KeyType.TEMPORARY and not values.get('expires_in_hours'):
            raise ValueError('Temporary keys must have expiration time')
        return values


class APIKeyResponse(BaseModel):
    """Schema for API key response"""
    id: str
    name: str
    user_email: str
    key_value: Optional[str] = Field(None, exclude=True)  # Only in create response
    created_at: datetime
    expires_at: Optional[datetime]
    last_used: Optional[datetime]
    rate_limit: int
    status: KeyStatus
    key_type: KeyType

    model_config = {'from_attributes': True}


class APIKeyDetail(APIKeyResponse):
    """Schema for detailed API key information"""
    is_expired: bool
    is_rotated: bool
    is_revoked: bool


class KeyRotateRequest(BaseModel):
    """Schema for rotating an API key"""
    reason: constr(strip_whitespace=True, min_length=1, max_length=200) = Field(
        description="Reason for rotation"
    )


class KeyRotateResponse(BaseModel):
    """Schema for key rotation response"""
    old_key_id: str
    new_key_value: str
    old_key_status: KeyStatus
    new_key_status: KeyStatus
    rotated_at: datetime


class KeyUsage(BaseModel):
    """Schema for key usage statistics"""
    key_id: str
    requests_today: int
    requests_month: int
    last_request: Optional[datetime]
    status: KeyStatus


class ErrorResponse(BaseModel):
    """Schema for error responses"""
    error: str
    message: str
    details: Optional[Dict[str, Any]] = None
    status_code: int


class SuccessResponse(BaseModel):
    """Schema for success responses"""
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None