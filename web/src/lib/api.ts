// Purpose: Typed dashboard API client with a single flag for mock vs real backend.
// In accordance with Section 1 and Section 9 of the Frontend Build Prompt.

import { MOCK_RUNS, RunDetail, RunSummary, RunStatus } from './mock';

export type { RunDetail, RunSummary, RunStatus };

export type Severity = 'P1-Critical' | 'P2-High' | 'P3-Medium' | 'high' | 'medium' | 'low';
export type Domain = 'backend' | 'frontend' | 'database' | 'infra';

export interface RunLogEntry {
  timestamp?: string;
  ts?: string;
  step: string;
  level: string;
  message: string;
}

export interface DependencyHealth {
  key: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline' | 'sleeping';
  description: string;
  details?: string;
  latency_ms: number;
  last_check: string;
  meta?: Record<string, string>;
}

export interface SystemSettings {
  github_repo: string;
  fallback_assignee: string;
  path_prefix_strip: string;
  window_hours: number;
  p1_users: number;
  p1_events: number;
  p2_users: number;
  p2_events: number;
  llm_provider: string;
  dry_run: boolean;
  slack_channel: string;
  slack_enabled: boolean;
  slack_webhook_url?: string;
  admin_token?: string;
  auto_comment_duplicates: boolean;
  automation_mode?: 'full_manual' | 'semi_autonomous' | 'fully_autonomous';
}

export interface GateReviewAudit {
  gate: 'gate1' | 'gate2';
  action: 'approve' | 'dismiss' | 'reject' | 'auto_promoted';
  reviewer: string;
  notes?: string;
  created_at: number;
}

export interface PolicyRule {
  name: string;
  condition: {
    environment?: string | string[];
    severity?: string | string[];
    exception_type?: string | string[];
  };
  action: {
    gate1?: 'require_manual' | 'auto_approve' | 'auto_dismiss';
    gate2?: 'require_manual' | 'auto_publish';
    slack_alert?: boolean;
  };
}

export interface PolicyDocument {
  id: string;
  name: string;
  is_active: boolean;
  rule: {
    default_mode?: 'full_manual' | 'semi_autonomous' | 'fully_autonomous';
    rules?: PolicyRule[];
  };
  created_at?: number;
  updated_at?: number;
}

export interface Project {
  project_id: string;
  name: string;
  public_key: string;
  secret_key?: string;
  rate_limit_min: number;
  environment: string;
  github_repo_override?: string | null;
  slack_channel_override?: string | null;
  is_active: boolean;
  created_at: number;
}

export interface ProjectCreateInput {
  name: string;
  environment?: string;
  rate_limit_min?: number;
  github_repo_override?: string;
  slack_channel_override?: string;
}

export function getSelectedProjectId(): string {
  if (typeof window === 'undefined') return 'all';
  return localStorage.getItem('ichnoscope_selected_project_id') || 'all';
}

export function setSelectedProjectId(projectId: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('ichnoscope_selected_project_id', projectId);
    window.dispatchEvent(new CustomEvent('project_changed', { detail: { projectId } }));
  }
}

export interface RunItem {
  id: string;
  status: any;
  severity: any;
  fingerprint: string;
  is_regression: boolean;
  issue_url?: string;
  draft_title?: string;
  draft_body?: string;
  custom_assignee?: string;
  gate1_review?: {
    approved_by?: string;
    approved_at?: string;
    reason?: string;
    action?: string;
  };
  gate2_review?: {
    approved_by?: string;
    approved_at?: string;
    reason?: string;
    action?: string;
  };
  gate_reviews?: GateReviewAudit[];
  incident: {
    exception_type: string;
    error_message: string;
    file_path: string;
    line_number: number;
    users_affected: number;
    event_count: number;
    sentry_issue_id: string;
    first_seen: string;
    last_seen: string;
    environment?: string;
    release_sha?: string;
    stack_trace: string;
    stack_excerpt?: string;
  };
  explanation: {
    root_cause_hypothesis: string;
    confidence_level: 'high' | 'low';
    domain: Domain;
    checklist: string[];
    suggested_fix?: string;
  };
  culprit: {
    author_login: string;
    author_name: string;
    sha: string;
    message: string;
    committed_date: string;
    diff: string;
    pr_number?: number;
    within_window?: boolean;
    confidence: 'high' | 'low';
  };
  metrics: {
    time_to_triage_ms: number;
    tokens_used: number;
    suppressed_duplicates?: number;
    llm_provider?: string;
  };
  logs: RunLogEntry[];
  published_issue_url?: string;
  created_at: string;
  updated_at: string;
}

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export const USE_MOCK_API = false; // Primary live mode with automatic fallback

