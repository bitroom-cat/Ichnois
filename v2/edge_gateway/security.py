"""Security inspection & anti-attack perimeter defense for Server A Edge Gateway.

Enforces:
1. Hard body size limit (<= 50KB)
2. JSON recursion/nesting depth limit (<= 10 levels)
3. SQL Injection (SQLi) attack signatures
4. Remote Code Execution (RCE) / JNDI / script payload tokens
"""

import json
import re


class SecurityPerimeterViolation(Exception):
    """Raised when an incoming request breaches edge security guardrails."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# Malicious signature patterns for attack mitigation
SQLI_PATTERNS = [
    re.compile(r"(?i)\b(UNION\s+SELECT|SELECT\s+.+\s+FROM|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM)\b"),
    re.compile(r"(?i)(\bOR\s+['\d]+\s*=\s*['\d]+|--\s*$|\/\*.*\*\/)"),
]

RCE_PATTERNS = [
    re.compile(r"(?i)(\$\{jndi:(?:ldap|rmi|dns)://)"),  # Log4Shell / JNDI
    re.compile(r"(?i)\b(__import__|subprocess\.Popen|os\.system|eval\(|exec\()"),
    re.compile(r"(?i)(/bin/(?:sh|bash)|cmd\.exe|powershell\.exe)"),
    re.compile(r"(?i)(<script[\s\S]*?>|javascript:[\s\S]*?)"),  # Stored XSS attempt
]


def validate_body_size(body_bytes: bytes, max_bytes: int = 51200) -> None:
    """Enforce hard request payload size ceiling (50KB). Immediate HTTP 413 on breach."""
    if len(body_bytes) > max_bytes:
        raise SecurityPerimeterViolation(
            f"Payload size ({len(body_bytes)} bytes) exceeds the strict 50KB perimeter limit ({max_bytes} bytes).",
            status_code=413,
        )


def validate_json_depth(obj: object, max_depth: int = 10, current_depth: int = 1) -> None:
    """Validate JSON nesting depth to stop recursion/parser stack-overflow attacks."""
    if current_depth > max_depth:
        raise SecurityPerimeterViolation(
            f"JSON nesting depth limit ({max_depth} levels) exceeded. Possible recursive attack vector.",
            status_code=400,
        )

    if isinstance(obj, dict):
        for val in obj.values():
            validate_json_depth(val, max_depth, current_depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            validate_json_depth(item, max_depth, current_depth + 1)


def scan_for_malicious_payloads(raw_text: str) -> None:
    """Scan raw payload string for SQLi, RCE, and exploit tokens."""
    for pattern in SQLI_PATTERNS:
        if pattern.search(raw_text):
            raise SecurityPerimeterViolation(
                "Malicious SQL injection pattern detected in telemetry payload.",
                status_code=400,
            )

    for pattern in RCE_PATTERNS:
        if pattern.search(raw_text):
            raise SecurityPerimeterViolation(
                "Malicious RCE or script injection pattern detected in telemetry payload.",
                status_code=400,
            )


def inspect_payload(body_bytes: bytes, max_bytes: int = 51200, max_depth: int = 10) -> dict:
    """Execute complete edge security verification on incoming raw bytes."""
    # 1. Size ceiling check
    validate_body_size(body_bytes, max_bytes)

    # 2. Decode raw string
    try:
        raw_text = body_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SecurityPerimeterViolation("Malformed character encoding (UTF-8 required).", status_code=400) from exc

    # 3. Malicious signature scan
    scan_for_malicious_payloads(raw_text)

    # 4. JSON parsing
    try:
        parsed_json = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise SecurityPerimeterViolation(f"Invalid JSON syntax: {exc.msg}", status_code=400) from exc

    # 5. Nesting depth check
    validate_json_depth(parsed_json, max_depth)

    return parsed_json
