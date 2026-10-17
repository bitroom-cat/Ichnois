'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  api,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  GitHubRepo,
  setSelectedProjectId,
  getSelectedProjectId,
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
  Zap,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Settings,
  ArrowUpRight,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Compass,
  Radio,
  Server,
  Layers,
} from 'lucide-react';

const EDGE_INGEST_URL = process.env.NEXT_PUBLIC_EDGE_GATEWAY_URL || 'https://ichnoisapi.onrender.com';

export default function ProjectsPage() {
  const router = useRouter();
  const { currentWorkspace, isGlobal } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sdkModalProject, setSdkModalProject] = useState<Project | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Master-Detail Expanded Card & Interactive Index Sync State
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const cardRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // 1-Click Multi-Repo Selection Modal State (when OAuth returns > 1 repo or manual switch)
  const [repoSelectorState, setRepoSelectorState] = useState<{
    projectId: string;
    installationId: string;
    repos: GitHubRepo[];
    defaultAssignee?: string;
  } | null>(null);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string>('');
  const [isBindingRepo, setIsBindingRepo] = useState(false);

  // Service Settings Modal State
  const [settingsModalProject, setSettingsModalProject] = useState<Project | null>(null);
  const [settingsForm, setSettingsForm] = useState<{
    name: string;
    environment: string;
    rate_limit_min: number;
    github_repo: string;
    fallback_assignee: string;
    path_prefix_strip: string;
    window_hours: number;
    webhook_url: string;
    slack_channel_override: string;
    automation_mode_override: string;
  }>({
    name: '',
    environment: 'production',
    rate_limit_min: 120,
    github_repo: '',
    fallback_assignee: '',
    path_prefix_strip: 'src/',
    window_hours: 48,
    webhook_url: '',
    slack_channel_override: '',
    automation_mode_override: '',
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Create Project Form State
  const [formName, setFormName] = useState('');
  const [formEnv, setFormEnv] = useState('production');
  const [formRateLimit, setFormRateLimit] = useState(120);
  const [formGithubRepo, setFormGithubRepo] = useState('');
  const [formSlackChannel, setFormSlackChannel] = useState('');
  const [formFallbackAssignee, setFormFallbackAssignee] = useState('');
  const [formPathPrefix, setFormPathPrefix] = useState('src/');
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

  // Initialize expanded card with selected or first project
  useEffect(() => {
    if (projects.length > 0 && !expandedProjectId) {
      const selected = getSelectedProjectId();
      const match = projects.find((p) => p.project_id === selected);
      setExpandedProjectId(match ? match.project_id : projects[0].project_id);
    }
  }, [projects, expandedProjectId]);

  const handleSelectAndScrollTo = (projectId: string) => {
    setExpandedProjectId(projectId);
    const target = cardRefs.current[projectId];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const toggleCard = (projectId: string) => {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  };

  // Handle 1-Click GitHub App OAuth Redirect Back
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get('installation_id');
    const stateProjectId = params.get('state') || params.get('project_id');

    if (installationId && stateProjectId) {
      handleOAuthCallback(stateProjectId, installationId);
    }
  }, []);

  const handleOAuthCallback = async (projectId: string, installationId: string) => {
    try {
      setSuccessBanner(`Connecting GitHub App installation #${installationId}...`);
      const repos = await api.getGitHubRepos(projectId, installationId);

      if (repos && repos.length === 1) {
        // Auto-bind immediately without manual typing!
        const targetRepo = repos[0];
        const assignee = targetRepo.owner || '';
        await api.connectGitHubRepo(projectId, installationId, targetRepo.full_name, assignee);
        setSuccessBanner(`🟢 Authorized: ${targetRepo.full_name} (Zero manual typing!)`);
        // Clean URL params
        window.history.replaceState({}, '', window.location.pathname);
        await loadProjects();
        setTimeout(() => setSuccessBanner(null), 5000);
      } else if (repos && repos.length > 1) {
        // Multiple repos authorized: open quick 1-click selection dialog
        setSelectedRepoFullName(repos[0].full_name);
        setRepoSelectorState({
          projectId,
          installationId,
          repos,
          defaultAssignee: repos[0].owner,
        });
        setSuccessBanner(null);
      } else {
        setSuccessBanner(null);
        setErrorMsg('GitHub App connected, but no repositories were found in this installation.');
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (err: any) {
      console.error('Error handling GitHub OAuth redirect:', err);
      setErrorMsg(`GitHub authorization failed: ${err.message || 'Could not query repositories'}`);
      setSuccessBanner(null);
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleStartGitHubOAuth = async (project: Project) => {
    setActionLoadingId(project.project_id);
    setErrorMsg(null);
    try {
      const data = await api.getGitHubInstallUrl(project.project_id);
      if (data?.install_url) {
        window.location.href = data.install_url;
      } else {
        throw new Error('No install URL returned by backend');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start GitHub App authorization');
      setActionLoadingId(null);
    }
  };

  const handleOpenSwitchRepo = async (project: Project) => {
    if (!project.github_installation_id) {
      handleStartGitHubOAuth(project);
      return;
    }
    setActionLoadingId(project.project_id);
    try {
      const repos = await api.getGitHubRepos(project.project_id, project.github_installation_id);
      if (repos && repos.length > 0) {
        setSelectedRepoFullName(project.github_repo || project.github_repo_override || repos[0].full_name);
        setRepoSelectorState({
          projectId: project.project_id,
          installationId: project.github_installation_id,
          repos,
          defaultAssignee: project.fallback_assignee || repos[0].owner,
        });
      } else {
        alert('No repositories discovered for this installation. Please manage permissions on GitHub.');
      }
    } catch (err: any) {
      alert(`Could not list repositories: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmRepoBinding = async () => {
    if (!repoSelectorState || !selectedRepoFullName) return;
    setIsBindingRepo(true);
    try {
      const matched = repoSelectorState.repos.find((r) => r.full_name === selectedRepoFullName);
      const assignee = matched?.owner || repoSelectorState.defaultAssignee || '';
      await api.connectGitHubRepo(
        repoSelectorState.projectId,
        repoSelectorState.installationId,
        selectedRepoFullName,
        assignee
      );
      setRepoSelectorState(null);
      window.history.replaceState({}, '', window.location.pathname);
      await loadProjects();
      setSuccessBanner(`🟢 Authorized: ${selectedRepoFullName}`);
      setTimeout(() => setSuccessBanner(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to link repository');
    } finally {
      setIsBindingRepo(false);
    }
  };

  const handleDisconnectRepo = async (project: Project) => {
    if (!confirm(`Are you sure you want to revoke GitHub access for "${project.name}"? Triage GraphQL blame will be disabled.`)) return;
    setActionLoadingId(project.project_id);
    try {
      await api.disconnectGitHubRepo(project.project_id);
      await loadProjects();
      setSuccessBanner(`Revoked GitHub access for ${project.name}`);
      setTimeout(() => setSuccessBanner(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect repository');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenSettingsModal = (project: Project) => {
    setSettingsModalProject(project);
    setSettingsForm({
      name: project.name,
      environment: project.environment || 'production',
      rate_limit_min: project.rate_limit_min || 120,
      github_repo: project.github_repo || project.github_repo_override || '',
      fallback_assignee: project.fallback_assignee || '',
      path_prefix_strip: project.path_prefix_strip || 'src/',
      window_hours: project.window_hours || 48,
      webhook_url: project.webhook_url || '',
      slack_channel_override: project.slack_channel_override || '',
      automation_mode_override: project.automation_mode_override || '',
    });
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsModalProject) return;

    setIsSavingSettings(true);
    try {
      const updates: ProjectUpdateInput = {
        name: settingsForm.name.trim(),
        environment: settingsForm.environment,
        rate_limit_min: Number(settingsForm.rate_limit_min) || 120,
        github_repo_override: settingsForm.github_repo.trim() || null,
        fallback_assignee: settingsForm.fallback_assignee.trim() || null,
        path_prefix_strip: settingsForm.path_prefix_strip.trim() || null,
        window_hours: Number(settingsForm.window_hours) || 48,
        webhook_url: settingsForm.webhook_url.trim() || null,
        slack_channel_override: settingsForm.slack_channel_override.trim() || null,
        automation_mode_override: settingsForm.automation_mode_override.trim() || null,
      };

      await api.updateProject(settingsModalProject.project_id, updates);
      await loadProjects();
      setSettingsModalProject(null);
      setSuccessBanner(`Updated settings for "${settingsForm.name}"`);
      setTimeout(() => setSuccessBanner(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to save project settings');
    } finally {
      setIsSavingSettings(false);
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
        fallback_assignee: formFallbackAssignee.trim() || undefined,
        path_prefix_strip: formPathPrefix.trim() || 'src/',
      };

      const newProj = await api.createProject(payload);
      setCreateModalOpen(false);
      setFormName('');
      setFormGithubRepo('');
      setFormSlackChannel('');
      setFormFallbackAssignee('');
      setFormPathPrefix('src/');
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

    if (!confirm(`Are you sure you want to delete service "${project.name}" (${project.project_id})?`)) {
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

  const handleOpenDashboard = (projectId: string) => {
    setSelectedProjectId(projectId);
    router.push(`/app/projects/${encodeURIComponent(projectId)}`);
  };

  const handleFilterRuns = (projectId: string) => {
    setSelectedProjectId(projectId);
    router.push(`/app/runs?project_id=${encodeURIComponent(projectId)}`);
  };

  const getSentryDsn = (proj: Project) => {
    const host = EDGE_INGEST_URL.replace('http://', '').replace('https://', '');
    return `https://${proj.public_key}@${host}/${proj.project_id}`;
  };

  const formatDate = (epochSec?: number) => {
    if (!epochSec) return 'Recently';
    const date = new Date(epochSec * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-[1280px] mx-auto space-y-6">
      {/* 1. Top Header Frame */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              Microservices &amp; Telemetry Endpoints
            </h1>
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              FLEET SERVICES
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Manage microservices, configure 1-click GitHub triage access, inspect DSNs, and route incident notifications.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ New Microservice</span>
        </button>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-medium">{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-500 hover:text-emerald-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Message Banner */}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Microservices Workspace Content */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center text-text-muted gap-2 text-xs">
          <Activity className="w-6 h-6 animate-spin text-purple-500" />
          <span>Loading microservice fleet...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="border border-border-subtle rounded-xl p-10 text-center bg-surface">
          <FolderKanban className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-text-primary">No Microservices Configured</h3>
          <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto">
            Create your first microservice to generate an isolated Sentry DSN and link code repositories for automated git blame.
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="mt-4 px-4 py-2 text-xs font-semibold bg-purple-600 text-white rounded-md hover:bg-purple-700 shadow-xs"
          >
            Create First Service
          </button>
        </div>
      ) : (
        /* 2. Main Canvas (70% / 30% Split Layout) */
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 items-start">
          {/* Left Side (70% Width) - Interactive Service Workspace */}
          <div className="lg:col-span-7 space-y-4">
            {projects.map((proj) => {
              const sentryDsn = getSentryDsn(proj);
              const isDefault = proj.project_id === 'proj_default';
              const isBusy = actionLoadingId === proj.project_id;
              const boundRepo = proj.github_repo || proj.github_repo_override;
              const isGithubConnected = Boolean(boundRepo);
              const isExpanded = expandedProjectId === proj.project_id;

              return (
                <motion.div
                  key={proj.project_id}
                  ref={(el) => {
                    cardRefs.current[proj.project_id] = el;
                  }}
                  layout
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className={`border rounded-xl bg-surface transition-colors shadow-xs overflow-hidden flex flex-col ${
                    isExpanded
                      ? 'border-purple-500/50 dark:border-purple-500/40 shadow-md ring-1 ring-purple-500/20'
                      : 'border-border-subtle hover:border-border-strong'
                  }`}
                >
                  {/* Collapsed State Bar / Accordion Header */}
                  <div
                    onClick={() => toggleCard(proj.project_id)}
                    className="p-4 sm:p-5 cursor-pointer bg-surface hover:bg-surface-raised/40 transition-colors flex items-center justify-between gap-3 select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 border shadow-xs transition-colors ${
                          isExpanded
                            ? 'bg-purple-600 text-white border-purple-500'
                            : 'bg-purple-600/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                        }`}
                      >
                        {proj.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm sm:text-base text-text-primary tracking-tight truncate">
                            {proj.name}
                          </span>
                          {isDefault && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-surface-sunken text-text-muted border border-border-subtle uppercase tracking-wider">
                              Default
                            </span>
                          )}
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Operational
                          </span>
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider bg-surface-sunken text-text-secondary border border-border-subtle">
                            {proj.environment || 'PRODUCTION'}
                          </span>
                        </div>

                        <div className="text-[11px] text-text-muted font-mono mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>ID: {proj.project_id}</span>
                          <span>•</span>
                          <span>Created: {formatDate(proj.created_at)}</span>
                          {boundRepo ? (
                            <>
                              <span>•</span>
                              <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1 font-semibold truncate max-w-[200px]">
                                <Github className="w-3 h-3 shrink-0" />
                                <span className="truncate">{boundRepo}</span>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">No Repo Linked</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-text-muted font-medium hidden sm:inline">
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </span>
                      <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-7 h-7 rounded-md bg-surface-sunken border border-border-subtle flex items-center justify-center text-text-secondary"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </motion.div>
                    </div>
                  </div>

                  {/* Expanded State (Inline Accordion with Framer Motion) */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        key={`content-${proj.project_id}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="overflow-hidden border-t border-border-subtle/70"
                      >
                        {/* 1. Action Buttons Hierarchy */}
                        <div className="p-4 sm:p-5 bg-surface flex flex-wrap items-center gap-2 border-b border-border-subtle/70">
                          {/* Primary Action: Dedicated Service Dashboard CTA */}
                          <button
                            type="button"
                            onClick={() => handleOpenDashboard(proj.project_id)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors shrink-0"
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-300" />
                            <span>Open Service Dashboard</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>

                          {/* Secondary Action: View Incidents */}
                          <button
                            type="button"
                            onClick={() => handleFilterRuns(proj.project_id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-surface-raised hover:bg-hover border border-border-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0"
                          >
                            <Activity className="w-3.5 h-3.5 text-purple-500" />
                            <span>View Incidents</span>
                          </button>

                          {/* Secondary Action: Service Settings */}
                          <button
                            type="button"
                            onClick={() => handleOpenSettingsModal(proj)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-surface-raised hover:bg-hover border border-border-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0"
                          >
                            <Settings className="w-3.5 h-3.5 text-text-muted" />
                            <span>Service Settings</span>
                          </button>

                          {/* Destructive Action: Delete Service */}
                          {!isDefault && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDelete(proj)}
                              title="Delete Service"
                              className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-md border border-transparent hover:border-red-500/20 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Delete Service</span>
                            </button>
                          )}
                        </div>

                        {/* 2. Ingestion Endpoints & Credentials Box */}
                        <div className="p-4 sm:p-5 bg-surface-raised/20 border-b border-border-subtle/70 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            <span>Ingestion Endpoints &amp; Credentials</span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            {/* Sentry DSN */}
                            <div className="p-3 rounded-lg bg-surface border border-border-subtle flex flex-col justify-between gap-2 shadow-2xs">
                              <div>
                                <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                                  <span className="font-semibold text-text-secondary flex items-center gap-1">
                                    <Key className="w-3 h-3 text-purple-500" />
                                    Sentry-Compatible DSN (SDK Target)
                                  </span>
                                </div>
                                <code className="text-[11px] font-mono text-text-primary block truncate bg-surface-sunken p-1.5 rounded border border-border-subtle/60 select-all">
                                  {sentryDsn}
                                </code>
                              </div>

                              <div className="flex items-center gap-2 pt-1 border-t border-border-subtle/40">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(sentryDsn, `dsn-${proj.project_id}`)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded border border-purple-500/20 transition-colors"
                                >
                                  {copiedKey === `dsn-${proj.project_id}` ? (
                                    <>
                                      <Check className="w-3 h-3" />
                                      <span>Copied DSN</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy DSN</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setSdkModalProject(proj)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-surface-raised hover:bg-hover rounded border border-border-subtle transition-colors"
                                >
                                  <Code className="w-3 h-3" />
                                  <span>Quick SDK Snippets</span>
                                </button>
                              </div>
                            </div>

                            {/* Telemetry Public Key */}
                            <div className="p-3 rounded-lg bg-surface border border-border-subtle flex flex-col justify-between gap-2 shadow-2xs">
                              <div>
                                <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                                  <span className="font-semibold text-text-secondary flex items-center gap-1">
                                    <Shield className="w-3 h-3 text-emerald-500" />
                                    Telemetry Public Key
                                  </span>
                                </div>
                                <code className="text-[11px] font-mono text-text-primary block truncate bg-surface-sunken p-1.5 rounded border border-border-subtle/60 select-all">
                                  {proj.public_key}
                                </code>
                              </div>

                              <div className="flex items-center gap-2 pt-1 border-t border-border-subtle/40">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(proj.public_key, `pub-${proj.project_id}`)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded border border-purple-500/20 transition-colors"
                                >
                                  {copiedKey === `pub-${proj.project_id}` ? (
                                    <>
                                      <Check className="w-3 h-3" />
                                      <span>Copied Key</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy Key</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleRotateKey(proj)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded border border-transparent hover:border-amber-500/20 transition-colors ml-auto"
                                  title="Rotate Telemetry Key"
                                >
                                  <RotateCcw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                                  <span>Rotate Key</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 3. Source Codebase & Autonomous Agent Triage */}
                        <div className="p-4 sm:p-5 bg-surface space-y-3">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            <span>Source Codebase &amp; Autonomous Agent Triage</span>
                          </div>

                          {!isGithubConnected ? (
                            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                                  <span className="font-semibold text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                    Repository Not Connected
                                  </span>
                                </div>
                                <p className="text-xs text-text-secondary leading-relaxed max-w-xl">
                                  Required for automated GraphQL blame, diff inspection, commit correlation, and GitHub issue publishing.
                                </p>
                              </div>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStartGitHubOAuth(proj)}
                                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-gray-900 hover:bg-black dark:bg-purple-600 dark:hover:bg-purple-700 text-white shadow-xs transition-colors shrink-0"
                              >
                                <Github className="w-4 h-4" />
                                <span>Connect GitHub Repository</span>
                              </button>
                            </div>
                          ) : (
                            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                    Active &amp; Authorized
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleOpenSwitchRepo(proj)}
                                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-surface hover:bg-hover rounded border border-border-subtle shadow-2xs transition-colors"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                                    <span>Switch Repo</span>
                                  </button>

                                  {proj.github_installation_id && (
                                    <a
                                      href={`https://github.com/settings/installations/${proj.github_installation_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-surface hover:bg-hover rounded border border-border-subtle shadow-2xs transition-colors"
                                    >
                                      <Settings className="w-3 h-3 text-text-muted" />
                                      <span>Manage on GitHub</span>
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                  )}

                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleDisconnectRepo(proj)}
                                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded border border-transparent hover:border-red-500/20 transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                    <span>Revoke Access</span>
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <Github className="w-3.5 h-3.5 text-text-muted shrink-0" />
                                  <span className="text-text-muted">Repository:</span>
                                  <a
                                    href={`https://github.com/${boundRepo}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-purple-600 dark:text-purple-400 hover:underline font-semibold truncate flex items-center gap-1"
                                  >
                                    <span>{boundRepo}</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>

                                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                  <span className="text-text-muted">Branch:</span>
                                  <span className="text-text-primary font-medium">main</span>
                                  <span className="text-text-muted">•</span>
                                  <span className="text-text-muted">App ID:</span>
                                  <span className="text-text-primary">{proj.github_installation_id || '5344746'}</span>
                                </div>

                                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                  <span className="text-text-muted">Assignee:</span>
                                  <span className="text-text-primary">@{proj.fallback_assignee || 'dynamic'}</span>
                                  <span className="text-text-muted">•</span>
                                  <span className="text-text-muted">Strip:</span>
                                  <span className="text-text-primary">{proj.path_prefix_strip || 'src/'}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 4. Footer Telemetry Info */}
                        <div className="px-4 sm:px-5 py-2.5 bg-surface-sunken border-t border-border-subtle flex flex-wrap items-center justify-between gap-3 text-[11px] text-text-muted">
                          <div className="flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-purple-500" />
                            <span>SLACK DISPATCH:</span>
                            <span className="font-mono text-text-primary font-medium">
                              {proj.slack_channel_override || '#eng-incidents'}
                            </span>
                            {proj.webhook_url && (
                              <span className="text-emerald-600 font-semibold">(Dedicated Webhook)</span>
                            )}
                          </div>

                          <div className="flex items-center gap-4 flex-wrap">
                            <div>
                              <span>RATE QUOTA: </span>
                              <span className="font-medium text-text-secondary">{proj.rate_limit_min} req/min</span>
                            </div>

                            <div>
                              <span>POLICY: </span>
                              <span className="font-medium text-text-secondary uppercase">
                                {proj.automation_mode_override || 'Fleet Default'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 text-text-secondary">
                              <Shield className="w-3 h-3 text-purple-500" />
                              <span>TENANT: </span>
                              <span className="font-mono font-medium">
                                {isGlobal ? 'Global Fleet' : currentWorkspace}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Right Side (30% Width) - Scrollable Mission Control Index */}
          <div className="lg:col-span-3 sticky top-4 space-y-3">
            <div className="rounded-xl border border-border-subtle bg-surface p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                    Mission Control Index
                  </h2>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  {projects.length} Services
                </span>
              </div>

              <p className="text-[11px] text-text-muted leading-tight">
                Click any service below to center and expand its inline telemetry workspace.
              </p>

              <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
                {projects.map((proj) => {
                  const isSelected = expandedProjectId === proj.project_id;
                  const boundRepo = proj.github_repo || proj.github_repo_override;

                  return (
                    <motion.div
                      key={`index-${proj.project_id}`}
                      whileHover={{ scale: 1.01 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      onClick={() => handleSelectAndScrollTo(proj.project_id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col gap-1.5 ${
                        isSelected
                          ? 'border-purple-600 dark:border-purple-500 bg-purple-500/10 shadow-xs ring-1 ring-purple-500/30'
                          : 'border-border-subtle bg-surface hover:bg-surface-raised hover:border-border-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] shrink-0 ${
                              isSelected
                                ? 'bg-purple-600 text-white'
                                : 'bg-surface-sunken text-text-secondary border border-border-subtle'
                            }`}
                          >
                            {proj.name.charAt(0).toUpperCase()}
                          </div>
                          <span
                            className={`text-xs font-semibold truncate ${
                              isSelected ? 'text-purple-600 dark:text-purple-300' : 'text-text-primary'
                            }`}
                          >
                            {proj.name}
                          </span>
                        </div>

                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span className="hidden xl:inline">Operational</span>
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-text-muted font-mono pt-1 border-t border-border-subtle/40">
                        <span className="truncate max-w-[110px]">{proj.project_id}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="uppercase text-[9px] px-1 py-0.2 rounded bg-surface-sunken border border-border-subtle text-text-secondary">
                            {proj.environment || 'PROD'}
                          </span>
                          {boundRepo ? (
                            <span title={boundRepo} className="text-purple-600 dark:text-purple-400">
                              <Github className="w-3 h-3" />
                            </span>
                          ) : (
                            <span title="No GitHub linked" className="text-amber-500">
                              <AlertCircle className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Quick Fleet Metrics Summary in Sidebar */}
              <div className="pt-2 border-t border-border-subtle/60 grid grid-cols-2 gap-2 text-[10px]">
                <div className="p-2 rounded bg-surface-sunken border border-border-subtle/50">
                  <span className="text-text-muted block">Linked Repos</span>
                  <span className="font-bold text-xs text-text-primary">
                    {projects.filter((p) => p.github_repo || p.github_repo_override).length} / {projects.length}
                  </span>
                </div>
                <div className="p-2 rounded bg-surface-sunken border border-border-subtle/50">
                  <span className="text-text-muted block">Ingestion DSNs</span>
                  <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">
                    {projects.length} Active
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: 1-Click Multi-Repo Selection Dialog (OAuth discovery or Switch Repo) */}
      {repoSelectorState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Github className="w-5 h-5 text-purple-500" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Select Repository to Link</h3>
                  <p className="text-[11px] text-text-muted">Choose from authorized GitHub repositories</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRepoSelectorState(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-text-secondary">
                Your GitHub App installation grants access to {repoSelectorState.repos.length} repositories. Select the repository belonging to this microservice:
              </p>

              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {repoSelectorState.repos.map((repo) => {
                  const isSelected = selectedRepoFullName === repo.full_name;
                  return (
                    <div
                      key={repo.id}
                      onClick={() => setSelectedRepoFullName(repo.full_name)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-purple-600 bg-purple-500/10 text-purple-600 dark:text-purple-300'
                          : 'border-border-subtle bg-surface hover:bg-surface-raised'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-mono font-semibold text-xs block truncate text-text-primary">
                          {repo.full_name}
                        </span>
                        {repo.description && (
                          <span className="text-[11px] text-text-muted block truncate mt-0.5">
                            {repo.description}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {repo.private && (
                          <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-surface-sunken text-text-muted border border-border-subtle">
                            Private
                          </span>
                        )}
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setRepoSelectorState(null)}
                className="px-3 py-1.5 rounded-md hover:bg-hover text-text-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBindingRepo || !selectedRepoFullName}
                onClick={handleConfirmRepoBinding}
                className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                {isBindingRepo ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Binding...</span>
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Service Settings Modal */}
      {settingsModalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-xl rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-text-primary">
                  Microservice Settings: &quot;{settingsModalProject.name}&quot;
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsModalProject(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              {/* Service Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-text-primary mb-1">Service Name</label>
                  <input
                    type="text"
                    required
                    value={settingsForm.name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>

                <div>
                  <label className="block font-medium text-text-primary mb-1">Environment</label>
                  <select
                    value={settingsForm.environment}
                    onChange={(e) => setSettingsForm({ ...settingsForm, environment: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
              </div>

              {/* LEVEL 2: REPOSITORY SCOPING & TRIAGE */}
              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface-raised/40 space-y-3">
                <span className="font-semibold text-text-primary block text-xs">
                  Repository Scoping &amp; GraphQL Blame
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Target Repository
                    </label>
                    <input
                      type="text"
                      placeholder="owner/repo"
                      value={settingsForm.github_repo}
                      onChange={(e) => setSettingsForm({ ...settingsForm, github_repo: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Fallback Assignee
                    </label>
                    <input
                      type="text"
                      placeholder="Defaults to your GitHub username"
                      value={settingsForm.fallback_assignee}
                      onChange={(e) => setSettingsForm({ ...settingsForm, fallback_assignee: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-text-muted mt-0.5 block">
                      Assigned when blame author has no GitHub write access.
                    </span>
                  </div>

                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Path Prefix Strip
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. src/ or /app/"
                      value={settingsForm.path_prefix_strip}
                      onChange={(e) => setSettingsForm({ ...settingsForm, path_prefix_strip: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-text-muted mt-0.5 block">
                      Strips container paths to match repo root.
                    </span>
                  </div>

                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Regression Window (Hours)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={settingsForm.window_hours}
                      onChange={(e) => setSettingsForm({ ...settingsForm, window_hours: Number(e.target.value) })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-text-muted mt-0.5 block">
                      Commits within this window trigger regression tags.
                    </span>
                  </div>
                </div>
              </div>

              {/* LEVEL 2: SLACK & ALERT DISPATCH */}
              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface-raised/40 space-y-3">
                <span className="font-semibold text-text-primary block text-xs">
                  Slack Notifications &amp; Alert Routing
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Dedicated Webhook URL
                    </label>
                    <input
                      type="password"
                      placeholder="https://hooks.slack.com/services/..."
                      value={settingsForm.webhook_url}
                      onChange={(e) => setSettingsForm({ ...settingsForm, webhook_url: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-text-secondary mb-1">
                      Dedicated Channel
                    </label>
                    <input
                      type="text"
                      placeholder="#service-alerts"
                      value={settingsForm.slack_channel_override}
                      onChange={(e) => setSettingsForm({ ...settingsForm, slack_channel_override: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* SERVICE GATE OVERRIDE */}
              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface-raised/40 space-y-2">
                <span className="font-semibold text-text-primary block text-xs">
                  Service Automation Gate Override
                </span>
                <select
                  value={settingsForm.automation_mode_override}
                  onChange={(e) => setSettingsForm({ ...settingsForm, automation_mode_override: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-md border border-border-subtle bg-surface text-text-primary text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="">Fleet Baseline (Inherit from Platform Policy)</option>
                  <option value="semi_autonomous">Auto-AI Investigation (Semi-Autonomous)</option>
                  <option value="fully_autonomous">Full Auto Mode (High Confidence Auto-Publish)</option>
                  <option value="full_manual">Manual Approval Mode (Hold all crashes in Staging)</option>
                </select>
                <span className="text-[10px] text-text-muted block">
                  Allows high-risk services to enforce manual approval while others run on fleet defaults.
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setSettingsModalProject(null)}
                  className="px-3 py-1.5 rounded-md hover:bg-hover text-text-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                >
                  {isSavingSettings ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Service Settings</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create New Project */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-xl bg-surface border border-border-strong shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-text-primary">Create New Microservice</h3>
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
                <label className="block font-medium text-text-primary mb-1">Microservice Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Payments Service, Checkout API"
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
                  placeholder="owner/repo (or link via 1-click install after creation)"
                  value={formGithubRepo}
                  onChange={(e) => setFormGithubRepo(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-text-primary mb-1">Fallback Assignee</label>
                  <input
                    type="text"
                    placeholder="Defaults to GitHub username"
                    value={formFallbackAssignee}
                    onChange={(e) => setFormFallbackAssignee(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-text-primary mb-1">Path Prefix Strip</label>
                  <input
                    type="text"
                    placeholder="src/"
                    value={formPathPrefix}
                    onChange={(e) => setFormPathPrefix(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-border-subtle bg-surface-raised text-text-primary focus:outline-none focus:border-purple-500 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-text-primary mb-1">
                  Dedicated Slack Channel (Optional)
                </label>
                <input
                  type="text"
                  placeholder="#payments-alerts"
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
                  className="px-3.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium disabled:opacity-50 shadow-xs"
                >
                  {isSubmitting ? 'Creating...' : 'Create & Generate DSN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SDK Code Snippets */}
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
                Copy and paste the SDK initialization snippet into your application. Ichnoscope accepts standard Sentry client protocols with zero modifications.
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
                className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