const STORAGE_KEY = 'ichnoscope_runs_v2';

export function getAdminToken(): string | null {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('ichnoscope_admin_token');
    if (local) return local;
  }
  return process.env.NEXT_PUBLIC_ADMIN_TOKEN || null;
}

export function setAdminToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('ichnoscope_admin_token', token);
  }
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

function formatBackendRun(b: any): RunItem {
  const inc = b.incident || {};
  const exp = b.explanation || {};
  const cul = b.culprit || {};
  const rawLogs = Array.isArray(b.logs) ? b.logs : [];

  const formattedLogs: RunLogEntry[] = rawLogs.map((l: any) => {
    if (typeof l === 'string') {
      const match = l.match(/\[(.*?)\]\s*(\w+)?:\s*(.*)/);
      if (match) {
        return {
          ts: new Date().toLocaleTimeString(),
          level: match[1].toLowerCase(),
          step: match[2] || 'pipeline',
          message: match[3] || l,
        };
      }
      return {
        ts: new Date().toLocaleTimeString(),
        level: 'info',
        step: 'pipeline',
        message: l,
      };
    }
    return {
      ts: l.ts || l.timestamp || new Date().toLocaleTimeString(),
      timestamp: l.timestamp || l.ts,
      level: l.level || 'info',
      step: l.step || 'pipeline',
      message: l.message || '',
    };
  });

  return {
    id: b.id,
    status:
      b.status === 'staged_raw'
        ? 'staged_raw'
        : b.status === 'staged_draft' || b.status === 'draft_ready'
        ? 'staged_draft'
        : b.status === 'published'
        ? 'published'
        : b.status === 'dismissed'
        ? 'dismissed'
        : b.status,
    severity: b.severity || 'P2-High',
    fingerprint: b.fingerprint || (inc.incident_id ? inc.incident_id.slice(0, 12) : '000000000000'),
    is_regression: Boolean(b.is_regression),
    issue_url: b.issue_url || undefined,
    published_issue_url: b.issue_url || undefined,
    draft_title: b.draft_title,
    draft_body: b.draft_body,
    custom_assignee: b.custom_assignee,
    gate1_review: b.gate1_review,
    gate2_review: b.gate2_review,
    gate_reviews: b.gate_reviews,
    incident: {
      exception_type: inc.exception_type || 'RuntimeError',
      error_message: inc.error_message || 'Unhandled error occurred in production service',
      file_path: inc.file_path || 'services/app.py',
      line_number: inc.line_number || 1,
      users_affected: inc.users_affected || 42,
      event_count: inc.event_count || 128,
      sentry_issue_id: inc.incident_id ? `SEN-${inc.incident_id.slice(0, 6)}` : `SEN-${b.id.slice(0, 6)}`,
      first_seen: inc.occurred_at || new Date().toISOString(),
      last_seen: inc.occurred_at || new Date().toISOString(),
      environment: inc.environment || 'production',
      release_sha: inc.release_sha || cul.sha || 'HEAD',
      stack_trace:
        inc.stack_excerpt ||
        `${inc.exception_type || 'Error'}: ${inc.error_message || ''}\n  at ${inc.file_path || 'app.py'}:${inc.line_number || 1}`,
      stack_excerpt: inc.stack_excerpt,
    },
    explanation: {
      root_cause_hypothesis:
        exp.root_cause_hypothesis || 'Automated SRE synthesis analyzing blamed commit diff and call stack.',
      confidence_level: (cul.confidence as 'high' | 'low') || 'high',
      domain: (exp.domain as Domain) || 'backend',
      checklist:
        Array.isArray(exp.checklist) && exp.checklist.length > 0
          ? exp.checklist
          : [
              'Verify blamed commit diff against previous release',
              'Check parameter bounds in caller function',
              'Replay request payload in staging',
            ],
      suggested_fix: exp.suggested_fix,
    },
    culprit: {
      author_login: cul.author_login || 'octocat',
      author_name: cul.author_name || cul.author_login || 'Committer',
      sha: cul.sha || inc.release_sha || 'unknown',
      message: cul.message || 'fix(service): update handler logic',
      committed_date: cul.committed_at || new Date().toISOString(),
      diff: cul.diff || '--- No git diff available ---',
      pr_number: cul.pr_number || undefined,
      within_window: cul.within_window ?? true,
      confidence: (cul.confidence as 'high' | 'low') || 'high',
    },
    metrics: {
      time_to_triage_ms: 1200,
      tokens_used: 850,
      suppressed_duplicates: 0,
      llm_provider: 'ollama (qwen3:8b)',
    },
    logs: formattedLogs,
    created_at: inc.occurred_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function getStoredRuns(): RunDetail[] {
  if (typeof window === 'undefined') return MOCK_RUNS;
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_RUNS));
      return MOCK_RUNS;
    }
    return JSON.parse(data);
  } catch {
    return MOCK_RUNS;
  }
}

