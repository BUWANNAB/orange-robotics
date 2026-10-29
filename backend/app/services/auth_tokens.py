"""Password-bound sessions: changing a password invalidates every prior login."""
import hashlib
import hmac
import secrets
import time

from fastapi import HTTPException
from app.config import settings


def generate_token(account: str, password_hash: str) -> str:
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)
    payload = f"{account}:{timestamp}:{nonce}".encode()
    signature = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()
    credential = hmac.new(password_hash.encode(), payload + signature.encode(), hashlib.sha256).hexdigest()
    return f"agv_{account}_{timestamp}_{nonce}.{signature}.{credential}"


def token_account(token: str | None) -> str:
    token = (token or "").removeprefix("Bearer ")
    try:
        prefix, timestamp, proof = token.rsplit("_", 2)
        nonce, signature, credential = proof.split(".")
        if not prefix.startswith("agv_") or not prefix[4:]:
            raise ValueError()
        if len(nonce) != 32 or len(signature) != 64 or len(credential) != 64:
            raise ValueError()
        account = prefix[4:]
        payload = f"{account}:{timestamp}:{nonce}".encode()
        expected = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()
        age = time.time() * 1000 - int(timestamp)
        if not hmac.compare_digest(signature, expected) or not 0 <= age <= settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60000:
            raise ValueError()
        return account
    except (ValueError, TypeError):
        raise HTTPException(401, "登录已失效，请重新登录")


def token_matches_password(token: str, password_hash: str) -> bool:
    prefix, timestamp, proof = token.removeprefix("Bearer ").rsplit("_", 2)
    nonce, signature, credential = proof.split(".")
    payload = f"{prefix[4:]}:{timestamp}:{nonce}".encode()
    expected = hmac.new(password_hash.encode(), payload + signature.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(credential, expected)
