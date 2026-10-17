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

  // Fleet Services Animation, Expansion, & Minimize State
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [minimizedMap, setMinimizedMap] = useState<Record<string, boolean>>({});
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const [pulsingIdxId, setPulsingIdxId] = useState<string | null>(null);
  const [newlyEnteredId, setNewlyEnteredId] = useState<string | null>(null);
  const [ghostState, setGhostState] = useState<{
    visible: boolean;
    name: string;
    env: string;
  } | null>(null);

  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const idxRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
      // Auto open first project if none open
      if (data.length > 0) {
        setOpenMap((prev) => {
          if (Object.keys(prev).length === 0) {
            return { [data[0].project_id]: true };
          }
          return prev;
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const toggleCard = (projectId: string) => {
    setOpenMap((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
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

  // Web Animations API: Dynamic anchor calculation for Genie minimize & spring restore
  const anchorOrigin = (cardEl: HTMLElement, idxEl: HTMLElement) => {
    const c = cardEl.getBoundingClientRect();
    const s = idxEl.getBoundingClientRect();
    const ox = ((s.left + s.width / 2 - c.left) / c.width) * 100;
    const oy = ((s.top + s.height / 2 - c.top) / c.height) * 100;
    return `${ox}% ${oy}%`;
  };

  const genieFrames = (origin: string): Keyframe[] => [
    { transform: 'translate3d(0,0,0) scale(1)', clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', opacity: 1, transformOrigin: origin },
    { transform: 'translate3d(0, -6px, 0) scale(0.94, 0.9)', clipPath: 'polygon(3% 0%, 97% 0%, 82% 100%, 18% 100%)', opacity: 0.95, offset: 0.35, transformOrigin: origin },
    { transform: 'translate3d(0, -18px, 0) scale(0.5, 0.3)', clipPath: 'polygon(12% 0%, 88% 0%, 58% 100%, 42% 100%)', opacity: 0.6, offset: 0.7, transformOrigin: origin },
    { transform: 'translate3d(0, -28px, 0) scale(0.04, 0.04)', clipPath: 'polygon(45% 0%, 55% 0%, 51% 100%, 49% 100%)', opacity: 0, transformOrigin: origin },
  ];

  const handleMinimize = (projectId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const card = cardRefs.current[projectId];
    const idx = idxRefs.current[projectId];
    if (card && idx) {
      const origin = anchorOrigin(card, idx);
      const anim = card.animate(genieFrames(origin), {
        duration: 720,
        easing: 'cubic-bezier(.55, 0, .75, .2)',
      });
      anim.onfinish = () => {
        setMinimizedMap((prev) => ({ ...prev, [projectId]: true }));
        setPulsingIdxId(projectId);
        setTimeout(() => setPulsingIdxId(null), 1400);
      };
    } else {
      setMinimizedMap((prev) => ({ ...prev, [projectId]: true }));
      setPulsingIdxId(projectId);
      setTimeout(() => setPulsingIdxId(null), 1400);
    }
  };

  const handleRestore = (projectId: string) => {
    if (minimizedMap[projectId]) {
      setMinimizedMap((prev) => ({ ...prev, [projectId]: false }));
      requestAnimationFrame(() => {
        const card = cardRefs.current[projectId];
        const idx = idxRefs.current[projectId];
        if (card && idx) {
          const origin = anchorOrigin(card, idx);
          const anim = card.animate(genieFrames(origin).slice().reverse(), {
            duration: 900,
            easing: 'cubic-bezier(.25, 1, .5, 1)',
          });
          anim.onfinish = () => {
            setFlashingId(projectId);
            setTimeout(() => setFlashingId(null), 1200);
          };
        } else {
          setFlashingId(projectId);
          setTimeout(() => setFlashingId(null), 1200);
        }
      });
    } else {
      setOpenMap((prev) => ({ ...prev, [projectId]: true }));
      const slot = slotRefs.current[projectId];
      if (slot) {
        slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      setFlashingId(projectId);
      setTimeout(() => setFlashingId(null), 1200);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const name = formName.trim();
    const env = formEnv;
    const payload: ProjectCreateInput = {
      name,
      environment: env,
      rate_limit_min: Number(formRateLimit) || 120,
      github_repo_override: formGithubRepo.trim() || undefined,
      slack_channel_override: formSlackChannel.trim() || undefined,
      fallback_assignee: formFallbackAssignee.trim() || undefined,
      path_prefix_strip: formPathPrefix.trim() || 'src/',
    };

    setCreateModalOpen(false);
    setGhostState({ visible: true, name, env });
    setErrorMsg(null);
    setFormName('');
    setFormGithubRepo('');
    setFormSlackChannel('');
    setFormFallbackAssignee('');
    setFormPathPrefix('src/');
    setFormRateLimit(120);

    const startTime = Date.now();
    try {
      const newProj = await api.createProject(payload);
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 1680 - elapsed);
      setTimeout(async () => {
        setGhostState(null);
        await loadProjects();
        setNewlyEnteredId(newProj.project_id);
        setOpenMap((prev) => ({ ...prev, [newProj.project_id]: true }));
        setTimeout(() => setNewlyEnteredId(null), 800);
        setSdkModalProject(newProj);
      }, remainingTime);
    } catch (err: any) {
      setGhostState(null);
      setErrorMsg(err.message || 'Failed to create project');
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

  const getEnvConfig = (env?: string) => {
    const e = (env || 'production').toLowerCase();
    if (e === 'production' || e === 'prod') {
      return {
        label: 'PROD',
        dotClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
        pillClass: 'text-[#34d399] bg-[#34d399]/10 border-[#34d399]/25',
      };
    }
    if (e === 'staging' || e === 'stage') {
      return {
        label: 'STAGE',
        dotClass: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]',
        pillClass: 'text-[#fbbf24] bg-[#fbbf24]/10 border-[#fbbf24]/25',
      };
    }
    return {
      label: 'DEV',
      dotClass: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]',
      pillClass: 'text-[#22d3ee] bg-[#22d3ee]/10 border-[#22d3ee]/25',
    };
  };

  const formatRelativeTime = (epochSec?: number) => {
    if (!epochSec) return 'Recently';
    const diffSec = Math.floor(Date.now() / 1000 - epochSec);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return new Date(epochSec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-[1360px] mx-auto space-y-6">
      {/* 1. Top Header Frame */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262930] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#e7e9ee]">
              Microservices &amp; Telemetry Endpoints
            </h1>
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-xs">
              FLEET SERVICES
            </span>
          </div>
          <p className="text-xs text-[#8b90a0] mt-1">
            Manage microservices, configure 1-click GitHub triage access, inspect DSNs, and route incident notifications.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-purple-900/30 transition-all self-start sm:self-auto shrink-0"
        >
          <Plus className="w-4 h-4" />
          Register Microservice
        </button>
      </div>

      {/* Global Notifications */}
      {successBanner && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between animate-in fade-in">
          <span>{successBanner}</span>
          <button type="button" onClick={() => setSuccessBanner(null)} className="text-emerald-400/80 hover:text-emerald-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between animate-in fade-in">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-400/80 hover:text-red-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[#13141a] border border-[#262930] animate-pulse" />
          ))}
        </div>
      )}

      {/* 2. Responsive 70% / 30% Master-Detail Layout */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 items-start">
          {/* Workspace Column (70%): order-2 lg:order-1 */}
          <div className="lg:col-span-7 space-y-4 order-2 lg:order-1">
            {/* App-opening 3-hop bouncing ghost placeholder */}
            {ghostState?.visible && (
              <div className="fleet-ghost rounded-xl border border-purple-500/40 bg-[#13141a]/95 backdrop-blur-md p-4 shadow-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center animate-spin">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[#e7e9ee]">{ghostState.name}</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase">
                        PROVISIONING
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8b90a0] mt-0.5">
                      Binding telemetry ingestion pipeline &amp; keys...
                    </p>
                  </div>
                </div>
                <div className="text-xs font-mono text-purple-400 animate-pulse font-medium">
                  Deploying...
                </div>
              </div>
            )}

            {/* Zero State */}
            {projects.length === 0 && !ghostState?.visible && (
              <div className="rounded-xl border border-dashed border-[#262930] bg-[#13141a]/50 p-12 text-center space-y-3">
                <Server className="w-10 h-10 text-[#8b90a0] mx-auto opacity-50" />
                <h3 className="font-semibold text-sm text-[#e7e9ee]">No microservices registered</h3>
                <p className="text-xs text-[#8b90a0] max-w-sm mx-auto">
                  Register your first service to generate telemetry ingestion DSNs and connect GitHub repositories for 1-click triage.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs inline-flex items-center gap-2 shadow-xs transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Register First Microservice
                </button>
              </div>
            )}

            {/* Microservice Cards List */}
            {projects.map((project) => {
              const isMinimized = !!minimizedMap[project.project_id];
              const isOpen = !!openMap[project.project_id];
              const isFlashing = flashingId === project.project_id;
              const isNewlyEntered = newlyEnteredId === project.project_id;
              const envCfg = getEnvConfig(project.environment);

              return (
                <div
                  key={project.project_id}
                  ref={(el) => { slotRefs.current[project.project_id] = el; }}
                  className="fleet-slot"
                  style={{
                    gridTemplateRows: isMinimized ? '0fr' : '1fr',
                    opacity: isMinimized ? 0 : 1,
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      ref={(el) => { cardRefs.current[project.project_id] = el; }}
                      className={`fleet-card ${isOpen ? 'open' : ''} ${isFlashing ? 'flash' : ''} ${isNewlyEntered ? 'fleet-enter' : ''}`}
                    >
                      {/* Summary Row */}
                      <div
                        onClick={() => toggleCard(project.project_id)}
                        className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Status Dot */}
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${envCfg.dotClass}`} />

                          {/* Env Pill */}
                          <span className={`px-2 py-0.5 text-[10px] font-bold font-mono tracking-wider rounded-md border ${envCfg.pillClass}`}>
                            {envCfg.label}
                          </span>

                          {/* Name & ID */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-[#e7e9ee] hover:text-white truncate">
                                {project.name}
                              </span>
                              {project.project_id === 'proj_default' && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                  Default
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] text-[#8b90a0] block truncate">
                              {project.project_id}
                            </span>
                          </div>
                        </div>

                        {/* Inline Chips & Controls */}
                        <div className="flex items-center gap-2 ml-auto shrink-0">
                          {/* GitHub Repo chip */}
                          {project.github_repo || project.github_repo_override ? (
                            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded bg-[#171921] text-[#e7e9ee] border border-[#262930]">
                              <Github className="w-3 h-3 text-purple-400" />
                              {(project.github_repo || project.github_repo_override || '').split('/')[1] || project.github_repo}
                            </span>
                          ) : (
                            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded bg-[#171921] text-[#8b90a0] border border-[#262930]/60">
                              <Github className="w-3 h-3 text-[#8b90a0]" />
                              No repo
                            </span>
                          )}

                          {/* Rate limit chip */}
                          <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded bg-[#171921] text-[#8b90a0] border border-[#262930]/60">
                            <Activity className="w-3 h-3 text-blue-400" />
                            {project.rate_limit_min || 120}/m
                          </span>

                          {/* Copy DSN button */}
                          <button
                            type="button"
                            title="Copy Sentry Ingestion DSN"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(getSentryDsn(project), `dsn_${project.project_id}`);
                            }}
                            className="p-1.5 rounded-md bg-[#171921] hover:bg-[#262930] text-[#8b90a0] hover:text-[#e7e9ee] border border-[#262930] transition-colors"
                          >
                            {copiedKey === `dsn_${project.project_id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Settings button */}
                          <button
                            type="button"
                            title="Configure Microservice"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenSettingsModal(project);
                            }}
                            className="p-1.5 rounded-md bg-[#171921] hover:bg-[#262930] text-[#8b90a0] hover:text-[#e7e9ee] border border-[#262930] transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>

                          {/* Chevron icon with spring rotation */}
                          <div className="chevron-icon text-[#8b90a0] transition-transform duration-300">
                            <ChevronDown className="w-4 h-4" />
                          </div>

                          {/* Genie minimize button */}
                          <button
                            type="button"
                            title="Minimize to Mission Control Index"
                            onClick={(e) => handleMinimize(project.project_id, e)}
                            className="p-1.5 rounded-md hover:bg-red-500/20 text-[#8b90a0] hover:text-red-400 transition-colors ml-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Detail Body */}
                      <div className="fleet-body">
                        <div className="fleet-inner p-4 pt-0 space-y-4 border-t border-[#262930]/60">
                          {/* Telemetry DSN Banner */}
                          <div className="mt-3 p-3 rounded-lg bg-[#0d0e12] border border-[#262930] space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Radio className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-xs font-semibold text-[#e7e9ee]">Sentry-Compatible Ingestion DSN</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRotateKey(project)}
                                  disabled={actionLoadingId === project.project_id}
                                  className="text-[11px] text-[#8b90a0] hover:text-amber-400 flex items-center gap-1 transition-colors"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Rotate Key
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 bg-[#13141a] px-3 py-1.5 rounded border border-[#262930]/80">
                              <span className="font-mono text-xs text-[#7c8cff] truncate select-all flex-1">
                                {getSentryDsn(project)}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(getSentryDsn(project), `dsn_inner_${project.project_id}`)}
                                className="text-[#8b90a0] hover:text-white transition-colors"
                              >
                                {copiedKey === `dsn_inner_${project.project_id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Details Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            {/* Left: Telemetry & Ingestion Config */}
                            <div className="p-3 rounded-lg bg-[#0d0e12]/60 border border-[#262930] space-y-2">
                              <span className="text-[11px] font-semibold text-[#8b90a0] uppercase tracking-wider block">
                                Telemetry &amp; Rate Limits
                              </span>
                              <div className="space-y-1.5 font-mono text-[11px]">
                                <div className="flex justify-between py-1 border-b border-[#262930]/40">
                                  <span className="text-[#8b90a0]">Environment:</span>
                                  <span className="text-[#e7e9ee] font-semibold uppercase">{project.environment || 'production'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-[#262930]/40">
                                  <span className="text-[#8b90a0]">Rate Limit:</span>
                                  <span className="text-[#e7e9ee]">{project.rate_limit_min || 120} req/min</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-[#262930]/40">
                                  <span className="text-[#8b90a0]">Window Period:</span>
                                  <span className="text-[#e7e9ee]">{project.window_hours || 48} hours</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-[#8b90a0]">Created:</span>
                                  <span className="text-[#e7e9ee]">{formatRelativeTime(project.created_at)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Right: GitHub Triage & Automation */}
                            <div className="p-3 rounded-lg bg-[#0d0e12]/60 border border-[#262930] space-y-2">
                              <span className="text-[11px] font-semibold text-[#8b90a0] uppercase tracking-wider block">
                                GitHub Triage &amp; Automation
                              </span>
                              <div className="space-y-1.5 font-mono text-[11px]">
                                <div className="flex justify-between py-1 border-b border-[#262930]/40 items-center">
                                  <span className="text-[#8b90a0]">Repository:</span>
                                  {project.github_repo || project.github_repo_override ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-purple-400 font-semibold truncate max-w-[140px]">
                                        {project.github_repo || project.github_repo_override}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenSwitchRepo(project)}
                                        className="text-[10px] text-[#8b90a0] hover:text-[#e7e9ee] underline font-sans"
                                      >
                                        switch
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleStartGitHubOAuth(project)}
                                      className="text-xs text-purple-400 hover:text-purple-300 font-sans underline"
                                    >
                                      Connect Repo
                                    </button>
                                  )}
                                </div>
                                <div className="flex justify-between py-1 border-b border-[#262930]/40">
                                  <span className="text-[#8b90a0]">Fallback Assignee:</span>
                                  <span className="text-[#e7e9ee]">{project.fallback_assignee || 'None'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-[#262930]/40">
                                  <span className="text-[#8b90a0]">Prefix Strip:</span>
                                  <span className="text-[#e7e9ee]">{project.path_prefix_strip || 'src/'}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-[#8b90a0]">Slack Alerting:</span>
                                  <span className="text-[#e7e9ee]">
                                    {project.slack_channel_override ? `#${project.slack_channel_override}` : 'Default Channel'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons Toolbar */}
                          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#262930]/60">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenDashboard(project.project_id)}
                                className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-all"
                              >
                                <Server className="w-3.5 h-3.5" />
                                Open Dashboard
                              </button>
                              <button
                                type="button"
                                onClick={() => handleFilterRuns(project.project_id)}
                                className="px-3 py-1.5 rounded-md bg-[#171921] hover:bg-[#262930] text-[#e7e9ee] border border-[#262930] text-xs flex items-center gap-1.5 transition-all"
                              >
                                <Activity className="w-3.5 h-3.5 text-blue-400" />
                                View Incident Runs
                              </button>
                              <button
                                type="button"
                                onClick={() => setSdkModalProject(project)}
                                className="px-3 py-1.5 rounded-md bg-[#171921] hover:bg-[#262930] text-[#e7e9ee] border border-[#262930] text-xs flex items-center gap-1.5 transition-all"
                              >
                                <Code className="w-3.5 h-3.5 text-emerald-400" />
                                SDK Setup
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenSettingsModal(project)}
                                className="px-3 py-1.5 rounded-md bg-[#171921] hover:bg-[#262930] text-[#e7e9ee] border border-[#262930] text-xs flex items-center gap-1.5 transition-all"
                              >
                                <Sliders className="w-3.5 h-3.5 text-purple-400" />
                                Service Settings
                              </button>
                            </div>

                            {project.project_id !== 'proj_default' && (
                              <button
                                type="button"
                                onClick={() => handleDelete(project)}
                                disabled={actionLoadingId === project.project_id}
                                className="px-2.5 py-1.5 rounded-md hover:bg-red-500/20 text-[#8b90a0] hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky Mission Control Index Column (30%): order-1 lg:order-2 */}
          <aside className="lg:col-span-3 lg:sticky lg:top-4 space-y-4 order-1 lg:order-2">
            {/* Fleet Index Card */}
            <div className="rounded-xl bg-[#13141a] border border-[#262930] p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between border-b border-[#262930] pb-2.5">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[#e7e9ee]">
                    Fleet Mission Control
                  </h3>
                </div>
                <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-[#171921] text-[#8b90a0] border border-[#262930]">
                  {projects.length} Total
                </span>
              </div>

              <p className="text-[11px] text-[#8b90a0]">
                Click an active service to scroll into view. Minimized services show a glowing dot—click to restore with spring physics.
              </p>

              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {projects.map((p) => {
                  const isMin = !!minimizedMap[p.project_id];
                  const isPulse = pulsingIdxId === p.project_id;
                  const envCfg = getEnvConfig(p.environment);
                  return (
                    <div
                      key={p.project_id}
                      ref={(el) => { idxRefs.current[p.project_id] = el; }}
                      onClick={() => handleRestore(p.project_id)}
                      className={`fleet-idx group flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                        isPulse ? 'pulse' : ''
                      } ${
                        isMin
                          ? 'bg-[#171921]/60 border-purple-500/40 hover:border-purple-400'
                          : 'bg-[#0d0e12] border-[#262930] hover:border-[#7c8cff]/40 hover:bg-[#171921]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${envCfg.dotClass}`} />
                        <div className="min-w-0">
                          <span className="font-semibold text-xs text-[#e7e9ee] block truncate group-hover:text-white">
                            {p.name}
                          </span>
                          <span className="font-mono text-[10px] text-[#8b90a0] block truncate">
                            {p.project_id}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isMin ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                            RESTORE
                          </span>
                        ) : (
                          <span className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded border ${envCfg.pillClass}`}>
                            {envCfg.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Workspace Overview Telemetry Stats */}
            <div className="rounded-xl bg-[#13141a] border border-[#262930] p-4 shadow-lg space-y-3">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#e7e9ee]">
                  Workspace Health
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded bg-[#0d0e12] border border-[#262930]">
                  <span className="text-[#8b90a0] block text-[10px]">Total Services</span>
                  <span className="font-bold text-sm text-[#e7e9ee]">{projects.length}</span>
                </div>
                <div className="p-2.5 rounded bg-[#0d0e12] border border-[#262930]">
                  <span className="text-[#8b90a0] block text-[10px]">Production</span>
                  <span className="font-bold text-sm text-emerald-400">
                    {projects.filter((p) => (p.environment || '').toLowerCase().includes('prod')).length}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0d0e12] border border-[#262930]">
                  <span className="text-[#8b90a0] block text-[10px]">GitHub Linked</span>
                  <span className="font-bold text-sm text-purple-400">
                    {projects.filter((p) => p.github_repo || p.github_repo_override).length} / {projects.length}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0d0e12] border border-[#262930]">
                  <span className="text-[#8b90a0] block text-[10px]">Active Ingest DSNs</span>
                  <span className="font-bold text-sm text-cyan-400">{projects.length}</span>
                </div>
              </div>
            </div>
          </aside>
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