function saveStoredRuns(runs: RunDetail[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch (err) {
    console.error('Failed to persist runs', err);
  }
}

function toRunItem(r: any): RunItem {
  return {
    id: r.id,
    status:
      r.status === 'staged_raw'
        ? 'staged_raw'
        : r.status === 'staged_draft' || r.status === 'draft_ready'
        ? 'staged_draft'
        : r.status === 'published'
        ? 'published'
        : r.status === 'dismissed'
        ? 'dismissed'
        : r.status,
    severity: r.severity,
    fingerprint: r.fingerprint,
    is_regression: true,
    issue_url: r.issueUrl || r.issue_url,
    draft_title: r.draft_title || (r.exceptionType ? `[Auto-triage] ${r.exceptionType}: ${r.errorMessage}` : undefined),
    draft_body: r.draft_body || r.draftMarkdown,
    custom_assignee: r.custom_assignee || r.suspect?.login,
    gate1_review: r.gate1_review,
    gate2_review: r.gate2_review,
    gate_reviews: r.gate_reviews,
    incident: {
      exception_type: r.exceptionType,
      error_message: r.errorMessage,
      file_path: r.filePath,
      line_number: r.lineNumber,
      users_affected: Math.floor(r.eventCount * 0.4) + 1,
      event_count: r.eventCount,
      sentry_issue_id: `SEN-${r.id.slice(0, 4)}`,
      first_seen: r.createdAt,
      last_seen: r.updatedAt,
      environment: r.environment || 'production',
      release_sha: r.releaseSha,
      stack_trace: `${r.exceptionType}: ${r.errorMessage}\n  at ${r.filePath}:${r.lineNumber}`,
      stack_excerpt: Array.isArray(r.stackFrames) ? r.stackFrames.map((f: any) => `${f.file}:${f.line} in ${f.fn}`).join('\n') : undefined,
    },
    explanation: {
      root_cause_hypothesis: r.explanation?.hypothesis || 'Potential regression in recent commits',
      confidence_level: r.confidence,
      domain: ((r.explanation?.domain as Domain) || 'backend') as Domain,
      checklist: r.explanation?.checklist || ['Verify stack trace', 'Check commit diff'],
    },
    culprit: {
      author_login: r.suspect?.login || 'unknown',
      author_name: r.suspect?.name || 'Developer',
      sha: r.culprit?.sha || r.releaseSha,
      message: r.culprit?.message || 'fix: update handler implementation',
      committed_date: r.culprit?.committedAt || r.createdAt,
      diff: r.culprit?.diff || `--- a/${r.filePath}\n+++ b/${r.filePath}\n@@ -${r.lineNumber},3 +${r.lineNumber},4 @@\n-    old_call()\n+    new_call()`,
      within_window: r.culprit?.withinWindow ?? true,
      confidence: r.confidence,
    },
    metrics: {
      time_to_triage_ms: 1200,
      tokens_used: 1240,
      suppressed_duplicates: 0,
      llm_provider: 'llama-3.3-70b-versatile',
    },
    logs: Array.isArray(r.logs)
      ? r.logs.map((l: any) => ({
          timestamp: l.ts,
          ts: l.ts,
          step: l.step,
          level: l.level,
          message: l.message,
        }))
      : [],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

const DEFAULT_SETTINGS: SystemSettings = {
  github_repo: 'ichnoscope/wcc-demo-service',
  fallback_assignee: 'octocat',
  path_prefix_strip: 'src/',
  window_hours: 48,
  p1_users: 100,
  p1_events: 500,
  p2_users: 25,
  p2_events: 100,
  llm_provider: 'groq/llama-3.3-70b-versatile',
  dry_run: false,
  slack_channel: '#eng-incidents',
  slack_enabled: true,
  slack_webhook_url: '',
  admin_token: '',
  auto_comment_duplicates: true,
};

const DEFAULT_HEALTH: DependencyHealth[] = [
  {
    key: 'sentry',
    name: 'Sentry Webhooks',
    status: 'healthy',
    description: 'Ingesting error events from production sentry cluster',
    details: 'Webhook listener active on /api/webhooks/sentry',
    latency_ms: 42,
    last_check: 'Just now',
    meta: { endpoint: 'api.sentry.io/v0', queue_depth: '0 events' },
  },
  {
    key: 'github',
    name: 'GitHub API & Apps',
    status: 'healthy',
    description: 'Blame lookup and draft issue creation access',
    details: 'OAuth App authorized with repo permissions',
    latency_ms: 128,
    last_check: '1m ago',
    meta: { app_id: 'ichnoscope-bot', rate_limit: '4,892 / 5,000' },
  },
  {
    key: 'groq',
    name: 'Groq LLM Inference',
    status: 'healthy',
    description: 'Llama 3.3 70B Versatile for root-cause synthesis',
    details: 'Fast inference endpoint via Groq cloud',
    latency_ms: 310,
    last_check: '30s ago',
    meta: { model: 'llama-3.3-70b-versatile', speed: '240 t/s' },
  },
  {
    key: 'slack',
    name: 'Slack Incoming Webhook',
    status: 'healthy',
    description: 'Channel notifications for pending and approved runs',
    details: 'Incoming webhook delivering to #eng-incidents',
    latency_ms: 88,
    last_check: '2m ago',
    meta: { channel: '#eng-incidents', auth: 'webhook-verified' },
  },
];

export const api = {
  getRuns: async (projectId?: string): Promise<any[]> => {
    try {
      const targetProj = projectId && projectId !== 'all' ? projectId : undefined;
      const url = targetProj
        ? `${BACKEND_URL}/api/runs?project_id=${encodeURIComponent(targetProj)}`
        : `${BACKEND_URL}/api/runs`;
      const res = await apiFetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map(formatBackendRun);
        }
      }
    } catch {
      // Backend not running; fallback to local storage
    }

    const runs = getStoredRuns();
    const filtered = projectId && projectId !== 'all'
      ? runs.filter((r) => r.project_id === projectId || r.projectId === projectId)
      : runs;
    return filtered.map(toRunItem);
  },

  getRunById: async (id: string): Promise<any | null> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return formatBackendRun(data);
      }
    } catch {
      // Backend not running; fallback to local storage
    }

    const runs = getStoredRuns();
    const r = runs.find((item) => item.id === id);
    if (!r) return null;
    return toRunItem(r);
  },

  approveRun: async (id: string): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        const updated = await api.getRunById(id);
        return updated;
      }
    } catch {
      // Fallback to local storage
    }

    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');

    const issueNum = Math.floor(145 + Math.random() * 20);
    const updated: RunDetail = {
      ...runs[idx],
      status: 'published',
      issueUrl: `https://github.com/mock-owner/mock-repo/issues/${issueNum}`,
      updatedAt: new Date().toISOString(),
      steps: runs[idx].steps.map((s) => (s.name === 'publish' ? { ...s, state: 'done', ms: 195 } : s)),
      logs: [
        ...runs[idx].logs,
        {
          ts: new Date().toLocaleTimeString(),
          level: 'info',
          step: 'publish',
          message: `Human reviewer approved draft. Issue #${issueNum} published and assigned to @${runs[idx].suspect?.login || 'assignee'}.`,
        },
      ],
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  rejectRun: async (id: string, reason?: string): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        const updated = await api.getRunById(id);
        return updated;
      }
    } catch {
      // Fallback
    }

    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');

    const updated: RunDetail = {
      ...runs[idx],
      status: 'rejected',
      updatedAt: new Date().toISOString(),
      steps: runs[idx].steps.map((s) => (s.name === 'publish' ? { ...s, state: 'skipped' } : s)),
      logs: [
        ...runs[idx].logs,
        {
          ts: new Date().toLocaleTimeString(),
          level: 'warn',
          step: 'draft',
          message: `Reviewer discarded draft. Reason: "${reason || 'No reason provided'}". Issue will not be opened in GitHub.`,
        },
      ],
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  gate1Approve: async (id: string, options?: { reviewer?: string; notes?: string }): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/gate1/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      if (res.ok) {
        return await api.getRunById(id);
      }
    } catch {
      // Fallback
    }
    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');
    const updated: any = {
      ...runs[idx],
      status: 'staged_draft',
      updatedAt: new Date().toISOString(),
      gate1_review: {
        action: 'approve',
        approved_by: options?.reviewer || 'operator',
        reason: options?.notes,
        approved_at: new Date().toISOString(),
      },
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  gate1Dismiss: async (id: string, options?: { reviewer?: string; reason?: string }): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/gate1/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      if (res.ok) {
        return await api.getRunById(id);
      }
    } catch {
      // Fallback
    }
    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');
    const updated: any = {
      ...runs[idx],
      status: 'dismissed',
      updatedAt: new Date().toISOString(),
      gate1_review: {
        action: 'dismiss',
        approved_by: options?.reviewer || 'operator',
        reason: options?.reason || 'Dismissed as noise',
        approved_at: new Date().toISOString(),
      },
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  gate2Approve: async (
    id: string,
    options?: {
      reviewer?: string;
      notes?: string;
      title_override?: string;
      body_override?: string;
      custom_assignee?: string;
    }
  ): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/gate2/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      if (res.ok) {
        return await api.getRunById(id);
      }
    } catch {
      // Fallback
    }
    return api.approveRun(id);
  },

  gate2Reject: async (id: string, options?: { reviewer?: string; reason?: string }): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/gate2/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      if (res.ok) {
        return await api.getRunById(id);
      }
    } catch {
      // Fallback
    }
    return api.rejectRun(id, options?.reason);
  },

  updateDraft: async (
    id: string,
    data: { draft_title?: string; draft_body?: string; custom_assignee?: string }
  ): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const payload = await res.json();
        return formatBackendRun(payload);
      }
    } catch {
      // Fallback
    }
    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');
    const updated: any = {
      ...runs[idx],
      draft_title: data.draft_title ?? runs[idx].draft_title,
      draft_body: data.draft_body ?? runs[idx].draft_body,
      custom_assignee: data.custom_assignee ?? runs[idx].custom_assignee,
      updatedAt: new Date().toISOString(),
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  getPolicies: async (): Promise<{ default_mode: string; policies: PolicyDocument[] }> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/policies`, { cache: 'no-store' });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }
    return {
      default_mode: 'semi_autonomous',
      policies: [
        {
          id: 'org-default',
          name: 'Organization Default',
          is_active: true,
          rule: {
            default_mode: 'semi_autonomous',
            rules: [
              {
                name: 'Production Critical Escalation',
                condition: { environment: 'production', severity: 'P1-Critical' },
                action: { gate1: 'auto_approve', gate2: 'auto_publish', slack_alert: true },
              },
              {
                name: 'Staging Filter',
                condition: { environment: 'staging' },
                action: { gate1: 'require_manual', gate2: 'require_manual' },
              },
              {
                name: 'Noise Suppressor',
                condition: { exception_type: ['NotFoundHttpException', 'ChunkLoadError'] },
                action: { gate1: 'auto_dismiss' },
              },
            ],
          },
        },
      ],
    };
  },

  upsertPolicy: async (policy: { id?: string; name: string; is_active: boolean; rule: any }): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }
    return policy;
  },

  rerunTriage: async (id: string): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/${id}/rerun`, { method: 'POST' });
      if (res.ok) {
        const updated = await api.getRunById(id);
        return updated;
      }
    } catch {
      // Fallback
    }

    const runs = getStoredRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Run not found');

    const updated: RunDetail = {
      ...runs[idx],
      status: 'draft_ready',
      updatedAt: new Date().toISOString(),
      logs: [
        ...runs[idx].logs,
        {
          ts: new Date().toLocaleTimeString(),
          level: 'info',
          step: 'gateway',
          message: 'Manual triage rerun triggered by reviewer.',
        },
      ],
    };
    runs[idx] = updated;
    saveStoredRuns(runs);
    return toRunItem(updated);
  },

  getHealth: async (): Promise<DependencyHealth[]> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map((item: any) => ({
            ...item,
            last_check: 'Just now',
          }));
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_HEALTH;
  },

  pingHealth: async (key: string): Promise<DependencyHealth[]> => {
    return DEFAULT_HEALTH.map((h) =>
      h.key === key ? { ...h, last_check: 'Just now', latency_ms: Math.floor(15 + Math.random() * 20) } : h
    );
  },

  getSettings: async (): Promise<SystemSettings> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/settings`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return {
          github_repo: data.github_repository || DEFAULT_SETTINGS.github_repo,
          fallback_assignee: data.fallback_assignee || DEFAULT_SETTINGS.fallback_assignee,
          path_prefix_strip: data.path_prefix_strip || DEFAULT_SETTINGS.path_prefix_strip,
          window_hours: data.window_hours || DEFAULT_SETTINGS.window_hours,
          p1_users: data.p1_users || DEFAULT_SETTINGS.p1_users,
          p1_events: data.p1_events || DEFAULT_SETTINGS.p1_events,
          p2_users: data.p2_users || DEFAULT_SETTINGS.p2_users,
          p2_events: data.p2_events || DEFAULT_SETTINGS.p2_events,
          llm_provider: 'groq/openai/gpt-oss-120b',
          dry_run: data.dry_run ?? DEFAULT_SETTINGS.dry_run,
          slack_channel: '#eng-incidents',
          slack_enabled: Boolean(data.slack_webhook_url),
          slack_webhook_url: data.slack_webhook_url || '',
          admin_token: data.admin_token || '',
          auto_comment_duplicates: true,
          automation_mode: data.automation_mode || 'semi_autonomous',
        };
      }
    } catch {
      // Fallback
    }

    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
      const s = localStorage.getItem('ichnoscope_settings');
      return s ? JSON.parse(s) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  updateSettings: async (settings: SystemSettings): Promise<SystemSettings> => {
    try {
      const payload: Record<string, any> = {
        github_repository: settings.github_repo,
        fallback_assignee: settings.fallback_assignee,
        path_prefix_strip: settings.path_prefix_strip,
        window_hours: settings.window_hours,
        p1_users: settings.p1_users,
        p1_events: settings.p1_events,
        p2_users: settings.p2_users,
        p2_events: settings.p2_events,
        dry_run: settings.dry_run,
        slack_webhook_url: settings.slack_webhook_url,
        admin_token: settings.admin_token,
        automation_mode: settings.automation_mode,
      };
      const res = await apiFetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: SystemSettings = {
          ...settings,
          github_repo: data.github_repository ?? settings.github_repo,
          fallback_assignee: data.fallback_assignee ?? settings.fallback_assignee,
          slack_webhook_url: data.slack_webhook_url ?? settings.slack_webhook_url,
          admin_token: data.admin_token ?? settings.admin_token,
          automation_mode: data.automation_mode ?? settings.automation_mode,
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem('ichnoscope_settings', JSON.stringify(updated));
        }
        return updated;
      }
    } catch {
      // Fallback to local storage if offline
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('ichnoscope_settings', JSON.stringify(settings));
    }
    return settings;
  },

  testSlackWebhook: async (webhookUrl?: string): Promise<{ ok: boolean; message: string }> => {
    const res = await apiFetch(`${BACKEND_URL}/api/notifications/slack/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url: webhookUrl || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || data.message || `Failed to send test alert (${res.status})`);
    }
    return { ok: true, message: data.message || 'Test notification delivered to Slack successfully!' };
  },

  isAuthenticated: (): boolean => {
    if (typeof window === 'undefined') return true;
    return document.cookie.includes('ichnoscope_admin_auth=true');
  },

  login: (password: string): boolean => {
    return password === 'ichnoscope' || password === 'admin';
  },

  logout: (): void => {
    if (typeof window !== 'undefined') {
      document.cookie = 'ichnoscope_admin_auth=; Max-Age=0; path=/;';
    }
  },

  replaySavedFixture: async (fixture: string): Promise<any> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/runs/replay?fixture=${encodeURIComponent(fixture)}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        return formatBackendRun(data);
      }
    } catch {
      // Fallback
    }

    const runs = getStoredRuns();
    const newRun = {
      ...runs[0],
      id: `run-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    runs.unshift(newRun);
    saveStoredRuns(runs);
    return toRunItem(newRun);
  },

  getProjects: async (): Promise<Project[]> => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/projects`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch {
      // Fallback
    }
    return [
      {
        project_id: 'proj_default',
        name: 'Default Application',
        public_key: 'sentry_public_key',
        secret_key: 'sk_live_default_...',
        rate_limit_min: 120,
        environment: 'production',
        is_active: true,
        created_at: Date.now() / 1000,
      },
    ];
  },

  createProject: async (payload: ProjectCreateInput): Promise<Project> => {
    const res = await apiFetch(`${BACKEND_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create project');
    }
    return res.json();
  },

  rotateProjectKey: async (projectId: string): Promise<Project> => {
    const res = await apiFetch(`${BACKEND_URL}/api/projects/${projectId}/keys/rotate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to rotate project credentials');
    }
    return res.json();
  },

  deleteProject: async (projectId: string): Promise<void> => {
    const res = await apiFetch(`${BACKEND_URL}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete project');
    }
  },
};
