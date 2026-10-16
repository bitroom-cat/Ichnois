'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api, RunItem, Project } from '@/lib/api';
import {
  FolderKanban,
  Globe,
  Activity,
  Layers,
  Flame,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Copy,
  Check,
  Terminal,
  Code,
  Github,
  Settings,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Clock,
} from 'lucide-react';

const EDGE_INGEST_URL = process.env.NEXT_PUBLIC_EDGE_GATEWAY_URL || 'https://ichnoisapi.onrender.com';

export default function ProjectWorkspaceHubPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = (params?.projectId as string) || '';

  const { projects, selectWorkspace, refreshMetrics } = useWorkspace();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeSdkTab, setActiveSdkTab] = useState<'python' | 'node' | 'curl'>('python');

  // Sync workspace context
  useEffect(() => {
    if (projectId) {
      selectWorkspace(projectId);
    }
  }, [projectId, selectWorkspace]);

  // Load project details and scoped runs
  const loadProjectData = async () => {
    setLoading(true);
    try {
      const allProjects = projects.length > 0 ? projects : await api.getProjects();
      const current = allProjects.find((p) => p.project_id === projectId) || null;
      setProject(current);

      const scopedRuns = await api.getRuns(projectId);
      setRuns(scopedRuns);
    } catch (err) {
      console.error('Failed to load project hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjectData();
  }, [projectId, projects]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const dsnUrl = project
    ? `https://${project.public_key}@${EDGE_INGEST_URL.replace(/^https?:\/\//, '')}/api/${project.project_id}`
    : `https://<public_key>@${EDGE_INGEST_URL.replace(/^https?:\/\//, '')}/api/${projectId}`;

  const stagedRawCount = runs.filter((r) => r.status === 'staged_raw').length;
  const stagedDraftCount = runs.filter((r) => r.status === 'staged_draft' || r.status === 'draft_ready').length;
  const publishedCount = runs.filter((r) => r.status === 'published').length;

  const pythonSnippet = `import sentry_sdk

sentry_sdk.init(
    dsn="${dsnUrl}",
    environment="${project?.environment || 'production'}",
    traces_sample_rate=1.0,
)`;

  const nodeSnippet = `import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "${dsnUrl}",
  environment: "${project?.environment || 'production'}",
  tracesSampleRate: 1.0,
});`;

  const curlSnippet = `curl -X POST "${EDGE_INGEST_URL}/api/${projectId}/store/" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Test incident from ${projectId}", "level": "error"}'`;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div className="space-y-1">
          <button
            onClick={() => {
              selectWorkspace('global');
              router.push('/app/overview');
            }}
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-1 font-medium group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Switch to Fleet Overview</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-sm shrink-0 border border-purple-500/20">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-text-primary">
                  {project?.name || projectId}
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-surface-sunken text-text-muted border border-border-subtle">
                  {project?.environment || 'production'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Scoped Workspace</span>
                </span>
              </div>
              <p className="text-xs text-text-secondary font-mono mt-0.5">
                ID: {projectId} {project?.github_repo && `• Repo: ${project.github_repo}`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadProjectData}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface hover:bg-hover text-text-primary transition-all shadow-sm"
            title="Refresh Scoped Runs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link
            href={`/app/settings?project=${projectId}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface hover:bg-hover text-text-primary transition-all shadow-sm"
          >
            <Settings className="w-3.5 h-3.5 text-text-muted" />
            <span>Service Settings</span>
          </Link>
          <Link
            href={`/app/runs?project=${projectId}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20 transition-all"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>View All Runs ({runs.length})</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-xl border border-border-subtle bg-surface/70 backdrop-blur-sm space-y-1">
          <div className="text-text-muted text-xs font-medium">Total Runs</div>
          <div className="text-2xl sm:text-3xl font-black text-text-primary">{runs.length}</div>
          <div className="text-[11px] text-text-muted">Scoped to this microservice</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-1">
          <div className="text-amber-600 dark:text-amber-400 text-xs font-medium flex items-center justify-between">
            <span>Gate 1: Raw Queue</span>
            <Flame className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400">
            {stagedRawCount}
          </div>
          <div className="text-[11px] text-text-muted">Awaiting triage / AI dispatch</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 space-y-1">
          <div className="text-indigo-600 dark:text-indigo-400 text-xs font-medium flex items-center justify-between">
            <span>Gate 2: Draft Queue</span>
            <GitPullRequest className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-600 dark:text-indigo-400">
            {stagedDraftCount}
          </div>
          <div className="text-[11px] text-text-muted">High-confidence drafts for review</div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1">
          <div className="text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center justify-between">
            <span>Published</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            {publishedCount}
          </div>
          <div className="text-[11px] text-text-muted">Resolved & pushed to GitHub</div>
        </div>
      </div>

      {/* Telemetry Ingress & Sentry DSN */}
      <div className="p-6 rounded-2xl border border-border-subtle bg-surface/50 backdrop-blur-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-500" />
              <h2 className="text-base font-bold text-text-primary">Sentry SDK & Telemetry Ingress</h2>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Route microservice crash reports directly to Ichnoscope via drop-in Sentry DSN.
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-surface-raised border border-border-subtle self-start sm:self-auto">
            <button
              onClick={() => setActiveSdkTab('python')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSdkTab === 'python'
                  ? 'bg-purple-600 text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Python
            </button>
            <button
              onClick={() => setActiveSdkTab('node')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSdkTab === 'node'
                  ? 'bg-purple-600 text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Node.js / TS
            </button>
            <button
              onClick={() => setActiveSdkTab('curl')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSdkTab === 'curl'
                  ? 'bg-purple-600 text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              cURL Ingress
            </button>
          </div>
        </div>

        {/* Copyable DSN Banner */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border-subtle bg-canvas/80 font-mono text-xs">
          <div className="truncate text-text-primary select-all">
            <span className="text-text-muted">DSN: </span>
            {dsnUrl}
          </div>
          <button
            onClick={() => copyToClipboard(dsnUrl, 'dsn')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface hover:bg-hover text-xs font-sans font-medium text-text-primary shrink-0 transition-colors"
          >
            {copied === 'dsn' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied === 'dsn' ? 'Copied' : 'Copy DSN'}</span>
          </button>
        </div>

        {/* Code Snippet Box */}
        <div className="relative rounded-xl border border-border-subtle bg-canvas/90 p-4 font-mono text-xs text-text-secondary overflow-x-auto">
          <button
            onClick={() => {
              const code = activeSdkTab === 'python' ? pythonSnippet : activeSdkTab === 'node' ? nodeSnippet : curlSnippet;
              copyToClipboard(code, 'snippet');
            }}
            className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border-subtle text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            {copied === 'snippet' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>Copy</span>
          </button>
          <pre className="pr-12">
            {activeSdkTab === 'python' && pythonSnippet}
            {activeSdkTab === 'node' && nodeSnippet}
            {activeSdkTab === 'curl' && curlSnippet}
          </pre>
        </div>
      </div>

      {/* Scoped Incidents Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">Recent Incidents ({runs.length})</h2>
            <p className="text-xs text-text-secondary">Incident triage history scoped to {project?.name || projectId}.</p>
          </div>
          <Link
            href={`/app/runs?project=${projectId}`}
            className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
          >
            <span>Open Full Triage Board</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {runs.length === 0 ? (
          <div className="p-8 rounded-xl border border-border-subtle bg-surface text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-text-primary">No Incidents Staged for this Project</div>
            <p className="text-xs text-text-muted max-w-md mx-auto">
              This microservice has a clean record. Trigger a test error via the cURL snippet above or ingest Sentry events to start autonomous triage.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-raised/40 text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3">Incident / Error</th>
                  <th className="px-4 py-3">Stage / Gate</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">File Location</th>
                  <th className="px-4 py-3">Suspect Author</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {runs.slice(0, 10).map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => router.push(`/app/runs/${run.id}`)}
                    className="hover:bg-hover transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 max-w-[260px]">
                      <div className="font-semibold text-text-primary truncate">
                        {run.incident.exception_type || 'Unknown Exception'}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {run.incident.error_message || run.id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          run.status === 'staged_raw'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            : run.status === 'staged_draft' || run.status === 'draft_ready'
                            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                            : run.status === 'published'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-surface-sunken text-text-muted border border-border-subtle'
                        }`}
                      >
                        {run.status === 'staged_raw'
                          ? 'Gate 1 (Raw)'
                          : run.status === 'staged_draft'
                          ? 'Gate 2 (Draft)'
                          : run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          run.severity === 'P1-Critical'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {run.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-text-muted truncate max-w-[180px]">
                      {run.incident.file_path}:{run.incident.line_number}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {run.culprit.author_login ? `@${run.culprit.author_login}` : 'Auto-correlated'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-purple-600 dark:text-purple-400 font-semibold hover:underline">
                        Review ?
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
