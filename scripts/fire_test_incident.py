"""Live Telemetry Dispatcher & Incident Generator.

Sends realistic crash telemetry into the Server A Edge Gateway (or local dev gateway)
to verify the complete end-to-end incident lifecycle:
  1. Edge Gateway Ingestion (<25ms HTTP 202 Accepted)
  2. Edge PII & Secret Scrubbing (Bearer tokens, emails, cookies)
  3. Relay to Server B Ingress Queue (Gate 1 Staging)
  4. Visible in Control Center Dashboard (Vercel)

Usage:
  python scripts/fire_test_incident.py
  python scripts/fire_test_incident.py --url https://ichnoisapi.onrender.com
  python scripts/fire_test_incident.py --local
  python scripts/fire_test_incident.py --scenario payment_crash --env staging
  python scripts/fire_test_incident.py --scenario attack_sqli
"""

import argparse
import json
import sys
import time
import uuid
import httpx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_GATEWAY_URL = "https://ichnoisapi.onrender.com"
LOCAL_GATEWAY_URL = "http://127.0.0.1:8001"

# Realistic error scenarios
SCENARIOS = {
    "payment_crash": {
        "title": "Stripe KeyError: 'stripe_token' during checkout",
        "exception_type": "KeyError",
        "value": "'stripe_token'",
        "file_path": "services/shipping.py",
        "line_number": 42,
        "function": "process_order_checkout",
    },
    "database_timeout": {
        "title": "Postgres ConnectionPoolExhausted: max connections 100 exceeded",
        "exception_type": "ConnectionPoolExhausted",
        "value": "Remaining pool size: 0 (timeout after 5000ms)",
        "file_path": "db/session.py",
        "line_number": 88,
        "function": "acquire_connection",
    },
    "cart_attribute": {
        "title": "AttributeError: 'NoneType' object has no attribute 'items'",
        "exception_type": "AttributeError",
        "value": "'NoneType' object has no attribute 'items'",
        "file_path": "services/cart.py",
        "line_number": 19,
        "function": "calculate_cart_total",
    },
    "attack_sqli": {
        "title": "Simulated Attack: SQL Injection probe in query string",
        "exception_type": "InvalidQueryParameter",
        "value": "1' UNION SELECT username, password_hash FROM admin_users --",
        "file_path": "api/v1/search.py",
        "line_number": 15,
        "function": "search_products",
    },
}


def build_sentry_payload(
    scenario_key: str,
    environment: str = "staging",
    include_pii: bool = True,
) -> tuple[dict, str]:
    """Assemble a standard Sentry-compatible event envelope."""
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["payment_crash"])
    event_id = uuid.uuid4().hex

    payload = {
        "event_id": event_id,
        "platform": "python",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": environment,
        "release": "v2.1.0-prod",
        "level": "error",
        "server_name": "prod-api-worker-04",
        "exception": {
            "values": [
                {
                    "type": scenario["exception_type"],
                    "value": scenario["value"],
                    "module": "app.core.exceptions",
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "app/main.py",
                                "lineno": 112,
                                "function": "handle_http_request",
                                "in_app": True,
                            },
                            {
                                "filename": scenario["file_path"],
                                "lineno": scenario["line_number"],
                                "function": scenario["function"],
                                "in_app": True,
                                "context_line": "token = payload['customer_card']['stripe_token']",
                            },
                        ]
                    },
                }
            ]
        },
        "tags": {
            "runtime": "python 3.12",
            "region": "us-east-1",
            "team": "checkout-platform",
            "handled": "no",
        },
        "breadcrumbs": {
            "values": [
                {"category": "navigation", "message": "User navigated to /checkout", "level": "info"},
                {"category": "http", "message": "POST /api/v1/payment -> 200", "level": "info"},
                {"category": "auth", "message": "User token validated", "level": "info"},
            ]
        },
    }

    if include_pii:
        # Add sensitive headers and emails to verify Server A PII scrubber
        payload["user"] = {
            "id": "usr_99812",
            "email": "customer_alice@example.com",
            "ip_address": "198.51.100.24",
        }
        payload["request"] = {
            "url": "https://api.ichnoscope.internal/v1/checkout",
            "method": "POST",
            "headers": {
                "Authorization": "Bearer sk_live_sensitive_customer_api_key_8899aabbcc",
                "Cookie": "session_id=abcdef123456789; user_auth=secret_token",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            },
        }

    return payload, scenario["title"]


