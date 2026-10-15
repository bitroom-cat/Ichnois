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


# High-confidence exploit tokens that are never legitimate in any telemetry field
CRITICAL_EXPLOIT_PATTERNS = [
    re.compile(r"(?i)(\$\{jndi:(?:ldap|rmi|dns)://)"),  # Log4Shell / JNDI injection
    re.compile(r"(?i)(<script[\s\S]*?>|javascript:[\s\S]*?)"),  # Stored XSS attempt
    re.compile(r"(?i)(/bin/(?:sh|bash)|powershell\.exe\s+-e)"),  # Direct shell invocation
]

# Injection patterns inspected on user inputs, headers, and parameters (exempting stack frames)
SUSPICIOUS_INPUT_PATTERNS = [
    re.compile(r"(?i)\bUNION\s+SELECT\b"),
    re.compile(r"(?i)\bDROP\s+TABLE\b"),
    re.compile(r"(?i)\bOR\s+['\d]+\s*=\s*['\d]+"),
    re.compile(r"(?i)\bOR\s+1\s*=\s*1\b"),
    re.compile(r"(?i)--\s*$"),
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


def _scan_obj_for_injection(obj: object, path: str = "") -> None:
    """Recursively scan non-stacktrace object values for injection attack signatures."""
    # Exempt stack traces, frame contexts, and line numbers from SQLi false positives
    lower_path = path.lower()
    if any(exempt in lower_path for exempt in ("stacktrace", "frames", "traceback", "stack_trace")):
        return

    if isinstance(obj, str):
        for pattern in CRITICAL_EXPLOIT_PATTERNS:
            if pattern.search(obj):
                raise SecurityPerimeterViolation(
                    "Malicious RCE or script injection pattern detected in telemetry payload.",
                    status_code=400,
                )
        for pattern in SUSPICIOUS_INPUT_PATTERNS:
            if pattern.search(obj):
                raise SecurityPerimeterViolation(
                    "Malicious SQL injection pattern detected in telemetry payload.",
                    status_code=400,
                )
    elif isinstance(obj, dict):
        for k, v in obj.items():
            new_path = f"{path}.{k}" if path else k
            _scan_obj_for_injection(v, new_path)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _scan_obj_for_injection(item, f"{path}[{i}]")


def inspect_payload(body_bytes: bytes, max_bytes: int = 51200, max_depth: int = 10) -> dict:
    """Execute complete edge security verification on incoming raw bytes."""
    # 1. Size ceiling check
    validate_body_size(body_bytes, max_bytes)

    # 2. Decode raw string
    try:
        raw_text = body_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SecurityPerimeterViolation("Malformed character encoding (UTF-8 required).", status_code=400) from exc

    # 3. JSON parsing
    try:
        parsed_json = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise SecurityPerimeterViolation(f"Invalid JSON syntax: {exc.msg}", status_code=400) from exc

    # 4. Nesting depth check
    validate_json_depth(parsed_json, max_depth)

    # 5. Targeted security scan (exempting legitimate stack traces)
    _scan_obj_for_injection(parsed_json)

    return parsed_json

