"""Per-rule webhook secret handling.

Generation, hashing, encryption-at-rest, and HMAC signing for the WEBHOOK
channel.

Design (see commit body for the HMAC-vs-AES decision):

* On create we generate a 32-byte random secret encoded as URL-safe base64.
* The plaintext is returned in the create response **once** so the consumer
  can store it on their end.
* In DB we keep two derived values inside ``alert_rules.channel_config``:
    - ``secret_hash`` — sha256 hex of the plaintext, used by receivers (or
      auditors with DB access) to verify a presented secret without ever
      keeping the plaintext.
    - ``secret_ciphertext`` — Fernet-encrypted plaintext, used by the
      dispatcher to compute the outbound ``X-MK-Signature`` HMAC. Without
      this, a server with only the hash could not sign outbound traffic;
      with this, an attacker who steals the DB but not ``SECRET_KEY``
      still cannot sign.

The HMAC itself uses the **plaintext** secret as the key and SHA-256 over the
raw outbound body bytes. Header format: ``X-MK-Signature: sha256=<hex>``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

SECRET_BYTES = 32
SIGNATURE_HEADER = "X-MK-Signature"
SIGNATURE_PREFIX = "sha256="


def generate_secret() -> str:
    """Return a fresh URL-safe random secret (~43 chars)."""
    return secrets.token_urlsafe(SECRET_BYTES)


def hash_secret(plaintext: str) -> str:
    """Return sha256 hex of the secret — irreversible."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _fernet() -> Fernet:
    """Derive a Fernet key from ``settings.SECRET_KEY``.

    We hash the configured app secret to 32 bytes, then base64-url-encode it
    to satisfy Fernet's key format. This means rotating ``SECRET_KEY``
    invalidates stored ciphertexts — callers must re-issue webhook secrets in
    that case.
    """
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt the secret for at-rest storage."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a previously :func:`encrypt_secret`'d value.

    Raises :class:`cryptography.fernet.InvalidToken` if the ciphertext was
    produced with a different ``SECRET_KEY`` (or has been tampered with).
    """
    return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")


def sign_body(secret_plaintext: str, body: bytes) -> str:
    """Compute the header value for ``X-MK-Signature``.

    Deterministic: same key + same body bytes always produce the same hex
    digest. Receivers verify by computing the same HMAC and comparing with
    :func:`hmac.compare_digest`.
    """
    mac = hmac.new(
        secret_plaintext.encode("utf-8"),
        msg=body,
        digestmod=hashlib.sha256,
    ).hexdigest()
    return f"{SIGNATURE_PREFIX}{mac}"


def verify_signature(secret_plaintext: str, body: bytes, header: str) -> bool:
    """Constant-time verification helper for receivers / tests."""
    expected = sign_body(secret_plaintext, body)
    return hmac.compare_digest(expected, header)


def safe_decrypt(ciphertext: str) -> str | None:
    """Best-effort decrypt — returns ``None`` if ciphertext is unreadable."""
    try:
        return decrypt_secret(ciphertext)
    except InvalidToken:
        return None
