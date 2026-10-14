// Typed mock layer per Section 5 of the design prompt.
// Contains 12 realistic production incident runs covering every status and edge case.

export type RunStatus =
  | 'received'
  | 'parsing'
  | 'blaming'
  | 'explaining'
  | 'draft_ready'
  | 'published'
  | 'rejected'
  | 'failed'
  | 'suppressed';

export type Severity = 'P1-Critical' | 'P2-High' | 'P3-Medium';

export interface RunSummary {
  id: string;
  status: RunStatus;
  severity: Severity;
  exceptionType: string;
  errorMessage: string;
  filePath: string;
  lineNumber: number;
  suspect: { login: string | null; name: string } | null;
  confidence: 'high' | 'low';
  eventCount: number;
  sparkline: number[]; // 24 buckets
  createdAt: string;
  updatedAt: string;
  issueUrl?: string;
}

export interface StackFrame {
  file: string;
  line: number;
  fn: string;
  inApp: boolean;
  context?: string[];
}

export interface Culprit {
  sha: string;
  message: string;
  committedAt: string;
  prNumber?: number;
  diff: string;
  withinWindow: boolean;
}

export interface Explanation {
  domain: string;
  hypothesis: string;
  checklist: string[];
}

export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  step: string;
  message: string;
}

export interface PipelineStep {
  name: 'parse' | 'blame' | 'explain' | 'draft' | 'publish';
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  ms?: number;
}

export interface RunDetail extends RunSummary {
  releaseSha: string;
  environment: string;
  fingerprint: string;
  stackFrames: StackFrame[];
  culprit: Culprit | null;
  explanation: Explanation | null;
  draftMarkdown: string;
  draft_title?: string;
  draft_body?: string;
  custom_assignee?: string;
  gate_reviews?: any[];
  logs: LogEntry[];
  steps: PipelineStep[];
}

