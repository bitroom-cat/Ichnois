"""Configuration settings for ZONE 2: DMZ / EDGE SERVER (SERVER A) Standalone Ingestion Gateway."""

import os
from pydantic import BaseModel, Field


class GatewayConfig(BaseModel):
    """Runtime configuration for the hardened edge telemetry sensor."""

    # Server Bindings
    host: str = Field(default_factory=lambda: os.getenv("EDGE_GATEWAY_HOST", "0.0.0.0"))
    port: int = Field(default_factory=lambda: int(os.getenv("PORT", os.getenv("EDGE_GATEWAY_PORT", "8080"))))
    
    # 1. Origin Whitelisting & CORS
    allowed_origins: list[str] = Field(
        default_factory=lambda: os.getenv("EDGE_ALLOWED_ORIGINS", "*").split(",")
    )
    
    # 2. Slowloris & DoS Protection
    read_timeout_seconds: float = Field(default=2.5)  # Max time allowed to stream payload body
    
    # 3. Hard Request Body Ceiling
    max_body_bytes: int = Field(default=51200)  # Max 50KB strictly enforced
    
    # 4. Anti-Attack Parameters
    max_json_depth: int = Field(default=10)  # Max nesting depth to stop recursion attacks
    
    # 5. Project DSN / Key Authentication
    allowed_project_keys: set[str] = Field(
        default_factory=lambda: set(
            os.getenv(
                "EDGE_ALLOWED_PROJECT_KEYS",
                "demo_key,prod_client_key,default_public_key,sentry_public_key",
            ).split(",")
        )
    )
    enforce_auth_whitelist: bool = Field(
        default_factory=lambda: os.getenv("EDGE_ENFORCE_AUTH_WHITELIST", "false").lower() == "true"
    )
    
    # 6. Leaky-Bucket Rate Limiting
    ip_rate_limit_per_min: int = Field(default=60)
    project_rate_limit_per_min: int = Field(default=120)
    
    # Target Internal Server B (Core Platform)
    internal_core_url: str = Field(
        default_factory=lambda: os.getenv(
            "INTERNAL_CORE_URL", "http://127.0.0.1:8000/internal/v1/incidents/ingress"
        )
    )
    internal_gateway_secret: str = Field(
        default_factory=lambda: os.getenv(
            "INTERNAL_GATEWAY_SECRET", "ichnoscope-internal-gateway-token-v2"
        )
    )


_config: GatewayConfig | None = None


def get_gateway_config() -> GatewayConfig:
    """Return singleton gateway configuration."""
    global _config
    if _config is None:
        _config = GatewayConfig()
    return _config
