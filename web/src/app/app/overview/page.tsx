'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  Globe,
  Activity,
  Layers,
  Flame,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  GitPullRequest,
  Bot,
  Zap,
  Server,
  Terminal,
  ExternalLink,
  ChevronRight,
  Sliders,
} from 'lucide-react';

export default function GlobalOverviewPage() {
  const router = useRouter();
  const { metrics, projects, loading, refreshMetrics, selectWorkspace } = useWorkspace();

  const handleOpenProject = (projectId: string) => {
    selectWorkspace(projectId);
    router.push(`/app/projects/${projectId}`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border-subtle bg-gradient-to-br from-purple-900/20 via-surface to-canvas p-6 sm:p-8 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <Globe className="w-3.5 h-3.5" />
              <span>Global Operations Center</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
              Fleet Operations & Dual-Gate Triage
            </h1>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              Real-time monitoring across all microservice projects. Ingesting distributed Sentry error telemetry,
              evaluating Gate 1 triage, synthesizing AI root-cause blame, and staging Gate 2 pull requests.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => refreshMetrics()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface hover:bg-hover text-text-primary transition-all shadow-sm"
              title="Refresh Metrics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <Link
              href="/app/projects"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20 transition-all"
            >
              <Layers className="w-4 h-4" />
              <span>Manage Fleet</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Fleet KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium">
            <span>Total Incidents</span>
            <Activity className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-text-primary">
            {metrics?.total_runs ?? 0}
          </div>
          <div className="text-[11px] text-text-muted flex items-center gap-1 font-mono">
            <Zap className="w-3 h-3 text-amber-500" />
            <span>{metrics?.incident_rate_per_min ?? 0} ev/min</span>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium">
            <span>Gate 1: Raw Queue</span>
            <Flame className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400">
            {metrics?.staged_raw_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted">Awaiting triage/AI</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium">
            <span>Gate 2: Draft Queue</span>
            <GitPullRequest className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-600 dark:text-indigo-400">
            {metrics?.staged_draft_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted">Ready for review</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium">
            <span>Published Fixes</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            {metrics?.published_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted">Pushed to GitHub</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm shadow-sm col-span-2 lg:col-span-1 space-y-1">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium">
            <span>Active Services</span>
            <Server className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-text-primary">
            {projects.length}
          </div>
          <div className="text-[11px] text-text-muted">Live microservices</div>
        </div>
      </div>

      {/* Dual-Gate Architecture Workflow Visualization */}
      <div className="p-6 rounded-2xl border border-border-subtle bg-surface/50 backdrop-blur-sm shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-purple-500" />
            <h2 className="text-base font-bold text-text-primary">Dual-Gate Autonomous Triage Pipeline</h2>
          </div>
          <span className="text-xs text-text-muted font-mono">Semi-Autonomous Mode</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl border border-border-subtle bg-surface-raised/40 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500">Step 1</span>
              <Terminal className="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div className="text-xs font-bold text-text-primary">Telemetry Ingress</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              SDK & Sentry envelopes ingested via dedicated microservice endpoints.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Gate 1</span>
              <Flame className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="text-xs font-bold text-text-primary">Raw Staging Queue</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Operator manual approve or automated policy rule advancement (0 tokens spent on spam).
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-border-subtle bg-surface-raised/40 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Step 3</span>
              <Bot className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <div className="text-xs font-bold text-text-primary">AI & Git Synthesis</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Git blame correlation, stack trace normalization, and LLM hypothesis generation.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Gate 2</span>
              <GitPullRequest className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <div className="text-xs font-bold text-text-primary">Draft Verification</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Human review checklist, editable title, assignee override, and approve/reject.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Step 5</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-xs font-bold text-text-primary">GitHub Dispatch</div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Published directly as GitHub Issue or PR with Slack team notification.
            </p>
          </div>
        </div>
      </div>

      {/* Fleet Microservices Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">Fleet Microservices ({projects.length})</h2>
            <p className="text-xs text-text-secondary">Click on any microservice to enter its scoped project workspace.</p>
          </div>
          <Link
            href="/app/runs"
            className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
          >
            <span>View All Fleet Incidents</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => {
            const projectSummary = metrics?.projects?.find((p) => p.project_id === proj.project_id);
            const status = projectSummary?.status || 'healthy';

            return (
              <div
                key={proj.project_id}
                onClick={() => handleOpenProject(proj.project_id)}
                className="group relative p-5 rounded-xl border border-border-subtle bg-surface hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/5 transition-all cursor-pointer flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform">
                        <Server className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-text-primary group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                          {proj.name}
                        </h3>
                        <div className="text-[11px] font-mono text-text-muted">
                          {proj.project_id}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        status === 'healthy'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : status === 'degraded'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {status}
                    </span>
                  </div>

                  {proj.description && (
                    <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                      {proj.description}
                    </p>
                  )}

                  <div className="pt-2 border-t border-border-subtle grid grid-cols-3 gap-2 text-center">
                    <div className="p-1.5 rounded bg-surface-raised/40">
                      <div className="text-[10px] text-text-muted">Runs</div>
                      <div className="text-xs font-bold text-text-primary">
                        {projectSummary?.total_runs ?? 0}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-surface-raised/40">
                      <div className="text-[10px] text-text-muted">Gate 1</div>
                      <div className="text-xs font-bold text-amber-500">
                        {projectSummary?.staged_raw_count ?? 0}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-surface-raised/40">
                      <div className="text-[10px] text-text-muted">Gate 2</div>
                      <div className="text-xs font-bold text-indigo-500">
                        {projectSummary?.staged_draft_count ?? 0}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
                  <span className="font-mono text-[11px]">env: {proj.environment}</span>
                  <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 font-semibold group-hover:translate-x-0.5 transition-transform">
                    <span>Enter Hub</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
