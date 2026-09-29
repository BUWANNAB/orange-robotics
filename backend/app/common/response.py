from typing import Any, Optional
from pydantic import BaseModel

class BaseResponse(BaseModel):
    code: int = 0
    data: Optional[Any] = None
    message: str = "ok"
    description: str = ""

def ok(data: Any = None, message: str = "ok") -> dict:
    return {
        "code": 0,
        "data": data,
        "message": message,
        "description": ""
    }

def error(code: int = 50000, message: str = "error", description: str = "") -> dict:
    return {
        "code": code,
        "data": None,
        "message": message,
        "description": description
    }
