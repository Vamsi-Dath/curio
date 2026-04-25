"""Tests for security.py — hashing, token generation, constant-time compare."""

from utk_curio.backend.app.users.security import (
    constant_time_compare,
    hash_password,
    new_session_token,
    verify_password,
)


def test_hash_and_verify():
    hashed = hash_password("hunter2")
    assert verify_password(hashed, "hunter2")


def test_wrong_password_rejected():
    hashed = hash_password("correct")
    assert not verify_password(hashed, "wrong")


def test_session_tokens_unique():
    tokens = {new_session_token() for _ in range(100)}
    assert len(tokens) == 100


def test_constant_time_compare_equal():
    assert constant_time_compare("abc", "abc")


def test_constant_time_compare_unequal():
    assert not constant_time_compare("abc", "xyz")
