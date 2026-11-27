"""Short-lived cursors bound to their query, workspace and ordering."""

import base64
import hashlib
import hmac
import json
import os
import time

from .core import DomainError


def _keys():
    return [base64.urlsafe_b64decode(value) for value in json.loads(os.environ["SOURCES_HMAC_KEYS"]).values()]


def _mac(key, message):
    return hmac.digest(key, b"source-page-v1\0" + message, hashlib.sha256)


def page_token(scope: dict, last: str) -> str:
    data = json.dumps([scope, last, int(time.time()) + 900], sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(_mac(_keys()[0], data) + data).decode()


def read_token(token: str, scope: dict) -> str:
    try:
        if len(token) > 8192:
            raise ValueError
        packed = base64.b64decode(token, altchars=b"-_", validate=True)
        signature, data = packed[:32], packed[32:]
        if not any(hmac.compare_digest(signature, _mac(key, data)) for key in _keys()):
            raise ValueError
        original, last, expires = json.loads(data)
        if original != scope or not isinstance(last, str):
            raise ValueError
        if expires <= time.time():
            raise DomainError(410, "cursor_expired", "Start again at the first page.")
        return last
    except (ValueError, TypeError, UnicodeError):
        raise DomainError(400, "invalid_cursor", "This cursor is invalid for the current list.") from None