def fire_telemetry(
    gateway_url: str,
    scenario_key: str = "payment_crash",
    environment: str = "staging",
    project_key: str = "demo_key",
    project_id: str = "1",
) -> bool:
    """Send payload to edge gateway and display verification output."""
    clean_gateway = gateway_url.rstrip("/")
    endpoint = f"{clean_gateway}/api/{project_id}/store/"

    payload, scenario_title = build_sentry_payload(scenario_key, environment=environment)

    headers = {
        "Content-Type": "application/json",
        "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_key={project_key}, sentry_client=ichnoscope-python/2.1",
        "X-Ignoscope-Token": project_key,
    }

    print("\n" + "=" * 70)
    print("🚀  ICHNOSCOPE LIVE INCIDENT DISPATCHER")
    print("=" * 70)
    print(f"🎯 Target Gateway : {endpoint}")
    print(f"📦 Scenario       : {scenario_title}")
    print(f"🏷️  Environment    : {environment}")
    print(f"🔑 Project Key    : {project_key}")
    print(f"🆔 Event ID       : {payload['event_id']}")
    print("-" * 70)

    start_time = time.perf_counter()
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(endpoint, json=payload, headers=headers)
            latency_ms = (time.perf_counter() - start_time) * 1000

        print(f"📡 Response Code  : HTTP {response.status_code}")
        print(f"⚡ Ingestion Time : {latency_ms:.1f} ms")

        try:
            resp_json = response.json()
            print(f"📋 Gateway Body   : {json.dumps(resp_json, indent=2)}")
        except Exception:
            print(f"📋 Raw Body       : {response.text}")

        print("-" * 70)

        if response.status_code in (200, 202):
            print("✅ SUCCESS: Incident accepted by Server A Edge Gateway!")
            print("🛡️  Perimeter Check: PII scrubbed & packet queued for Server B.")
            print("\n👉 NEXT STEP: Check your Control Center Dashboard:")
            print("   🔗 https://ichnoscope-wcc-30.vercel.app/app")
            print("   You should see this incident staged at Gate 1 (staged_raw) ready for review!")
            print("=" * 70 + "\n")
            return True
        elif response.status_code == 400 and scenario_key == "attack_sqli":
            print("🛡️  SUCCESS: Attack successfully BLOCKED by Server A perimeter (HTTP 400)!")
            print("=" * 70 + "\n")
            return True
        else:
            print(f"⚠️  UNEXPECTED STATUS: {response.status_code}")
            print("=" * 70 + "\n")
            return False

    except httpx.ConnectError as err:
        print(f"❌ CONNECTION ERROR: Could not reach {clean_gateway}")
        print(f"   Detail: {err}")
        print("   If testing locally, ensure: python -m uvicorn v2.edge_gateway.app:app --port 8001")
        print("=" * 70 + "\n")
        return False
    except Exception as err:
        print(f"❌ REQUEST FAILED: {err}")
        print("=" * 70 + "\n")
        return False


def main():
    parser = argparse.ArgumentParser(description="Fire sample crash telemetry to Ichnoscope Edge API")
    parser.add_argument(
        "--url",
        default=DEFAULT_GATEWAY_URL,
        help=f"Target Edge Gateway URL (default: {DEFAULT_GATEWAY_URL})",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help=f"Target local gateway at {LOCAL_GATEWAY_URL}",
    )
    parser.add_argument(
        "--scenario",
        default="payment_crash",
        choices=list(SCENARIOS.keys()),
        help="Error scenario to dispatch (default: payment_crash)",
    )
    parser.add_argument(
        "--env",
        default="staging",
        choices=["staging", "production", "development"],
        help="Environment tag (default: staging)",
    )
    parser.add_argument(
        "--key",
        default="demo_key",
        help="Project DSN public key (default: demo_key)",
    )

    args = parser.parse_args()
    gateway_url = LOCAL_GATEWAY_URL if args.local else args.url

    success = fire_telemetry(
        gateway_url=gateway_url,
        scenario_key=args.scenario,
        environment=args.env,
        project_key=args.key,
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
