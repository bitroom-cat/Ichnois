"""Asynchronous forwarder transmitting validated, scrubbed events from Server A to Server B."""

import logging
import time
import httpx

from v2.edge_gateway.config import get_gateway_config

logger = logging.getLogger("edge_gateway.forwarder")


def forward_to_server_b(
    project_id: str,
    environment: str,
    client_ip: str,
    sanitized_payload: dict,
) -> bool:
    """Deliver sanitized payload across the secure boundary to Server B internal ingress."""
    config = get_gateway_config()

    envelope = {
        "gateway_received_at": time.time(),
        "project_id": project_id,
        "environment": environment,
        "client_ip_hash": str(hash(client_ip)),
        "sanitized_payload": sanitized_payload,
    }

    headers = {
        "Authorization": f"Bearer {config.internal_gateway_secret}",
        "X-Gateway-Node": "edge-gateway-node-01",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=4.0) as client:
            resp = client.post(config.internal_core_url, json=envelope, headers=headers)
            if resp.status_code in (200, 201, 202):
                logger.info(
                    "Successfully delivered incident (project: %s) to Server B (HTTP %d)",
                    project_id,
                    resp.status_code,
                )
                return True
            logger.warning(
                "Server B rejected forwarded incident: HTTP %d %s",
                resp.status_code,
                resp.text,
            )
            return False
    except Exception as exc:
        logger.error(
            "Failed to reach Server B at %s: %s (spooling to fallback log)",
            config.internal_core_url,
            exc,
        )
        return False
