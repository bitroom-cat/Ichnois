'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, RunItem } from '@/lib/api';
import {
  RunStatusBadge,
  SeverityBadge,
  DomainBadge,
  ConfidenceBadge,
} from '@/components/primitives/Badge';
import { IssuePreview } from '@/components/IssuePreview';
import { LogViewer } from '@/components/primitives/LogViewer';
import { DiffView } from '@/components/primitives/DiffView';
import {
  ArrowLeft,
  GitCommit,
  GitPullRequest,
  FileCode,
  Calendar,
  Layers,
  Terminal,
  FileText,
  Code2,
  AlertTriangle,
  Clock,
  Radio,
  Send,
  XCircle,
  RotateCcw,
  CheckCircle2,
  ExternalLink,
  Users,
  Copy,
  Check,
  Sparkles,
  Info,
  ShieldAlert,
  ArrowRight,
  Slash,
  CheckSquare,
} from 'lucide-react';

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [run, setRun] = useState<RunItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'diff' | 'stack' | 'logs' | 'preview'>('overview');
  const [copiedSha, setCopiedSha] = useState(false);
  const [acting, setActing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (id) {
      setLoading(true);
      api
        .getRunById(id)
        .then((data) => {
          if (mounted) setRun(data);
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }
    return () => {
      mounted = false;
    };
  }, [id]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Gate 1 Actions
  const handleGate1Approve = async () => {
    if (!run) return;
    setActing(true);
    try {
      const updated = await api.gate1Approve(run.id, {
        reviewer: 'operator',
        notes: 'Operator approved raw crash for AI investigation',
      });
      setRun(updated);
      showToast('Gate 1 approved! AI & Git orchestration pipeline executed.');
    } catch (err: any) {
      alert(err?.message || 'Error approving Gate 1');
    } finally {
      setActing(false);
    }
  };

  const handleGate1Dismiss = async () => {
    if (!run) return;
    setActing(true);
    try {
      const updated = await api.gate1Dismiss(run.id, {
        reviewer: 'operator',
        reason: 'Dismissed by operator as non-actionable noise',
      });
      setRun(updated);
      showToast('Gate 1 dismissed. Staged incident archived with 0 AI tokens spent.');
    } catch (err: any) {
      alert(err?.message || 'Error dismissing Gate 1');
    } finally {
      setActing(false);
    }
  };

  // Gate 2 Actions
  const handleGate2Approve = async () => {
    if (!run) return;
    setActing(true);
    try {
      const updated = await api.gate2Approve(run.id, {
        reviewer: 'operator',
        notes: 'Human operator signed off draft issue for official publication',
      });
      setRun(updated);
      showToast('Gate 2 approved! GitHub issue opened & Slack card dispatched.');
    } catch (err: any) {
      alert(err?.message || 'Error approving draft');
    } finally {
      setActing(false);
    }
  };

  const handleGate2Reject = async () => {
    if (!run) return;
    setActing(true);
    try {
      const updated = await api.gate2Reject(run.id, {
        reviewer: 'operator',
        reason: 'Operator rejected draft without opening GitHub issue',
      });
      setRun(updated);
      showToast('Gate 2 rejected. Draft discarded without opening GitHub issue.');
    } catch (err: any) {
      alert(err?.message || 'Error rejecting draft');
    } finally {
      setActing(false);
    }
  };

  const handleRerun = async () => {
    if (!run) return;
    setActing(true);
    try {
      const updated = await api.rerunTriage(run.id);
      setRun(updated);
      showToast('Triage pipeline restarted.');
    } catch (err: any) {
      alert(err?.message || 'Error rerunning triage');
    } finally {
      setActing(false);
    }
  };

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  if (loading) {
    return (
      <div className="py-24 text-center space-y-3">
        <div className="w-7 h-7 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-text-muted font-medium">Loading Server B incident state &amp; audit trail...</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="py-24 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="text-base font-semibold text-text-primary">Incident Record Not Found</h2>
        <p className="text-xs text-text-muted">The requested run ID does not exist in the database.</p>
        <Link
          href="/app/runs"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Incidents
        </Link>
      </div>
    );
  }

  const isGate1 = run.status === 'staged_raw' || run.status === 'received';
  const isGate2 = run.status === 'staged_draft' || run.status === 'draft_ready' || run.status === 'pending_approval';
  const isApproved = run.status === 'approved' || run.status === 'published';
  const isDismissed = run.status === 'dismissed';
  const isRejected = run.status === 'rejected';

  const shortSha = run.culprit?.sha ? run.culprit.sha.slice(0, 7) : 'pending';
  const culpritAuthor = run.custom_assignee || run.culprit?.author_login || 'octocat';
  const culpritDiff = run.culprit?.diff || '--- Git Blame Correlator has not been executed yet ---';
  const hypothesis =
    run.explanation?.root_cause_hypothesis ||
    (isGate1
      ? 'Awaiting Gate 1 approval. Event is currently held in staged_raw (0 AI tokens spent).'
      : 'Automated synthesis analyzing call stack and recent commit diff.');
  const checklist =
    run.explanation?.checklist && run.explanation.checklist.length > 0
      ? run.explanation.checklist
      : ['Verify stack frame bounds', 'Inspect suspect commit diff', 'Validate fix in staging'];

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-lg bg-text-primary text-canvas text-xs font-medium shadow-popover animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Breadcrumb & Dual-Gate Flow Stepper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <Link
          href="/app/runs"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Control Center</span>
        </Link>

        {/* Server B Stage Progress Stepper */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 ${
              isGate1
                ? 'bg-amber-500/20 text-amber-500 font-bold border border-amber-500/30'
                : 'bg-canvas text-text-muted'
            }`}
          >
            <span>1. Ingest (Gate 1)</span>
          </span>
          <ArrowRight className="w-3 h-3 text-text-muted" />
          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 ${
              run.status === 'analyzing'
                ? 'bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30'
                : 'bg-canvas text-text-muted'
            }`}
          >
            <span>2. AI &amp; Git Pipeline</span>
          </span>
          <ArrowRight className="w-3 h-3 text-text-muted" />
          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 ${
              isGate2
                ? 'bg-purple-500/20 text-purple-400 font-bold border border-purple-500/30'
                : 'bg-canvas text-text-muted'
            }`}
          >
            <span>3. Draft (Gate 2)</span>
          </span>
          <ArrowRight className="w-3 h-3 text-text-muted" />
          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 ${
              isApproved
                ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                : isDismissed || isRejected
                ? 'bg-surface text-text-muted'
                : 'bg-canvas text-text-muted'
            }`}
          >
            <span>4. Dispatch</span>
          </span>
        </div>
      </div>

      {/* SPECIAL CALLOUT FOR GATE 1 (STAGE 1: INGESTION STAGING QUEUE) */}
      {isGate1 && (
        <div className="p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-canvas font-mono">
                  Stage 1: Gate 1 Raw Ingest
                </span>
                <span className="text-xs font-semibold text-text-primary">
                  Awaiting Operator Investigation Approval
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Incoming error arrived at <code className="font-mono text-purple-600">/webhook/sentry</code> and is staged as{' '}
                <code className="font-mono text-purple-600 font-semibold">staged_raw</code>. Zero AI tokens and zero GitHub calls have been made.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleGate1Dismiss}
                disabled={acting}
                className="px-3 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-hover text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
                title="Dismiss as spam/noise with zero AI tokens spent"
              >
                Dismiss / Spam
              </button>
              <button
                onClick={handleGate1Approve}
                disabled={acting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{acting ? 'Running Pipeline...' : 'Approve for AI Investigation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPECIAL CALLOUT FOR GATE 2 (STAGE 2: DRAFT ISSUE STAGING) */}
      {isGate2 && (
        <div className="p-4 sm:p-5 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-600 text-white font-mono">
                  Stage 2: Gate 2 Review Queue
                </span>
                <span className="text-xs font-semibold text-text-primary">
                  Draft Assembled • Human Review Cockpit
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Stack frames normalized, suspect commit correlated via GraphQL blame, and LLM hypothesis generated. Review &amp; customize draft before opening official GitHub issue.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleGate2Reject}
                disabled={acting}
                className="px-3 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 text-xs font-medium transition-colors"
                title="Discard draft without creating an issue"
              >
                Reject Draft
              </button>
              <button
                onClick={handleGate2Approve}
                disabled={acting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{acting ? 'Publishing...' : 'Approve & Publish to GitHub'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Incident Hero Title */}
      <div className="space-y-1.5 pt-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wider">
            {run.incident?.exception_type || 'Error'}
          </span>
          <span className="text-text-muted">•</span>
          <span className="font-mono text-text-muted">fp:{run.fingerprint}</span>
          <RunStatusBadge status={run.status} />
          <SeverityBadge severity={run.severity} />
          {run.is_regression && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
              Regression
            </span>
          )}
        </div>

        <h1 className="text-lg sm:text-xl font-bold text-text-primary tracking-tight leading-snug">
          {run.draft_title || run.culprit?.message || run.incident?.error_message}
        </h1>

        <p className="text-xs text-text-secondary font-mono">
          Failing at{' '}
          <span className="text-purple-600 dark:text-purple-400 font-semibold">
            {run.incident?.file_path}:{run.incident?.line_number}
          </span>{' '}
          • {run.incident?.error_message}
        </p>
      </div>

      {/* Signature 2x3 Metadata Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Card 1: STATUS */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <div className="mt-0.5">
            {isApproved ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : isDismissed || isRejected ? (
              <XCircle className="w-4 h-4 text-rose-500" />
            ) : isGate1 ? (
              <Clock className="w-4 h-4 text-amber-500" />
            ) : (
              <Sparkles className="w-4 h-4 text-purple-600" />
            )}
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Stage / Status
            </div>
            <div className="font-medium text-xs text-text-primary flex items-center gap-1.5">
              <span>
                {isApproved
                  ? 'Published | Live on GitHub'
                  : isGate1
                  ? 'Stage 1: Gate 1 Raw Inbox'
                  : isGate2
                  ? 'Stage 2: Gate 2 Draft Ready'
                  : isDismissed
                  ? 'Gate 1 Dismissed (Noise)'
                  : 'Rejected'}
              </span>
            </div>
            {run.issue_url && (
              <a
                href={run.issue_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 mt-0.5"
              >
                <span>GitHub Issue</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Card 2: DURATION / SPEED */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <Clock className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Pipeline Duration
            </div>
            <div className="font-medium text-xs text-text-primary font-mono">
              {((run.metrics?.time_to_triage_ms || 1200) / 1000).toFixed(2)}s
            </div>
            <div className="text-[11px] text-text-muted">
              Model: {run.metrics?.llm_provider || 'groq/llama-3.3-70b'}
            </div>
          </div>
        </div>

        {/* Card 3: OCCURRED / DEPLOYED */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <Calendar className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Occurred At
            </div>
            <div className="font-medium text-xs text-text-primary truncate">
              {new Date(run.incident?.first_seen || run.created_at).toLocaleString()}
            </div>
            <div className="text-[11px] text-text-muted">
              Release SHA:{' '}
              <code className="font-mono text-purple-600">
                {run.incident?.release_sha ? run.incident.release_sha.slice(0, 7) : 'HEAD'}
              </code>
            </div>
          </div>
        </div>

        {/* Card 4: TRIGGER / SOURCE */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <Radio className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Ingress &amp; Gate Mode
            </div>
            <div className="font-medium text-xs text-text-primary">
              {isGate1 ? 'Gate 1 Ingestion Queue' : 'Server B Orchestration'}
            </div>
            <div className="text-[11px] text-text-muted">
              Severity: <span className="font-semibold text-text-primary">{run.severity}</span>
            </div>
          </div>
        </div>

        {/* Card 5: SUSPECT COMMIT */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <GitCommit className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Suspect Commit
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-purple-600 dark:text-purple-400 font-semibold">{shortSha}</span>
              {run.culprit?.sha && (
                <button
                  onClick={() => handleCopySha(run.culprit!.sha)}
                  className="text-text-muted hover:text-text-primary p-0.5"
                  title="Copy full SHA"
                >
                  {copiedSha ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
            <div className="text-[11px] text-text-muted truncate">
              Author: @{culpritAuthor}
            </div>
          </div>
        </div>

        {/* Card 6: IMPACT */}
        <div className="p-3.5 rounded-lg border border-border-subtle bg-surface flex items-start gap-3">
          <Users className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider font-mono">
              Impact &amp; Environment
            </div>
            <div className="font-medium text-xs text-text-primary">
              {run.incident?.users_affected || 0} users • {run.incident?.event_count || 1} events
            </div>
            <div className="text-[11px] text-text-muted">
              Environment:{' '}
              <span className="text-emerald-600 font-medium">
                {run.incident?.environment || 'production'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* DUAL-GATE AUDIT TRAIL CARD */}
      {(run.gate1_review || run.gate2_review) && (
        <div className="p-4 rounded-lg border border-border-subtle bg-surface text-xs space-y-2.5">
          <h3 className="font-semibold uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
            Server B Dual-Gate Audit Trail
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {run.gate1_review && (
              <div className="p-3 rounded-md bg-canvas border border-border-subtle space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary">Gate 1 Ingestion Audit</span>
                  <span className="font-mono text-[10px] text-text-muted uppercase">
                    {run.gate1_review.action || 'approved'}
                  </span>
                </div>
                <p className="text-text-secondary text-[11px]">
                  Decided by <code className="font-mono text-purple-600">{run.gate1_review.approved_by || 'policy'}</code>
                  {run.gate1_review.reason && ` • Notes: "${run.gate1_review.reason}"`}
                </p>
              </div>
            )}

            {run.gate2_review && (
              <div className="p-3 rounded-md bg-canvas border border-border-subtle space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary">Gate 2 Draft Review Audit</span>
                  <span className="font-mono text-[10px] text-text-muted uppercase">
                    {run.gate2_review.action || 'approved'}
                  </span>
                </div>
                <p className="text-text-secondary text-[11px]">
                  Decided by <code className="font-mono text-purple-600">{run.gate2_review.approved_by || 'policy'}</code>
                  {run.gate2_review.reason && ` • Notes: "${run.gate2_review.reason}"`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle pt-2 pb-0">
        <div className="flex items-center gap-1 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'overview'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Overview &amp; Synthesis</span>
          </button>

          <button
            onClick={() => setActiveTab('diff')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'diff'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Suspect Code Diff</span>
          </button>

          <button
            onClick={() => setActiveTab('stack')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'stack'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Stack Excerpt</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'logs'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Execution Logs</span>
          </button>

          <button
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'preview'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>GitHub Issue Draft (Gate 2)</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pb-2 sm:pb-1">
          {isGate1 && (
            <>
              <button
                onClick={handleGate1Dismiss}
                disabled={acting}
                className="px-2.5 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-hover text-text-secondary text-xs font-medium transition-colors"
              >
                Dismiss (Spam)
              </button>
              <button
                onClick={handleGate1Approve}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Approve for AI</span>
              </button>
            </>
          )}

          {isGate2 && (
            <>
              <button
                onClick={handleGate2Reject}
                disabled={acting}
                className="px-2.5 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 text-xs font-medium transition-colors"
              >
                Reject
              </button>
              <button
                onClick={handleGate2Approve}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Approve &amp; Publish</span>
              </button>
            </>
          )}

          <button
            onClick={handleRerun}
            disabled={acting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors"
            title="Re-run automated investigation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Re-run</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Overview & Synthesis */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="p-4 sm:p-5 rounded-lg border border-border-subtle bg-surface space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                Why It Probably Failed (LLM Root Cause Synthesis)
              </h3>
              <span className="text-[11px] font-mono text-text-muted">
                Confidence: {run.culprit?.confidence || 'high'}
              </span>
            </div>
            <p className="text-xs text-text-primary leading-relaxed bg-canvas p-3 rounded-md border border-border-subtle font-sans">
              {hypothesis}
            </p>
          </div>

          {/* 3-Step Verification Checklist */}
          <div className="p-4 sm:p-5 rounded-lg border border-border-subtle bg-surface space-y-3">
            <h3 className="font-semibold text-xs uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Verification Steps (Actionable Triage Checklist)
            </h3>
            <div className="space-y-2">
              {checklist.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-2.5 rounded bg-canvas border border-border-subtle text-xs text-text-primary"
                >
                  <span className="w-4 h-4 rounded border border-border-strong text-purple-600 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-mono font-bold">
                    {idx + 1}
                  </span>
                  <span className="leading-snug">{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Diff Excerpt */}
          <div className="p-4 sm:p-5 rounded-lg border border-border-subtle bg-surface space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-purple-600" />
                Suspect Code Diff Preview
              </h3>
              <button onClick={() => setActiveTab('diff')} className="text-xs text-purple-600 hover:underline">
                Expand full diff →
              </button>
            </div>
            <DiffView diff={culpritDiff} filename={run.incident?.file_path} />
          </div>
        </div>
      )}

      {/* Tab 2: Full Suspect Commit Diff */}
      {activeTab === 'diff' && (
        <div className="p-4 sm:p-5 rounded-lg border border-border-subtle bg-surface space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle text-xs">
            <div className="font-mono text-text-primary font-semibold flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-purple-600" />
              <span>{run.incident?.file_path || 'services/app.py'}</span>
            </div>
            <div className="text-text-muted font-mono">
              Commit {shortSha} by @{culpritAuthor}
            </div>
          </div>
          <DiffView diff={culpritDiff} filename={run.incident?.file_path} />
        </div>
      )}

      {/* Tab 3: Stack Excerpt */}
      {activeTab === 'stack' && (
        <div className="p-4 sm:p-5 rounded-lg border border-border-subtle bg-surface space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle text-xs">
            <h3 className="font-semibold text-text-primary">Failing Stack Trace Excerpt</h3>
            <span className="text-text-muted font-mono text-[11px]">
              Last in-app frame: line {run.incident?.line_number}
            </span>
          </div>
          <pre className="font-mono text-xs bg-canvas p-4 rounded-md border border-border-subtle text-text-secondary overflow-x-auto whitespace-pre leading-relaxed">
            {run.incident?.stack_excerpt || run.incident?.stack_trace || 'No stack excerpt recorded.'}
          </pre>
        </div>
      )}

      {/* Tab 4: Execution Logs */}
      {activeTab === 'logs' && (
        <div className="rounded-lg border border-border-subtle overflow-hidden">
          <LogViewer logs={run.logs} />
        </div>
      )}

      {/* Tab 5: GitHub Issue Draft (Gate 2 Review Cockpit) */}
      {activeTab === 'preview' && (
        <div className="rounded-lg border border-border-subtle bg-surface p-4 sm:p-6">
          <IssuePreview
            run={run}
            editable={isGate2}
            onDraftSaved={(updated) => {
              setRun(updated);
              showToast('Draft title, assignee, and checklist saved!');
            }}
          />
        </div>
      )}
    </div>
  );
}
