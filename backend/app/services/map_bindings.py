"""Operator-managed catalog overrides, saved atomically outside the source tree."""
import asyncio
import hashlib
import json
import os
import uuid
from pathlib import Path
from app.config import settings

lock = asyncio.Lock()


def path():
    return settings.RCS_DATA_DIR / 'map-bindings.json'


def read():
    file = path()
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}


def revision():
    file = path()
    content = file.read_bytes() if file.exists() else b''
    registry = os.getenv('ROS_MAP_CATALOG')
    source = Path(registry).read_bytes() if registry else b''
    return hashlib.sha256(content+b'\0'+source).hexdigest()


def save(key, binding):
    rows = read()
    rows[key] = binding
    file = path()
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temporary.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temporary, file)
    finally:
        temporary.unlink(missing_ok=True)
