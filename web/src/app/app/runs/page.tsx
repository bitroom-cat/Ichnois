'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, RunItem, getSelectedProjectId, setSelectedProjectId } from '@/lib/api';
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  GitCommit,
  RotateCcw,
  Sparkles,
  Info,
  ChevronRight,
  ExternalLink,
  Plus,
  Play,
  X,
  Radio,
  FileCode,
  ShieldAlert,
  ArrowRight,
  Check,
  Send,
  Slash,
  Sliders,
  Cpu,
} from 'lucide-react';
import { RunStatusBadge, SeverityBadge } from '@/components/primitives/Badge';

export default function RunsListPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'gate1' | 'gate2' | 'published' | 'dismissed_rejected'>('all');
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayMode, setReplayMode] = useState<'auto' | 'gate1_manual'>('auto');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>('all');

  const fetchRuns = async (projId?: string) => {
    setLoading(true);
    try {
      const pid = projId !== undefined ? projId : getSelectedProjectId();
      const data = await api.getRuns(pid);
      setRuns(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialPid = getSelectedProjectId();
    setSelectedProjectIdState(initialPid);
    fetchRuns(initialPid);

    const onProjectChanged = () => {
      const updatedPid = getSelectedProjectId();
      setSelectedProjectIdState(updatedPid);
      fetchRuns(updatedPid);
    };

    window.addEventListener('project_changed', onProjectChanged);
    return () => window.removeEventListener('project_changed', onProjectChanged);
  }, []);

  const triggerReplay = async (fixture: 'payment_npe' | 'auth_jwt' | 'db_leak') => {
    setReplaying(true);
    try {
      const projId = selectedProjectId !== 'all' ? selectedProjectId : undefined;
      const newRun = await api.replaySavedFixture(fixture, projId);
      // If user selected manual Gate 1 staging simulation, drop it into staged_raw
      if (replayMode === 'gate1_manual') {
        const stagedRun = {
          ...newRun,
          status: 'staged_raw',
          culprit: null,
          explanation: null,
        };
        // update locally
        setRuns((prev) => [stagedRun, ...prev.filter((r) => r.id !== newRun.id)]);
        setReplayModalOpen(false);
        router.push(`/app/runs/${newRun.id}`);
        return;
      }
      setReplayModalOpen(false);
      router.push(`/app/runs/${newRun.id}`);
    } finally {
      setReplaying(false);
    }
  };

  // Quick inline actions for Gate 1 and Gate 2
  const handleGate1Approve = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      const updated = await api.gate1Approve(id, { reviewer: 'operator', notes: 'Approved from Control Center queue' });
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleGate1Dismiss = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      const updated = await api.gate1Dismiss(id, { reviewer: 'operator', reason: 'Dismissed as noise' });
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleGate2Approve = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      const updated = await api.gate2Approve(id, { reviewer: 'operator', notes: 'Quick published from queue' });
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleGate2Reject = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      const updated = await api.gate2Reject(id, { reviewer: 'operator', reason: 'Discarded by reviewer' });
      setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Bucket runs by Server B stages
  const gate1Runs = runs.filter((r) => r.status === 'staged_raw' || r.status === 'received');
  const gate2Runs = runs.filter(
    (r) => r.status === 'staged_draft' || r.status === 'draft_ready' || r.status === 'pending_approval'
  );
  const publishedRuns = runs.filter((r) => r.status === 'approved' || r.status === 'published');
  const dismissedOrRejectedRuns = runs.filter((r) => r.status === 'rejected' || r.status === 'dismissed');

  const filteredRuns = runs.filter((run) => {
    // Filter by tab
    if (activeTab === 'gate1' && run.status !== 'staged_raw' && run.status !== 'received') {
      return false;
    }
    if (
      activeTab === 'gate2' &&
      run.status !== 'staged_draft' &&
      run.status !== 'draft_ready' &&
      run.status !== 'pending_approval'
    ) {
      return false;
    }
    if (activeTab === 'published' && run.status !== 'approved' && run.status !== 'published') {
      return false;
    }
    if (activeTab === 'dismissed_rejected' && run.status !== 'rejected' && run.status !== 'dismissed') {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchMsg = (run.culprit?.message || '').toLowerCase().includes(q);
      const matchErr = (run.incident?.error_message || '').toLowerCase().includes(q);
      const matchType = (run.incident?.exception_type || '').toLowerCase().includes(q);
      const matchSha = (run.culprit?.sha || '').toLowerCase().includes(q);
      const matchAuthor = (run.culprit?.author_login || '').toLowerCase().includes(q);
      const matchFile = (run.incident?.file_path || '').toLowerCase().includes(q);
      if (!matchMsg && !matchErr && !matchType && !matchSha && !matchAuthor && !matchFile) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Server B Core Dual-Gate Architecture Infographic Bar */}
      <div className="rounded-xl border border-purple-200 dark:border-purple-800/40 bg-gradient-to-r from-purple-500/5 via-surface to-accent/5 p-4 text-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-600 text-white">
                Server B: Core Orchestrator
              </span>
              <span className="text-text-muted">•</span>
              <span className="text-text-secondary font-medium">Dual-Gated Autonomous Triage Pipeline</span>
            </div>
            <p className="text-text-muted text-[11px] leading-relaxed">
              Stage 1 holds raw Sentry telemetry in <code className="font-mono text-purple-600 font-semibold">staged_raw</code> (zero AI tokens).
              Auto-dispatch or human sign-off triggers AI blame correlator. Stage 2 prepares draft for GitHub &amp; Slack push.
            </p>
          </div>

          {/* Quick Flow Chips */}
          <div className="flex items-center gap-1.5 flex-wrap font-mono text-[11px]">
            <span className="px-2 py-1 rounded bg-canvas border border-border-subtle flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Gate 1: Ingest</span>
            </span>
            <ArrowRight className="w-3 h-3 text-text-muted" />
            <span className="px-2 py-1 rounded bg-canvas border border-border-subtle flex items-center gap-1">
              <Cpu className="w-3 h-3 text-purple-600" />
              <span>AI &amp; Blame</span>
            </span>
            <ArrowRight className="w-3 h-3 text-text-muted" />
            <span className="px-2 py-1 rounded bg-canvas border border-border-subtle flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span>Gate 2: Draft</span>
            </span>
            <ArrowRight className="w-3 h-3 text-text-muted" />
            <span className="px-2 py-1 rounded bg-canvas border border-border-subtle flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>GitHub / Slack</span>
            </span>
          </div>
        </div>
      </div>

      {/* Page Header (Render Style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary tracking-tight">Deploys &amp; Incident Triage</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Stage 1 raw crashes, AI &amp; blame synthesis pipeline, Gate 2 interactive draft review, and external dispatches.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchRuns()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors"
            title="Refresh deploys"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={() => setReplayModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Trigger Webhook</span>
          </button>
        </div>
      </div>

      {/* Search & Tabs Filter Row (Render Style) */}
      {selectedProjectId !== 'all' && (
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-600 dark:text-purple-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            <span>
              Filtered by Project: <strong className="font-mono">{selectedProjectId}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedProjectId('all');
            }}
            className="text-xs font-medium underline hover:text-purple-700 dark:hover:text-purple-300"
          >
            Show All Projects
          </button>
        </div>
      )}

      <div className="border-b border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3 pb-0">
        {/* Render Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'all'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>All Incidents</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-canvas border border-border-subtle text-text-muted">
              {runs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('gate1')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'gate1'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Gate 1: Ingest Queue</span>
            {gate1Runs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold">
                {gate1Runs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('gate2')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'gate2'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Gate 2: Draft Queue</span>
            {gate2Runs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-semibold">
                {gate2Runs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('published')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'published'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Published</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-canvas border border-border-subtle text-text-muted">
              {publishedRuns.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('dismissed_rejected')}
            className={`px-3 py-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'dismissed_rejected'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>Dismissed / Rejected</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-canvas border border-border-subtle text-text-muted">
              {dismissedOrRejectedRuns.length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative mb-2 md:mb-0 w-full md:w-80">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search commits, files, authors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-purple-600"
          />
        </div>
      </div>

      {/* Deploys List Stream (Render Style) */}
      <div className="space-y-2">
        {loading ? (
          <div className="py-20 text-center space-y-2">
            <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-text-muted">Loading deploy history...</p>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="py-16 text-center space-y-3 rounded-lg border border-border-subtle bg-surface">
            <div className="w-10 h-10 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-600 mx-auto flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">No incidents match this filter</p>
              <p className="text-xs text-text-muted mt-1">
                Try triggering a Sentry incident webhook or switching filters.
              </p>
            </div>
            <button
              onClick={() => setReplayModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Simulate Webhook</span>
            </button>
          </div>
        ) : (
          filteredRuns.map((run) => {
            const shortSha = run.culprit?.sha ? run.culprit.sha.slice(0, 7) : 'pending';
            const isGate1 = run.status === 'staged_raw' || run.status === 'received';
            const isGate2 = run.status === 'staged_draft' || run.status === 'draft_ready' || run.status === 'pending_approval';
            const isApproved = run.status === 'approved' || run.status === 'published';
            const isDismissed = run.status === 'dismissed';
            const isRejected = run.status === 'rejected';
            const displayTitle =
              run.draft_title ||
              run.culprit?.message ||
              `${run.incident?.exception_type || 'Error'}: ${run.incident?.error_message || ''}`;
            const triageDurationSec = ((run.metrics?.time_to_triage_ms || 1200) / 1000).toFixed(1);

            return (
              <div
                key={run.id}
                className="group block p-4 rounded-lg border border-border-subtle bg-surface hover:border-purple-400 dark:hover:border-purple-600/70 transition-all hover:shadow-xs"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Left Column: Status Icon & Details */}
                  <Link href={`/app/runs/${run.id}`} className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Status Dot / Indicator */}
                    <div className="mt-0.5 shrink-0">
                      {isApproved ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : isDismissed || isRejected ? (
                        <XCircle className="w-4 h-4 text-text-muted" />
                      ) : isGate1 ? (
                        <span className="relative flex h-3.5 w-3.5 mt-0.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500" />
                        </span>
                      ) : (
                        <span className="relative flex h-3.5 w-3.5 mt-0.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-purple-600" />
                        </span>
                      )}
                    </div>

                    {/* Commit & Metadata */}
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-text-primary group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors truncate">
                          {displayTitle}
                        </span>
                        <RunStatusBadge status={run.status} />
                        <SeverityBadge severity={run.severity} />
                        {run.is_regression && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 shrink-0">
                            Regression
                          </span>
                        )}
                      </div>

                      {/* Sub-line metadata */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted font-mono">
                        {/* Failing line */}
                        {run.incident?.file_path && (
                          <>
                            <span className="text-purple-600 dark:text-purple-400 font-medium">
                              {run.incident.file_path}:{run.incident.line_number}
                            </span>
                            <span>•</span>
                          </>
                        )}

                        {/* Commit SHA */}
                        {run.culprit?.sha && (
                          <>
                            <span className="inline-flex items-center gap-1 text-text-secondary bg-canvas px-1.5 py-0.5 rounded border border-border-subtle">
                              <GitCommit className="w-3 h-3" />
                              {shortSha}
                            </span>
                            <span>•</span>
                          </>
                        )}

                        {/* Author */}
                        <span>@{run.custom_assignee || run.culprit?.author_login || 'octocat'}</span>
                        <span>•</span>

                        {/* Env */}
                        <span className="text-emerald-600 font-medium">{run.incident?.environment || 'production'}</span>
                        <span>•</span>

                        {/* Impact */}
                        <span>
                          {run.incident?.users_affected || 0} users ({run.incident?.event_count || 1} events)
                        </span>
                      </div>
                    </div>
                  </Link>

                  {/* Right Column: Server B Gate Action Buttons */}
                  <div className="flex items-center justify-between lg:justify-end gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-border-subtle text-xs">
                    {/* Gate 1 Quick Actions: [Approve for AI] or [Dismiss/Spam] */}
                    {isGate1 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleGate1Dismiss(e, run.id)}
                          disabled={actionLoadingId === run.id}
                          className="px-2.5 py-1 rounded border border-border-subtle bg-surface hover:bg-hover text-text-muted hover:text-text-primary text-[11px] font-medium transition-colors"
                          title="Dismiss as spam/noise (zero AI tokens)"
                        >
                          Dismiss (Noise)
                        </button>
                        <button
                          onClick={(e) => handleGate1Approve(e, run.id)}
                          disabled={actionLoadingId === run.id}
                          className="flex items-center gap-1 px-3 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold shadow-xs transition-colors"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Approve for AI</span>
                        </button>
                      </div>
                    )}

                    {/* Gate 2 Quick Actions: [Approve & Publish] or [Reject] */}
                    {isGate2 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleGate2Reject(e, run.id)}
                          disabled={actionLoadingId === run.id}
                          className="px-2.5 py-1 rounded border border-border-subtle bg-surface hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 text-[11px] font-medium transition-colors"
                          title="Discard draft"
                        >
                          Reject
                        </button>
                        <button
                          onClick={(e) => handleGate2Approve(e, run.id)}
                          disabled={actionLoadingId === run.id}
                          className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold shadow-xs transition-colors"
                        >
                          <Send className="w-3 h-3" />
                          <span>Approve &amp; Publish</span>
                        </button>
                        <Link
                          href={`/app/runs/${run.id}`}
                          className="px-2.5 py-1 rounded border border-purple-300 dark:border-purple-700/60 text-purple-600 dark:text-purple-400 text-[11px] font-medium hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                        >
                          Review Draft
                        </Link>
                      </div>
                    )}

                    {/* Published Link */}
                    {isApproved && run.issue_url && (
                      <a
                        href={run.issue_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                      >
                        <span>GitHub Issue</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}

                    <Link href={`/app/runs/${run.id}`} className="p-1 text-text-muted hover:text-purple-600">
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sentry Webhook Simulation Modal */}
      {replayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface p-5 shadow-popover space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-purple-600 text-white flex items-center justify-center">
                  <Play className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-text-primary">Trigger Ingestion Webhook</h3>
                  <p className="text-[11px] text-text-muted">Simulate Sentry error event arrival at Gate 1</p>
                </div>
              </div>
              <button
                onClick={() => setReplayModalOpen(false)}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Ingestion Mode Choice */}
            <div className="space-y-1.5 p-3 rounded-lg bg-canvas border border-border-subtle text-xs">
              <span className="font-semibold text-text-primary block">Ingestion Mode:</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReplayMode('auto')}
                  className={`p-2 rounded border text-left transition-colors ${
                    replayMode === 'auto'
                      ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-600 font-semibold'
                      : 'border-border-subtle text-text-secondary hover:bg-surface'
                  }`}
                >
                  <div className="font-medium">Auto-Dispatch</div>
                  <div className="text-[10px] text-text-muted">Advances to AI pipeline</div>
                </button>
                <button
                  type="button"
                  onClick={() => setReplayMode('gate1_manual')}
                  className={`p-2 rounded border text-left transition-colors ${
                    replayMode === 'gate1_manual'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-600 font-semibold'
                      : 'border-border-subtle text-text-secondary hover:bg-surface'
                  }`}
                >
                  <div className="font-medium">Gate 1 Manual</div>
                  <div className="text-[10px] text-text-muted">Holds in staged_raw</div>
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-1 text-xs">
              <button
                onClick={() => triggerReplay('payment_npe')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle bg-canvas hover:border-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 transition-all flex items-start justify-between group"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-text-primary group-hover:text-purple-600">
                    Payment Gateway KeyError
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">
                    KeyError: stripe_customer_id in payment_gateway.py
                  </div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                    Suspect: d3e5f60 • P1-Critical
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-purple-600 mt-1" />
              </button>

              <button
                onClick={() => triggerReplay('auth_jwt')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle bg-canvas hover:border-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 transition-all flex items-start justify-between group"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-text-primary group-hover:text-purple-600">
                    Cart Checkout AttributeError
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">
                    AttributeError: NoneType has no calculate_tax
                  </div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                    Suspect: 7a8b9c0 • P2-High
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-purple-600 mt-1" />
              </button>

              <button
                onClick={() => triggerReplay('db_leak')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle bg-canvas hover:border-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 transition-all flex items-start justify-between group"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-text-primary group-hover:text-purple-600">
                    Edge Library Frame Last
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">
                    RuntimeError in urllib3 connection pool
                  </div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                    In-app frame detection heuristic • P3-Medium
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-purple-600 mt-1" />
              </button>
            </div>

            {replaying && (
              <div className="text-center text-xs text-purple-600 dark:text-purple-400 font-medium py-1 animate-pulse">
                Staging incident into Server B queue...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
