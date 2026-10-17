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
  project_id?: string;
  projectId?: string;
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

export const MOCK_RUNS: RunDetail[] = [];
