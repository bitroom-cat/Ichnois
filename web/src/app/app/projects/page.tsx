'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  Project,
  ProjectCreateInput,
  GitHubRepo,
  setSelectedProjectId,
} from '@/lib/api';
import {
  Plus,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  ExternalLink,
  Link2,
  RefreshCw,
  Shield,
  Key,
  FolderKanban,
  Github,
  MessageSquare,
  Activity,
  Code,
  Terminal,
  AlertTriangle,
  X,
  Sparkles,
} from 'lucide-react';

const EDGE_INGEST_URL = process.env.NEXT_PUBLIC_EDGE_GATEWAY_URL || 'https://ichnoisapi.onrender.com';

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sdkModalProject, setSdkModalProject] = useState<Project | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // GitHub Modal State
  const [githubModalProject, setGithubModalProject] = useState<Project | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubInstallUrl, setGithubInstallUrl] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [customRepoInput, setCustomRepoInput] = useState('');
  const [manualInstallationId, setManualInstallationId] = useState('');
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEnv, setFormEnv] = useState('production');
  const [formRateLimit, setFormRateLimit] = useState(120);
  const [formGithubRepo, setFormGithubRepo] = useState('');
  const [formSlackChannel, setFormSlackChannel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleOpenGithubModal = async (project: Project) => {
    setGithubModalProject(project);
    setGithubLoading(true);
    setGithubRepos([]);
    setSelectedRepo(project.github_repo || project.github_repo_override || '');
    setCustomRepoInput(project.github_repo || project.github_repo_override || '');
    setManualInstallationId(project.github_installation_id || '');
    try {
      const data = await api.getGitHubInstallUrl(project.project_id);
      setGithubInstallUrl(data.install_url);
      if (project.github_installation_id) {
        const repos = await api.getGitHubRepos(project.project_id, project.github_installation_id);
        setGithubRepos(repos);
      }
    } catch (err: any) {
      console.warn('Could not load github info:', err);
    } finally {
      setGithubLoading(false);
    }
  };

  const handleFetchReposForInstall = async () => {
    if (!githubModalProject || !manualInstallationId.trim()) return;
    setGithubLoading(true);
    try {
      const repos = await api.getGitHubRepos(githubModalProject.project_id, manualInstallationId.trim());
      setGithubRepos(repos);
      if (repos.length > 0 && !selectedRepo) {
        setSelectedRepo(repos[0].full_name);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to fetch repositories for this installation ID');
    } finally {
      setGithubLoading(false);
    }
  };

  const handleConnectRepo = async () => {
    if (!githubModalProject) return;
    const repoToLink = selectedRepo.trim() || customRepoInput.trim();
    if (!repoToLink) {
      alert('Please select or specify a repository');
      return;
    }

    setIsConnectingGithub(true);
    try {
      const instId = manualInstallationId.trim() || githubModalProject.github_installation_id || 'manual';
      await api.connectGitHubRepo(githubModalProject.project_id, instId, repoToLink);
      await loadProjects();
      setGithubModalProject(null);
    } catch (err: any) {
      alert(err.message || 'Failed to link GitHub repository');
    } finally {
      setIsConnectingGithub(false);
    }
  };

  const handleDisconnectRepo = async (project: Project) => {
    if (!confirm(`Are you sure you want to disconnect GitHub from "${project.name}"?`)) return;
    setActionLoadingId(project.project_id);
    try {
      await api.disconnectGitHubRepo(project.project_id);
      await loadProjects();
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect repository');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const payload: ProjectCreateInput = {
        name: formName.trim(),
        environment: formEnv,
        rate_limit_min: Number(formRateLimit) || 120,
        github_repo_override: formGithubRepo.trim() || undefined,
        slack_channel_override: formSlackChannel.trim() || undefined,
      };

      const newProj = await api.createProject(payload);
      setCreateModalOpen(false);
      setFormName('');
      setFormGithubRepo('');
      setFormSlackChannel('');
      setFormRateLimit(120);
      await loadProjects();
      setSdkModalProject(newProj);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRotateKey = async (project: Project) => {
    if (!confirm(`Are you sure you want to rotate telemetry keys for "${project.name}"? The previous DSN key will be revoked immediately.`)) {
      return;
    }

    setActionLoadingId(project.project_id);
    try {
      const updated = await api.rotateProjectKey(project.project_id);
      await loadProjects();
      setSdkModalProject(updated);
    } catch (err: any) {
      alert(err.message || 'Key rotation failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (project: Project) => {
    if (project.project_id === 'proj_default') {
      alert('The default project cannot be deleted.');
      return;
    }

    if (!confirm(`Are you sure you want to delete project "${project.name}" (${project.project_id})?`)) {
      return;
    }

    setActionLoadingId(project.project_id);
    try {
      await api.deleteProject(project.project_id);
      await loadProjects();
    } catch (err: any) {
      alert(err.message || 'Deletion failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleFilterRuns = (projectId: string) => {
    setSelectedProjectId(projectId);
    router.push('/app/runs');
  };

  const getDsn = (proj: Project) => {
    return `${EDGE_INGEST_URL.replace('http://', 'https://')}/api/${proj.project_id}/store/`;
  };

  const getSentryDsn = (proj: Project) => {
    const host = EDGE_INGEST_URL.replace('http://', '').replace('https://', '');
    return `https://${proj.public_key}@${host}/${proj.project_id}`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              Projects & Telemetry DSNs
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              Multi-Service
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Generate isolated DSN keys per service, route incidents to custom GitHub repositories, and manage edge quotas.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Projects List */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-text-muted gap-2 text-xs">
          <Activity className="w-5 h-5 animate-spin text-purple-500" />
          <span>Loading registered projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="border border-border-subtle rounded-lg p-8 text-center bg-surface-raised/30">
          <FolderKanban className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-text-primary">No Projects Configured</h3>
          <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto">
            Create your first application project to generate dedicated telemetry keys and configure repo routing.
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="mt-4 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            Create First Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {projects.map((proj) => {
            const sentryDsn = getSentryDsn(proj);
            const isDefault = proj.project_id === 'proj_default';
            const isBusy = actionLoadingId === proj.project_id;

            return (
              <div
                key={proj.project_id}
                className="border border-border-subtle rounded-lg bg-surface hover:border-border-strong transition-all shadow-xs p-4 sm:p-5 flex flex-col gap-4"
              >
                {/* Row 1: Header & Badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-subtle/50 pb-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="w-7 h-7 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs shrink-0 border border-purple-500/20">
                      {proj.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-text-primary">{proj.name}</span>
                        {isDefault && (
                          <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded bg-surface-sunken text-text-muted border border-border-subtle uppercase tracking-wider">
                            Default
                          </span>
                        )}
                        <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {proj.environment}
                        </span>
                      </div>
                      <span className="text-[11px] text-text-muted font-mono">{proj.project_id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleFilterRuns(proj.project_id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-surface-raised hover:bg-hover border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Activity className="w-3 h-3 text-purple-500" />
                      <span>View Incidents</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSdkModalProject(proj)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-surface-raised hover:bg-hover border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Code className="w-3 h-3" />
                      <span>SDK Snippets</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRotateKey(proj)}
                      title="Rotate Telemetry Keys"
                      className="p-1.5 text-text-muted hover:text-amber-500 hover:bg-amber-500/10 rounded border border-transparent hover:border-amber-500/20 transition-colors"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDelete(proj)}
                        title="Delete Project"
                        className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded border border-transparent hover:border-red-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 2: DSN & Key Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Sentry-Compatible DSN */}
                  <div className="p-2.5 rounded-md bg-surface-raised/50 border border-border-subtle flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-text-muted">
                      <span className="font-semibold text-text-secondary flex items-center gap-1">
                        <Key className="w-3 h-3 text-purple-500" />
                        Sentry-Compatible DSN (SDK Target)
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(sentryDsn, `dsn-${proj.project_id}`)}
                        className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {copiedKey === `dsn-${proj.project_id}` ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy DSN</span>
                          </>
                        )}
                      </button>
                    </div>
                    <code className="text-[11px] font-mono text-text-primary truncate select-all">
                      {sentryDsn}
                    </code>
                  </div>

                  {/* Public Key */}
                  <div className="p-2.5 rounded-md bg-surface-raised/50 border border-border-subtle flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-text-muted">
                      <span className="font-semibold text-text-secondary flex items-center gap-1">
                        <Shield className="w-3 h-3 text-emerald-500" />
                        Telemetry Public Key
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(proj.public_key, `pub-${proj.project_id}`)}
                        className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {copiedKey === `pub-${proj.project_id}` ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Key</span>
                          </>
                        )}
                      </button>
                    </div>
                    <code className="text-[11px] font-mono text-text-primary truncate select-all">
                      {proj.public_key}
                    </code>
                  </div>
                </div>

                {/* Row 3: Repo & Slack Routing Info */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary pt-2 border-t border-border-subtle/30">
                  <div className="flex items-center gap-2">
                    <Github className="w-3.5 h-3.5 text-text-muted" />
                    <span className="font-medium text-text-secondary">GitHub:</span>
                    {proj.github_repo || proj.github_repo_override ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://github.com/${proj.github_repo || proj.github_repo_override}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-purple-600 dark:text-purple-400 hover:underline font-semibold flex items-center gap-1 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20 text-[11px]"
                        >
                          <span>{proj.github_repo || proj.github_repo_override}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleOpenGithubModal(proj)}
                          className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-hover border border-border-subtle/50"
                        >
                          Configure
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDisconnectRepo(proj)}
                          title="Disconnect Repository"
                          className="text-[10px] text-red-500 hover:text-red-600 px-1 py-0.5 rounded hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenGithubModal(proj)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600/10 hover:bg-purple-600 hover:text-white border border-purple-500/30 text-purple-600 dark:text-purple-400 text-[11px] font-medium transition-all"
                      >
                        <Github className="w-3 h-3" />
                        <span>Connect GitHub Repo</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-text-muted" />
                    <span>Slack Alerts:</span>
                    <span className="font-mono text-text-primary font-medium">
                      {proj.slack_channel_override || '(Default System Channel)'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 ml-auto text-[11px] text-text-muted">
                    <span>Rate Quota:</span>
                    <span className="font-medium text-text-secondary">{proj.rate_limit_min} req/min</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 1: Create New Project */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-text-primary">Create Application Project</h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-text-primary mb-1">Project / Service Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Payments Microservice"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-text-primary mb-1">Environment</label>
                  <select
                    value={formEnv}
                    onChange={(e) => setFormEnv(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-text-primary mb-1">Rate Limit (/min)</label>
                  <input
                    type="number"
                    value={formRateLimit}
                    onChange={(e) => setFormRateLimit(Number(e.target.value))}
                    min={10}
                    max={10000}
                    className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-text-primary mb-1">
                  GitHub Repository Override (Optional)
                </label>
                <input
                  type="text"
                  placeholder="owner/repo (e.g. bitroom-cat/storefront)"
                  value={formGithubRepo}
                  onChange={(e) => setFormGithubRepo(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs font-mono"
                />
                <span className="text-[10px] text-text-muted">
                  Leave empty to publish drafted issues to your default system repository.
                </span>
              </div>

              <div>
                <label className="block font-medium text-text-primary mb-1">
                  Slack Channel / Webhook Override (Optional)
                </label>
                <input
                  type="text"
                  placeholder="#channel or webhook URL"
                  value={formSlackChannel}
                  onChange={(e) => setFormSlackChannel(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded-md hover:bg-hover text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formName.trim()}
                  className="px-3.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium disabled:opacity-50"
                >
                  {isSubmitting ? 'Generating...' : 'Create & Generate DSN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: SDK Code Snippets */}
      {sdkModalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-2xl rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-text-primary">
                  Connect SDK to &quot;{sdkModalProject.name}&quot;
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSdkModalProject(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-text-secondary">
                Copy and paste the SDK initialization snippet into your application. Ichnoscope Edge Gateway accepts standard Sentry client protocols with zero changes.
              </p>

              {/* Python Snippet */}
              <div className="rounded-lg bg-surface-sunken border border-border-subtle overflow-hidden">
                <div className="bg-surface-raised px-3 py-1.5 border-b border-border-subtle flex items-center justify-between">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-blue-500" />
                    Python (FastAPI, Flask, Django)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        `import sentry_sdk\n\nsentry_sdk.init(\n    dsn="${getSentryDsn(sdkModalProject)}",\n    environment="${sdkModalProject.environment}",\n    traces_sample_rate=1.0,\n)`,
                        'python-snippet'
                      )
                    }
                    className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    {copiedKey === 'python-snippet' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Code</span>
                  </button>
                </div>
                <pre className="p-3 font-mono text-[11px] text-text-primary overflow-x-auto">
{`import sentry_sdk

sentry_sdk.init(
    dsn="${getSentryDsn(sdkModalProject)}",
    environment="${sdkModalProject.environment}",
    traces_sample_rate=1.0,
)`}
                </pre>
              </div>

              {/* Node / Next.js Snippet */}
              <div className="rounded-lg bg-surface-sunken border border-border-subtle overflow-hidden">
                <div className="bg-surface-raised px-3 py-1.5 border-b border-border-subtle flex items-center justify-between">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-amber-500" />
                    JavaScript / Next.js / Node
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        `import * as Sentry from "@sentry/nextjs";\n\nSentry.init({\n  dsn: "${getSentryDsn(sdkModalProject)}",\n  environment: "${sdkModalProject.environment}",\n});`,
                        'js-snippet'
                      )
                    }
                    className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    {copiedKey === 'js-snippet' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Code</span>
                  </button>
                </div>
                <pre className="p-3 font-mono text-[11px] text-text-primary overflow-x-auto">
{`import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "${getSentryDsn(sdkModalProject)}",
  environment: "${sdkModalProject.environment}",
});`}
                </pre>
              </div>

              {/* cURL Live Fire Test */}
              <div className="rounded-lg bg-surface-sunken border border-border-subtle overflow-hidden">
                <div className="bg-surface-raised px-3 py-1.5 border-b border-border-subtle flex items-center justify-between">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                    Direct cURL Ingestion Test
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        `curl -X POST "${EDGE_INGEST_URL}/api/${sdkModalProject.project_id}/store/" \\\n  -H "X-Sentry-Auth: Sentry sentry_key=${sdkModalProject.public_key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"event_id": "test_evt_1", "message": "Manual test incident from cURL"}'`,
                        'curl-snippet'
                      )
                    }
                    className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    {copiedKey === 'curl-snippet' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>Copy cURL</span>
                  </button>
                </div>
                <pre className="p-3 font-mono text-[11px] text-text-primary overflow-x-auto">
{`curl -X POST "${EDGE_INGEST_URL}/api/${sdkModalProject.project_id}/store/" \\
  -H "X-Sentry-Auth: Sentry sentry_key=${sdkModalProject.public_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"event_id": "test_evt_1", "message": "Manual test incident from cURL"}'`}
                </pre>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSdkModalProject(null)}
                className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: GitHub App & Repository Connector */}
      {githubModalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-lg rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Github className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-text-primary">
                  Connect GitHub to &quot;{githubModalProject.name}&quot;
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGithubModalProject(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-text-secondary leading-relaxed">
                Connecting this project allows Ichnoscope to run <strong>GraphQL blame</strong>, correlate incidents with git commits, inspect <strong>diffs</strong>, and publish official triage issues.
              </p>

              {/* Step 1: Install GitHub App */}
              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface-raised space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                    <span className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                    Authorize &amp; Install GitHub App
                  </span>
                  {githubInstallUrl && (
                    <a
                      href={githubInstallUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white font-medium text-[11px] shadow-xs"
                    >
                      <span>Install on GitHub</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-text-muted">
                  Choose which repositories or organization to give Ichnoscope access to. If already installed, proceed to step 2.
                </p>
              </div>

              {/* Step 2: Select Repository */}
              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface-raised space-y-3">
                <span className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                  <span className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                  Link Repository
                </span>

                {/* If installation repos are available */}
                {githubRepos.length > 0 ? (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-text-secondary font-medium">Select Accessible Repository</label>
                    <select
                      value={selectedRepo}
                      onChange={(e) => setSelectedRepo(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface text-text-primary text-xs focus:outline-none focus:border-purple-500"
                    >
                      {githubRepos.map((r) => (
                        <option key={r.id} value={r.full_name}>
                          {r.full_name} {r.private ? '(private)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-[11px] text-text-secondary font-medium">Repository Full Name (owner/repo)</label>
                    <input
                      type="text"
                      placeholder="e.g. your-org/your-repo"
                      value={customRepoInput}
                      onChange={(e) => setCustomRepoInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface text-text-primary text-xs focus:outline-none focus:border-purple-500 font-mono"
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="Optional: GitHub Installation ID"
                        value={manualInstallationId}
                        onChange={(e) => setManualInstallationId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary text-[11px] focus:outline-none focus:border-purple-500 font-mono"
                      />
                      {manualInstallationId && (
                        <button
                          type="button"
                          onClick={handleFetchReposForInstall}
                          disabled={githubLoading}
                          className="px-2.5 py-1.5 rounded bg-surface hover:bg-hover border border-border-subtle text-text-secondary text-[11px] flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${githubLoading ? 'animate-spin' : ''}`} />
                          <span>Fetch Repos</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setGithubModalProject(null)}
                className="px-3 py-1.5 rounded-md hover:bg-hover text-text-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isConnectingGithub || (!selectedRepo && !customRepoInput)}
                onClick={handleConnectRepo}
                className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs disabled:opacity-50 flex items-center gap-1.5"
              >
                {isConnectingGithub ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                <span>Link Repository</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
