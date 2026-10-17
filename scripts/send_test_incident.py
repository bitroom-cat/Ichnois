"""Live Incident Trigger Script using Sentry SDK.

Dispatches a simulated runtime incident to Ichnoscope using the official `sentry_sdk`.

Usage:
    python scripts/send_test_incident.py
    python scripts/send_test_incident.py --scenario payment_crash
    python scripts/send_test_incident.py --local
"""

import argparse
import sys
import time

# Ensure Windows terminal prints unicode cleanly
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import sentry_sdk
import sentry_sdk.utils

# ---------------------------------------------------------------------------
# SENTRY SDK COMPATIBILITY HELPER
# Standard Sentry Python SDK historically expects numeric project IDs (e.g. /123).
# This patch enables sentry_sdk to accept modern alphanumeric project IDs
# (e.g. proj_87930f560b9d) and cleanly normalize paths containing "/api/".
# ---------------------------------------------------------------------------
_orig_dsn_init = sentry_sdk.utils.Dsn.__init__


def _safe_dsn_init(self, value, org_id=None):
    try:
        _orig_dsn_init(self, value, org_id)
    except Exception:
        from urllib.parse import urlsplit

        parts = urlsplit(str(value))
        self.scheme = parts.scheme
        self.host = parts.hostname
        self.org_id = org_id
        self.port = parts.port or (443 if parts.scheme == "https" else 80)
        self.public_key = parts.username
        self.secret_key = parts.password
        clean_path = parts.path.strip("/")
        # Extract project_id from path (e.g. 'api/proj_87930f560b9d' -> 'proj_87930f560b9d')
        self.project_id = clean_path.split("/")[-1] if clean_path else "1"
        self.path = "/"


sentry_sdk.utils.Dsn.__init__ = _safe_dsn_init


# Default target DSN provided for your microservice
DEFAULT_DSN = "https://pk_live_9480104f362749e1f7e5b78ff7a0ca14@ichnoisapi.onrender.com/api/proj_87930f560b9d"
LOCAL_DSN = "http://pk_live_checkout001@127.0.0.1:8000/api/checkout-service"


def trigger_incident(dsn: str, scenario: str = "payment_crash", environment: str = "production"):
    print("\n" + "=" * 70)
    print("🚀  ICHNOSCOPE SENTRY SDK INCIDENT DISPATCHER")
    print("=" * 70)
    print(f"🎯 Target DSN    : {dsn}")
    print(f"🏷️  Environment   : {environment}")
    print(f"📦 Scenario      : {scenario}")
    print("-" * 70)

    # 1. Initialize Sentry SDK
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        traces_sample_rate=1.0,
        release="v2.4.0-prod",
        send_default_pii=True,
    )

    # 2. Add realistic breadcrumbs & context
    sentry_sdk.set_user({"id": "usr_94812", "email": "customer_alice@example.com", "username": "alice_buyer"})
    sentry_sdk.set_tag("service", "checkout-service")
    sentry_sdk.set_tag("datacenter", "aws-us-east-1")
    sentry_sdk.set_context(
        "order_details",
        {
            "cart_id": "cart_88712a",
            "items_count": 3,
            "currency": "USD",
            "amount": 149.99,
        },
    )

    sentry_sdk.add_breadcrumb(category="http", message="POST /api/v1/checkout/session - 200 OK", level="info")
    sentry_sdk.add_breadcrumb(category="payment", message="Invoking Stripe gateway provider", level="info")

    # 3. Simulate realistic in-app production error
    print("⚡ Triggering simulated application exception...")
    start_time = time.perf_counter()
    event_id = None

    try:
        if scenario == "payment_crash":
            # Simulate Stripe missing token crash
            customer_payload = {"user_id": "usr_94812", "payment_method": {}}
            _token = customer_payload["payment_method"]["stripe_token"]  # Raises KeyError: 'stripe_token'
        elif scenario == "db_timeout":
            raise TimeoutError("Database connection pool exhausted (timeout after 5000ms)")
        elif scenario == "attribute_error":
            cart = None
            _total = cart.calculate_total()  # Raises AttributeError
        else:
            raise RuntimeError(f"Unhandled incident scenario: {scenario}")

    except Exception as exc:
        event_id = sentry_sdk.capture_exception(exc)
        print(f"📤 Captured via sentry_sdk.capture_exception()")
        print(f"🆔 Generated Event ID: {event_id}")

    # 4. Flush SDK event buffer to network
    print("⏳ Flushing Sentry SDK transport buffer to Ichnoscope...")
    sentry_sdk.flush(timeout=5.0)
    latency_ms = (time.perf_counter() - start_time) * 1000

    print("-" * 70)
    print("✅ Incident successfully dispatched!")
    print(f"⚡ Elapsed Time : {latency_ms:.1f} ms")
    print(f"🆔 Event ID     : {event_id}")
    print("\n👉 View your staged incident in the Ichnoscope Dashboard:")
    print("   🔗 Local:   http://localhost:3000/app/runs")
    print("   🔗 Cloud:   https://ichnoscope-wcc-30.vercel.app/app/runs")
    print("=" * 70 + "\n")
    return event_id


def main():
    parser = argparse.ArgumentParser(description="Trigger an incident via Sentry SDK to Ichnoscope.")
    parser.add_argument(
        "--dsn",
        default=DEFAULT_DSN,
        help="Sentry DSN (defaults to your live Render gateway DSN)",
    )
    parser.add_argument(
        "--scenario",
        default="payment_crash",
        choices=["payment_crash", "db_timeout", "attribute_error"],
        help="Error scenario to simulate (default: payment_crash)",
    )
    parser.add_argument(
        "--env",
        default="production",
        help="Environment tag (default: production)",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="Send to local FastAPI dev server (port 8000) instead of Render cloud",
    )

    args = parser.parse_args()
    target_dsn = LOCAL_DSN if args.local else args.dsn
    trigger_incident(dsn=target_dsn, scenario=args.scenario, environment=args.env)


if __name__ == "__main__":
    main()