export const MOCK_RUNS: RunDetail[] = [
  // 1. draft_ready - P1 Critical, High confidence (Fresh regression)
  {
    id: 'run-901',
    status: 'draft_ready',
    severity: 'P1-Critical',
    exceptionType: 'IndexError',
    errorMessage: 'list index out of range in get_applied_discounts',
    filePath: 'services/checkout_service.py',
    lineNumber: 142,
    suspect: { login: 'alexparker', name: 'Alex Parker' },
    confidence: 'high',
    eventCount: 148,
    sparkline: [2, 5, 8, 3, 6, 12, 18, 24, 30, 42, 60, 45, 30, 15, 8, 4, 3, 2, 2, 5, 9, 14, 22, 38],
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    releaseSha: 'a89f30b91d29ec49b168',
    environment: 'production',
    fingerprint: 'e89c314b09f1',
    stackFrames: [
      { file: 'gunicorn/workers/base.py', line: 120, fn: 'handle_request', inApp: false },
      { file: 'fastapi/routing.py', line: 204, fn: 'app', inApp: false },
      { file: 'api/v2/checkout.py', line: 88, fn: 'post_checkout', inApp: true, context: ['receipt = process_cart_discounts(cart_context)'] },
      { file: 'services/checkout_service.py', line: 142, fn: 'process_cart_discounts', inApp: true, context: ['primary_tier = active_vouchers[0].tier_multiplier'] },
    ],
    culprit: {
      sha: 'a89f30b',
      message: 'feat(checkout): add promotional tier multipliers (PR-144)',
      committedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      prNumber: 144,
      diff: `@@ -139,4 +139,6 @@ def process_cart_discounts(cart_context):
     if not cart_context.has_items():
         return None
-    return calculate_standard_discount(cart_context)
+    active_vouchers = cart_context.voucher_list
+    primary_tier = active_vouchers[0].tier_multiplier
+    return calculate_tiered_discount(cart_context, primary_tier)`,
      withinWindow: true,
    },
    explanation: {
      domain: 'backend',
      hypothesis:
        'Commit a89f30b directly accesses index 0 on active_vouchers without checking if the voucher list is non-empty. When a user checks out without an applied promotional voucher, an unhandled IndexError is raised.',
      checklist: [
        'Add boundary guard: if not active_vouchers: return calculate_standard_discount(cart_context)',
        'Verify zero-voucher checkout test case in test_checkout_service.py',
        'Verify order confirmation receipt generation in staging',
      ],
    },
    draftMarkdown: `## [Auto-triage] IndexError: list index out of range in get_applied_discounts

**Severity:** P1-Critical  **Domain:** \`backend\`  **Confidence:** high
**Failing line:** \`services/checkout_service.py:142\`
**Suspect:** @alexparker via a89f30b (PR-144)
**Last changed:** 2 hours ago (recent change, likely regression)

### Why it probably failed
Commit a89f30b directly accesses index 0 on active_vouchers without checking if the voucher list is non-empty. When a user checks out without an applied promotional voucher, an unhandled IndexError is raised.

### Suspect change
\`\`\`diff
@@ -139,4 +139,6 @@ def process_cart_discounts(cart_context):
     if not cart_context.has_items():
         return None
-    return calculate_standard_discount(cart_context)
+    active_vouchers = cart_context.voucher_list
+    primary_tier = active_vouchers[0].tier_multiplier
+    return calculate_tiered_discount(cart_context, primary_tier)
\`\`\`

### Verification checklist
- [ ] Add boundary guard: if not active_vouchers: return calculate_standard_discount(cart_context)
- [ ] Verify zero-voucher checkout test case in test_checkout_service.py
- [ ] Verify order confirmation receipt generation in staging

<!-- ichnoscope:fp=e89c314b09f1 -->`,
    logs: [
      { ts: '14:20:01.012', level: 'info', step: 'gateway', message: 'Accepted Sentry webhook. Verified HMAC-SHA256 signature.' },
      { ts: '14:20:01.085', level: 'info', step: 'dedupe', message: 'Generated fingerprint sha256(IndexError|services/checkout.py|142)[:12] -> e89c314b09f1.' },
      { ts: '14:20:01.320', level: 'info', step: 'blame', message: 'Querying GitHub GraphQL blame at release SHA a89f30b91d29ec49.' },
      { ts: '14:20:01.890', level: 'info', step: 'blame', message: 'Located suspect commit a89f30b by @alexparker in PR-144.' },
      { ts: '14:20:02.450', level: 'warn', step: 'severity', message: 'Rated P1-Critical (production=True, users=67 >= 50, events=148 >= 100).' },
      { ts: '14:20:02.910', level: 'info', step: 'draft', message: 'Prepared draft issue. Awaiting human sign-off.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 38 },
      { name: 'blame', state: 'done', ms: 420 },
      { name: 'explain', state: 'done', ms: 780 },
      { name: 'draft', state: 'done', ms: 45 },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 2. published - P2 High
  {
    id: 'run-902',
    status: 'published',
    severity: 'P2-High',
    exceptionType: 'AttributeError',
    errorMessage: "'NoneType' object has no attribute 'stripe_customer_id'",
    filePath: 'payments/subscription_sync.py',
    lineNumber: 94,
    suspect: { login: 'sarahchen', name: 'Sarah Chen' },
    confidence: 'high',
    eventCount: 38,
    sparkline: [2, 1, 0, 4, 2, 8, 12, 10, 6, 2, 1, 0, 0, 0, 0, 1, 2, 3, 5, 8, 12, 16, 24, 38],
    createdAt: new Date(Date.now() - 1000 * 60 * 85).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 70).toISOString(),
    issueUrl: 'https://github.com/ichnoscope/wcc-demo-service/issues/145',
    releaseSha: 'c41f09e887d1ba',
    environment: 'production',
    fingerprint: '3b18e47c11a0',
    stackFrames: [
      { file: 'payments/subscription_sync.py', line: 94, fn: 'sync_customer_state', inApp: true, context: ['customer_token = customer_obj.stripe_customer_id'] },
    ],
    culprit: {
      sha: 'c41f09e',
      message: 'refactor(billing): decouple customer lookup from session context (PR-139)',
      committedAt: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
      prNumber: 139,
      diff: `@@ -91,4 +91,5 @@ def sync_customer_state(account_id):
-    customer_obj = get_active_session_customer()
+    customer_obj = find_customer_by_id(account_id)
+    customer_token = customer_obj.stripe_customer_id`,
      withinWindow: true,
    },
    explanation: {
      domain: 'database',
      hypothesis:
        'find_customer_by_id returns None for archived user accounts. Dereferencing customer_obj without a guard check triggers an unhandled AttributeError.',
      checklist: [
        'Add null guard: if not customer_obj: return log_skipped_sync(account_id)',
        'Check database query soft-delete filter condition',
        'Backfill subscription events for 38 affected accounts',
      ],
    },
    draftMarkdown: `<!-- ichnoscope:fp=3b18e47c11a0 -->`,
    logs: [
      { ts: '12:15:02.100', level: 'info', step: 'gateway', message: 'Sentry webhook accepted.' },
      { ts: '12:15:03.450', level: 'info', step: 'publish', message: 'Approved by human reviewer: issue opened at GH-145.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 25 },
      { name: 'blame', state: 'done', ms: 380 },
      { name: 'explain', state: 'done', ms: 640 },
      { name: 'draft', state: 'done', ms: 30 },
      { name: 'publish', state: 'done', ms: 210 },
    ],
  },

  // 3. draft_ready - Low confidence run (blame inconclusive fallback to recent commits)
  {
    id: 'run-903',
    status: 'draft_ready',
    severity: 'P2-High',
    exceptionType: 'KeyError',
    errorMessage: "'pricing_tier' missing from payload during checkout initialization",
    filePath: 'core/pricing/calculator.ts',
    lineNumber: 52,
    suspect: { login: 'm-vasquez', name: 'Marcus Vasquez' },
    confidence: 'low',
    eventCount: 29,
    sparkline: [1, 0, 0, 1, 2, 4, 6, 8, 9, 12, 10, 8, 4, 2, 1, 0, 1, 3, 5, 8, 12, 15, 20, 29],
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    releaseSha: 'f8101ab882',
    environment: 'production',
    fingerprint: '71a48c901e33',
    stackFrames: [
      { file: 'core/pricing/calculator.ts', line: 52, fn: 'initCalculator', inApp: true, context: ['const tier = payload["pricing_tier"];'] },
    ],
    culprit: {
      sha: 'f8101ab',
      message: 'chore(deps): update schema validation library',
      committedAt: new Date(Date.now() - 1000 * 60 * 600).toISOString(),
      diff: `@@ -10,2 +10,2 @@\n-import Joi from 'joi-v16';\n+import Joi from 'joi-v17';`,
      withinWindow: false,
    },
    explanation: {
      domain: 'frontend',
      hypothesis:
        'Blame could not conclusively map line 52 at release SHA due to concurrent file renames. Inspecting the latest commits indicates potential schema parsing discrepancy.',
      checklist: [
        'Inspect legacy client payloads missing pricing_tier field',
        'Provide fallback to default pricing tier in initCalculator',
        'Verify contract test suite with partial payloads',
      ],
    },
    draftMarkdown: `<!-- ichnoscope:fp=71a48c901e33 -->`,
    logs: [
      { ts: '13:40:01.010', level: 'info', step: 'gateway', message: 'Webhook verified.' },
      { ts: '13:40:02.100', level: 'warn', step: 'blame', message: 'Blame inconclusive after 3 retries. Fallback to 3 latest commits on file; confidence=low.' },
      { ts: '13:40:02.900', level: 'info', step: 'draft', message: 'Staged low-confidence draft.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 30 },
      { name: 'blame', state: 'done', ms: 950 },
      { name: 'explain', state: 'done', ms: 610 },
      { name: 'draft', state: 'done', ms: 40 },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 4. failed - LLM Failure fallback run
  {
    id: 'run-904',
    status: 'failed',
    severity: 'P1-Critical',
    exceptionType: 'MemoryError',
    errorMessage: 'Out of memory in large parquet export worker',
    filePath: 'workers/export_pipeline.py',
    lineNumber: 210,
    suspect: { login: 'devin-m', name: 'Devin Martinez' },
    confidence: 'high',
    eventCount: 88,
    sparkline: [0, 0, 0, 1, 2, 5, 10, 20, 35, 50, 70, 88, 88, 80, 60, 40, 20, 10, 5, 2, 1, 0, 0, 0],
    createdAt: new Date(Date.now() - 1000 * 60 * 160).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 155).toISOString(),
    releaseSha: '9901bc448a',
    environment: 'production',
    fingerprint: '19ac4092b11e',
    stackFrames: [
      { file: 'workers/export_pipeline.py', line: 210, fn: 'stream_parquet_chunk', inApp: true, context: ['df = pd.read_parquet(full_buffer)'] },
    ],
    culprit: {
      sha: '9901bc4',
      message: 'feat(export): stream full table snapshot without batching',
      committedAt: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
      diff: `@@ -208,3 +208,3 @@\n-    for chunk in read_batched(1000):\n+    df = pd.read_parquet(full_buffer)`,
      withinWindow: true,
    },
    explanation: null,
    draftMarkdown: `<!-- ichnoscope:fp=19ac4092b11e -->`,
    logs: [
      { ts: '10:02:01.010', level: 'info', step: 'gateway', message: 'Sentry webhook accepted.' },
      { ts: '10:02:01.890', level: 'info', step: 'blame', message: 'Located culprit @devin-m from commit 9901bc4.' },
      { ts: '10:02:03.200', level: 'error', step: 'explain', message: 'LLM provider timeout (429 / 503). All fallback providers exhausted.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 32 },
      { name: 'blame', state: 'done', ms: 410 },
      { name: 'explain', state: 'failed', ms: 5000 },
      { name: 'draft', state: 'skipped' },
      { name: 'publish', state: 'skipped' },
    ],
  },

  // 5. draft_ready - No assignable suspect (bot commit / author not in assignees)
  {
    id: 'run-905',
    status: 'draft_ready',
    severity: 'P3-Medium',
    exceptionType: 'SyntaxError',
    errorMessage: 'invalid syntax in generated openapi spec stub',
    filePath: 'specs/generated/client.py',
    lineNumber: 12,
    suspect: { login: null, name: 'github-actions[bot]' },
    confidence: 'high',
    eventCount: 4,
    sparkline: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4],
    createdAt: new Date(Date.now() - 1000 * 60 * 200).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 200).toISOString(),
    releaseSha: '11002233aa',
    environment: 'staging',
    fingerprint: '55bc901a4e12',
    stackFrames: [
      { file: 'specs/generated/client.py', line: 12, fn: '<module>', inApp: true, context: ['def init(-> None:'] },
    ],
    culprit: {
      sha: '1100223',
      message: 'chore: automated client code generation via CI',
      committedAt: new Date(Date.now() - 1000 * 60 * 400).toISOString(),
      diff: `@@ -10,3 +10,3 @@\n-def init(params: dict) -> None:\n+def init(-> None:`,
      withinWindow: true,
    },
    explanation: {
      domain: 'infra',
      hypothesis:
        'The OpenAPI generator script emitted a malformed Python signature when method parameters were empty. Suspect author is a bot, falling back to configured FALLBACK_ASSIGNEE (devops-oncall).',
      checklist: [
        'Fix OpenAPI generator template syntax for empty args',
        'Assign fallback owner devops-oncall for manual verification',
        'Re-run code generation workflow in GitHub Actions',
      ],
    },
    draftMarkdown: `<!-- ichnoscope:fp=55bc901a4e12 -->`,
    logs: [
      { ts: '09:12:01.010', level: 'info', step: 'gateway', message: 'Webhook verified.' },
      { ts: '09:12:01.400', level: 'warn', step: 'blame', message: 'Author github-actions[bot] has no GitHub login / not assignable. Assigning FALLBACK_ASSIGNEE.' },
      { ts: '09:12:02.100', level: 'info', step: 'draft', message: 'Draft staged with suggested owner devops-oncall.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 28 },
      { name: 'blame', state: 'done', ms: 320 },
      { name: 'explain', state: 'done', ms: 550 },
      { name: 'draft', state: 'done', ms: 35 },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 6. parsing - Currently running state
  {
    id: 'run-906',
    status: 'parsing',
    severity: 'P1-Critical',
    exceptionType: 'ConnectionResetError',
    errorMessage: '[Errno 104] Connection reset by peer during database pool handshake',
    filePath: 'infra/database/pool.py',
    lineNumber: 78,
    suspect: null,
    confidence: 'high',
    eventCount: 190,
    sparkline: [5, 10, 20, 35, 50, 75, 110, 140, 160, 180, 190, 190, 185, 170, 150, 120, 90, 60, 40, 25, 15, 10, 5, 2],
    createdAt: new Date(Date.now() - 1000 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 20).toISOString(),
    releaseSha: '22114455bb',
    environment: 'production',
    fingerprint: '992211bb77ff',
    stackFrames: [],
    culprit: null,
    explanation: null,
    draftMarkdown: '',
    logs: [
      { ts: '14:28:10.012', level: 'info', step: 'gateway', message: 'Accepted Sentry webhook.' },
      { ts: '14:28:10.090', level: 'info', step: 'parse', message: 'Extracting last in_app stack frame...' },
    ],
    steps: [
      { name: 'parse', state: 'running' },
      { name: 'blame', state: 'pending' },
      { name: 'explain', state: 'pending' },
      { name: 'draft', state: 'pending' },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 7. blaming - Currently blaming GraphQL
  {
    id: 'run-907',
    status: 'blaming',
    severity: 'P2-High',
    exceptionType: 'ValueError',
    errorMessage: "could not convert string to float: 'N/A'",
    filePath: 'analytics/metric_aggregator.py',
    lineNumber: 89,
    suspect: null,
    confidence: 'high',
    eventCount: 42,
    sparkline: [0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 42, 40, 36, 30, 20, 15, 10, 5, 2, 1],
    createdAt: new Date(Date.now() - 1000 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 45).toISOString(),
    releaseSha: '44556677cc',
    environment: 'production',
    fingerprint: '334455cc66aa',
    stackFrames: [
      { file: 'analytics/metric_aggregator.py', line: 89, fn: 'parse_metric_row', inApp: true, context: ['val = float(raw_str)'] },
    ],
    culprit: null,
    explanation: null,
    draftMarkdown: '',
    logs: [
      { ts: '14:27:45.010', level: 'info', step: 'gateway', message: 'Webhook verified.' },
      { ts: '14:27:45.120', level: 'info', step: 'parse', message: 'Frame extracted analytics/metric_aggregator.py:89.' },
      { ts: '14:27:45.300', level: 'info', step: 'blame', message: 'Querying GitHub GraphQL blame at release 44556677cc...' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 42 },
      { name: 'blame', state: 'running' },
      { name: 'explain', state: 'pending' },
      { name: 'draft', state: 'pending' },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 8. explaining - Currently LLM reasoning
  {
    id: 'run-908',
    status: 'explaining',
    severity: 'P3-Medium',
    exceptionType: 'ZeroDivisionError',
    errorMessage: 'division by zero in calculate_conversion_rate',
    filePath: 'reports/funnel.py',
    lineNumber: 34,
    suspect: { login: 'j-tucker', name: 'Jessica Tucker' },
    confidence: 'high',
    eventCount: 16,
    sparkline: [0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 7, 9, 11, 13, 15, 16, 15, 12, 8, 5, 3, 1, 0],
    createdAt: new Date(Date.now() - 1000 * 70).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 70).toISOString(),
    releaseSha: '55667788dd',
    environment: 'staging',
    fingerprint: '778899dd00ee',
    stackFrames: [
      { file: 'reports/funnel.py', line: 34, fn: 'calc_rate', inApp: true, context: ['return conversions / total_visits'] },
    ],
    culprit: {
      sha: '5566778',
      message: 'feat(funnel): add custom conversion calculator',
      committedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      diff: `@@ -32,2 +32,3 @@\n+    return conversions / total_visits`,
      withinWindow: true,
    },
    explanation: null,
    draftMarkdown: '',
    logs: [
      { ts: '14:26:01.010', level: 'info', step: 'gateway', message: 'Webhook verified.' },
      { ts: '14:26:01.350', level: 'info', step: 'blame', message: 'Found suspect @j-tucker.' },
      { ts: '14:26:01.900', level: 'info', step: 'explain', message: 'Calling Gemini 1.5 Flash structured reasoning...' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 25 },
      { name: 'blame', state: 'done', ms: 380 },
      { name: 'explain', state: 'running' },
      { name: 'draft', state: 'pending' },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 9. received - Just accepted
  {
    id: 'run-909',
    status: 'received',
    severity: 'P2-High',
    exceptionType: 'OperationalError',
    errorMessage: 'SSL SYSCALL error: EOF detected during query pipeline',
    filePath: 'infra/database_connector.py',
    lineNumber: 112,
    suspect: null,
    confidence: 'high',
    eventCount: 22,
    sparkline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 8, 12, 16, 20, 22, 22, 20, 16, 10, 5, 2, 1],
    createdAt: new Date(Date.now() - 1000 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 10).toISOString(),
    releaseSha: '77889900ee',
    environment: 'production',
    fingerprint: '445566ee1122',
    stackFrames: [],
    culprit: null,
    explanation: null,
    draftMarkdown: '',
    logs: [
      { ts: '14:29:01.005', level: 'info', step: 'gateway', message: 'HMAC signature valid. Event enqueued.' },
    ],
    steps: [
      { name: 'parse', state: 'pending' },
      { name: 'blame', state: 'pending' },
      { name: 'explain', state: 'pending' },
      { name: 'draft', state: 'pending' },
      { name: 'publish', state: 'pending' },
    ],
  },

  // 10. rejected - Discarded by reviewer
  {
    id: 'run-910',
    status: 'rejected',
    severity: 'P3-Medium',
    exceptionType: 'FileNotFoundError',
    errorMessage: "[Errno 2] No such file or directory: '/tmp/cache_sync_temp.lock'",
    filePath: 'cache/lock_manager.py',
    lineNumber: 41,
    suspect: { login: 'elena-k', name: 'Elena Rostova' },
    confidence: 'high',
    eventCount: 3,
    sparkline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3],
    createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 350).toISOString(),
    releaseSha: '88990011ff',
    environment: 'staging',
    fingerprint: '11e099cf77d3',
    stackFrames: [
      { file: 'cache/lock_manager.py', line: 41, fn: 'acquire_lock', inApp: true, context: ['os.unlink(lock_path)'] },
    ],
    culprit: {
      sha: '8899001',
      message: 'chore: clean tmp locks on container restart',
      committedAt: new Date(Date.now() - 1000 * 60 * 700).toISOString(),
      diff: `@@ -39,3 +39,3 @@\n-    pass\n+    os.unlink(lock_path)`,
      withinWindow: false,
    },
    explanation: {
      domain: 'infra',
      hypothesis: 'Expected transient warning during staging container scale down.',
      checklist: ['Check if lock file exists before calling unlink', 'Verify staging cron schedule'],
    },
    draftMarkdown: `<!-- ichnoscope:fp=11e099cf77d3 -->`,
    logs: [
      { ts: '08:12:01.010', level: 'info', step: 'gateway', message: 'Sentry webhook accepted.' },
      { ts: '08:12:04.200', level: 'warn', step: 'draft', message: 'Rejected by admin: Expected transient error during staging reboot.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 20 },
      { name: 'blame', state: 'done', ms: 310 },
      { name: 'explain', state: 'done', ms: 490 },
      { name: 'draft', state: 'done', ms: 25 },
      { name: 'publish', state: 'skipped' },
    ],
  },

  // 11. suppressed - Deduplicated storm repeat
  {
    id: 'run-911',
    status: 'suppressed',
    severity: 'P1-Critical',
    exceptionType: 'IndexError',
    errorMessage: 'list index out of range in get_applied_discounts (repeat storm event #42)',
    filePath: 'services/checkout_service.py',
    lineNumber: 142,
    suspect: { login: 'alexparker', name: 'Alex Parker' },
    confidence: 'high',
    eventCount: 42,
    sparkline: [2, 5, 8, 3, 6, 12, 18, 24, 30, 42, 60, 45, 30, 15, 8, 4, 3, 2, 2, 5, 9, 14, 22, 38],
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    releaseSha: 'a89f30b91d29ec49b168',
    environment: 'production',
    fingerprint: 'e89c314b09f1',
    stackFrames: [],
    culprit: null,
    explanation: null,
    draftMarkdown: '',
    logs: [
      { ts: '14:25:01.002', level: 'info', step: 'gateway', message: 'Webhook accepted.' },
      { ts: '14:25:01.015', level: 'info', step: 'dedupe', message: 'Fingerprint e89c314b09f1 already claimed in SQLite. Repeat count incremented to 42. Duplicate suppressed.' },
    ],
    steps: [
      { name: 'parse', state: 'skipped' },
      { name: 'blame', state: 'skipped' },
      { name: 'explain', state: 'skipped' },
      { name: 'draft', state: 'skipped' },
      { name: 'publish', state: 'skipped' },
    ],
  },

  // 12. published - P3 Medium
  {
    id: 'run-912',
    status: 'published',
    severity: 'P3-Medium',
    exceptionType: 'TypeError',
    errorMessage: "Unsupported operand type(s) for +: 'int' and 'NoneType'",
    filePath: 'utils/formatter.py',
    lineNumber: 19,
    suspect: { login: 'devin-m', name: 'Devin Martinez' },
    confidence: 'high',
    eventCount: 8,
    sparkline: [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 8, 7, 5, 3, 2, 1, 0, 0],
    createdAt: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 450).toISOString(),
    issueUrl: 'https://github.com/ichnoscope/wcc-demo-service/issues/138',
    releaseSha: '6677889900',
    environment: 'production',
    fingerprint: '99001122aabb',
    stackFrames: [
      { file: 'utils/formatter.py', line: 19, fn: 'format_score', inApp: true, context: ['total = base_score + bonus_points'] },
    ],
    culprit: {
      sha: '6677889',
      message: 'refactor: allow optional bonus points in profile score',
      committedAt: new Date(Date.now() - 1000 * 60 * 800).toISOString(),
      diff: `@@ -17,3 +17,3 @@\n-    total = base_score\n+    total = base_score + bonus_points`,
      withinWindow: false,
    },
    explanation: {
      domain: 'backend',
      hypothesis: 'bonus_points defaults to None when unset in user profile. Python raises TypeError on integer addition.',
      checklist: ['Default bonus_points to 0 if None: bonus_points or 0', 'Add unit test for default profile scoring'],
    },
    draftMarkdown: `<!-- ichnoscope:fp=99001122aabb -->`,
    logs: [
      { ts: '06:30:01.010', level: 'info', step: 'gateway', message: 'Webhook verified.' },
      { ts: '06:30:03.200', level: 'info', step: 'publish', message: 'Published issue GH-138 to GitHub.' },
    ],
    steps: [
      { name: 'parse', state: 'done', ms: 22 },
      { name: 'blame', state: 'done', ms: 290 },
      { name: 'explain', state: 'done', ms: 510 },
      { name: 'draft', state: 'done', ms: 30 },
      { name: 'publish', state: 'done', ms: 180 },
    ],
  },
];
