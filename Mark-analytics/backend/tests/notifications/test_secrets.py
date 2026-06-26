"""HMAC + secret-management tests."""

from __future__ import annotations

import hashlib
import hmac

from app.notifications.secrets import (
    SIGNATURE_HEADER,
    SIGNATURE_PREFIX,
    decrypt_secret,
    encrypt_secret,
    generate_secret,
    hash_secret,
    sign_body,
    verify_signature,
)


def test_signature_header_constants() -> None:
    assert SIGNATURE_HEADER == "X-MK-Signature"
    assert SIGNATURE_PREFIX == "sha256="


def test_sign_body_is_deterministic() -> None:
    body = b'{"event":"x"}'
    secret = "static-key-for-test"
    a = sign_body(secret, body)
    b = sign_body(secret, body)
    assert a == b


def test_sign_body_matches_hand_computed_value() -> None:
    body = b'{"event":"tender.new","id":42}'
    secret = "this-is-a-fixed-secret"

    expected_hex = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    expected = f"sha256={expected_hex}"

    assert sign_body(secret, body) == expected


def test_verify_signature_round_trip() -> None:
    body = b'{"hello":"world"}'
    secret = generate_secret()
    sig = sign_body(secret, body)
    assert verify_signature(secret, body, sig) is True
    assert verify_signature(secret + "tamper", body, sig) is False
    assert verify_signature(secret, body + b"!", sig) is False


def test_hash_secret_is_sha256_hex() -> None:
    plaintext = "abc"
    assert hash_secret(plaintext) == hashlib.sha256(b"abc").hexdigest()


def test_encrypt_decrypt_round_trip() -> None:
    plaintext = "super-secret-value"
    ct = encrypt_secret(plaintext)
    assert ct != plaintext
    assert decrypt_secret(ct) == plaintext


def test_generate_secret_is_random_and_urlsafe() -> None:
    a = generate_secret()
    b = generate_secret()
    assert a != b
    # token_urlsafe alphabet is base64-url (no '+', '/', '=' padding)
    assert all(c.isalnum() or c in "-_" for c in a)
