'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, SystemSettings, PolicyDocument, PolicyRule, Project, ProjectUpdateInput } from '@/lib/api';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Button } from '@/components/primitives/Button';
import {
  Settings,
  Save,
  Check,
  ShieldCheck,
  Zap,
  Sliders,
  Plus,
  Trash2,
  CheckCircle2,
  FolderKanban,
  ExternalLink,
  Info,
  Server,
  ArrowRight,
  Github,
  MessageSquare,
  Key,
  Layers,
  Copy,
  Clock,
  Code,
  Terminal,
  RefreshCw,
} from 'lucide-react';

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentWorkspace, projects, refreshProjects } = useWorkspace();

  // Tab Scope: 'fleet' (Platform Fleet Settings) vs 'service' (Microservice Settings)
  const projectParam = searchParams.get('project');
  const initialScope = projectParam && projectParam !== 'global' ? 'service' : 'fleet';
  const [activeTab, setActiveTab] = useState<'fleet' | 'service'>(initialScope);

  // Selected microservice for Service Settings
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    projectParam && projectParam !== 'global'
      ? projectParam
      : (currentWorkspace && currentWorkspace !== 'global' ? currentWorkspace : 'checkout-service')
  );

  // Platform Fleet State
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [activePolicy, setActivePolicy] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedFleet, setSavedFleet] = useState(false);

  // Microservice Settings State
  const [serviceForm, setServiceForm] = useState<{
    name: string;
    environment: string;
    github_repo: string;
    fallback_assignee: string;
    path_prefix_strip: string;
    window_hours: number;
    webhook_url: string;
    slack_channel_override: string;
    rate_limit_min: number;
    automation_mode_override: string;
  }>({
    name: '',
    environment: 'production',
    github_repo: '',
    fallback_assignee: '',
    path_prefix_strip: '/app/',
    window_hours: 24,
    webhook_url: '',
    slack_channel_override: '',
    rate_limit_min: 120,
    automation_mode_override: 'inherit',
  });
  const [savingService, setSavingService] = useState(false);
  const [savedService, setSavedService] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New rule modal state
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleEnv, setNewRuleEnv] = useState('production');
  const [newRuleSev, setNewRuleSev] = useState('P1-Critical');
  const [newRuleGate1, setNewRuleGate1] = useState<'require_manual' | 'auto_approve' | 'auto_dismiss'>('auto_approve');
  const [newRuleGate2, setNewRuleGate2] = useState<'require_manual' | 'auto_publish'>('require_manual');
  const [newRuleSlack, setNewRuleSlack] = useState(true);

  // Load Platform Fleet Settings
  useEffect(() => {
    const loadFleet = async () => {
      setLoading(true);
      try {
        const [s, pData] = await Promise.all([api.getSettings(), api.getPolicies()]);
        setSettings(s);
        setPolicies(pData.policies || []);
        if (pData.policies && pData.policies.length > 0) {
          setActivePolicy(pData.policies[0]);
        }
      } finally {
        setLoading(false);
      }
    };
    loadFleet();
  }, []);

  // Sync service selection with query params & workspace context
  useEffect(() => {
    if (projectParam && projectParam !== 'global') {
      setActiveTab('service');
      setSelectedServiceId(projectParam);
    }
  }, [projectParam]);

  // Load selected microservice details into form
  const selectedProject = projects.find((p) => p.project_id === selectedServiceId) || projects[0] || null;

  useEffect(() => {
    if (selectedProject) {
      setServiceForm({
        name: selectedProject.name || '',
        environment: selectedProject.environment || 'production',
        github_repo: selectedProject.github_repo || selectedProject.github_repo_override || '',
        fallback_assignee: selectedProject.fallback_assignee || '',
        path_prefix_strip: selectedProject.path_prefix_strip || '/app/',
        window_hours: selectedProject.window_hours || 24,
        webhook_url: selectedProject.webhook_url || '',
        slack_channel_override: selectedProject.slack_channel_override || '',
        rate_limit_min: selectedProject.rate_limit_min || 120,
        automation_mode_override: selectedProject.automation_mode_override || 'inherit',
      });
    }
  }, [selectedProject?.project_id, selectedProject]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveFleet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    await api.updateSettings(settings);

    if (activePolicy) {
      await api.upsertPolicy({
        id: activePolicy.id,
        name: activePolicy.name,
        is_active: activePolicy.is_active,
        rule: activePolicy.rule,
      });
    }

    setSavedFleet(true);
    setTimeout(() => setSavedFleet(false), 3000);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    setSavingService(true);
    try {
      const updates: ProjectUpdateInput = {
        name: serviceForm.name,
        environment: serviceForm.environment,
        github_repo: serviceForm.github_repo.trim() || null,
        github_repo_override: serviceForm.github_repo.trim() || null,
        fallback_assignee: serviceForm.fallback_assignee.trim() || null,
        path_prefix_strip: serviceForm.path_prefix_strip.trim() || null,
        window_hours: Number(serviceForm.window_hours) || 24,
        webhook_url: serviceForm.webhook_url.trim() || null,
        slack_channel_override: serviceForm.slack_channel_override.trim() || null,
        rate_limit_min: Number(serviceForm.rate_limit_min) || 120,
        automation_mode_override: serviceForm.automation_mode_override === 'inherit' ? null : serviceForm.automation_mode_override,
      };

      await api.updateProject(selectedProject.project_id, updates);
      await refreshProjects();
      setSavedService(true);
      setTimeout(() => setSavedService(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to update microservice settings');
    } finally {
      setSavingService(false);
    }
  };

  const handleModeChange = (mode: 'full_manual' | 'semi_autonomous' | 'fully_autonomous') => {
    if (!settings) return;
    setSettings({ ...settings, automation_mode: mode });
    if (activePolicy) {
      setActivePolicy({
        ...activePolicy,
        rule: {
          ...activePolicy.rule,
          default_mode: mode,
        },
      });
    }
  };

  const handleToggleRule = (ruleIndex: number) => {
    if (!activePolicy || !activePolicy.rule.rules) return;
    const updatedRules = [...activePolicy.rule.rules];
    const newRules = updatedRules.filter((_, idx) => idx !== ruleIndex);
    setActivePolicy({
      ...activePolicy,
      rule: { ...activePolicy.rule, rules: newRules },
    });
  };

  const handleAddRule = () => {
    if (!newRuleName.trim() || !activePolicy) return;
    const newRule: PolicyRule = {
      name: newRuleName.trim(),
      condition: {
        environment: newRuleEnv,
        severity: newRuleSev,
      },
      action: {
        gate1: newRuleGate1,
        gate2: newRuleGate2,
        slack_alert: newRuleSlack,
      },
    };
    const existingRules = activePolicy.rule.rules || [];
    setActivePolicy({
      ...activePolicy,
      rule: {
        ...activePolicy.rule,
        rules: [newRule, ...existingRules],
      },
    });
    setNewRuleName('');
    setShowAddRuleModal(false);
  };

  const handleStartGitHubOAuth = async () => {
    if (!selectedProject) return;
    try {
      const data = await api.getGitHubInstallUrl(selectedProject.project_id);
      if (data?.install_url) {
        window.location.href = data.install_url;
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start GitHub App installation');
    }
  };

  if (loading || !settings) {
    return (
      <div className="py-20 text-center text-text-muted text-dense">
        Loading settings configuration...
      </div>
    );
  }

  const currentMode = settings.automation_mode || 'semi_autonomous';
  const edgeUrl = process.env.NEXT_PUBLIC_EDGE_GATEWAY_URL || 'https://ichnoisapi.onrender.com';
  const dsnPreview = selectedProject
    ? `https://${selectedProject.public_key}@${edgeUrl.replace(/^https?:\/\//, '')}/api/${selectedProject.project_id}`
    : '';

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 sm:p-6">
      {/* Page Header & Scope Tabs */}
      <div className="border-b border-border-subtle pb-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-text-primary flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-600" />
                <span>{activeTab === 'fleet' ? 'Platform Fleet Settings' : 'Microservice Service Settings'}</span>
              </h1>
              <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full border ${
                activeTab === 'fleet'
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                  : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
              }`}>
                {activeTab === 'fleet' ? 'Fleet Level' : 'Per-Service Scoped'}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-1">
              {activeTab === 'fleet'
                ? 'Fleet-wide deterministic severity rules, baseline dual-gate policies, and cluster classifier configuration.'
                : 'Dedicated repository scoping, unique Slack alerts webhook, blame path normalization, and telemetry credentials.'}
            </p>
          </div>

          {/* Saved feedback */}
          {savedFleet && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-fadeIn">
              <Check className="w-4 h-4" />
              Platform fleet settings saved
            </div>
          )}
          {savedService && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-fadeIn">
              <Check className="w-4 h-4" />
              Microservice settings saved
            </div>
          )}
        </div>

        {/* Segmented Control: Fleet vs Service */}
        <div className="flex items-center gap-2 bg-surface border border-border-subtle p-1 rounded-lg w-fit shadow-2xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('fleet');
              router.push('/app/settings');
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'fleet'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary hover:bg-hover'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Platform Fleet Settings</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('service');
              const target = selectedServiceId || (projects[0]?.project_id ?? 'checkout-service');
              router.push(`/app/settings?project=${target}`);
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'service'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary hover:bg-hover'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Microservice Service Settings</span>
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${activeTab === 'service' ? 'bg-white/20 text-white' : 'bg-surface-raised text-text-muted'}`}>
              {projects.length}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW A: MICROSERVICE SERVICE SETTINGS (UNIQUE REPO SCOPING & SLACK URL) */}
      {/* ========================================================================= */}
      {activeTab === 'service' && (
        <div className="space-y-6">
          {/* Microservice Switcher Strip */}
          <div className="p-4 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-600" />
                <span>Select Target Microservice</span>
              </label>
              <Link
                href="/app/projects"
                className="text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 font-medium"
              >
                <span>View all services in fleet</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {projects.map((proj) => {
                const isSelected = proj.project_id === (selectedProject?.project_id || selectedServiceId);
                return (
                  <button
                    key={proj.project_id}
                    type="button"
                    onClick={() => {
                      setSelectedServiceId(proj.project_id);
                      router.push(`/app/settings?project=${proj.project_id}`);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-purple-600 bg-purple-500/10 text-purple-700 dark:text-purple-300 font-semibold shadow-xs ring-1 ring-purple-600'
                        : 'border-border-subtle bg-surface-raised hover:bg-hover text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <FolderKanban className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-purple-600' : 'text-text-muted'}`} />
                    <span>{proj.name}</span>
                    <span className="font-mono text-[10px] opacity-70 px-1 py-0.2 rounded bg-surface border border-border-subtle">
                      {proj.project_id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedProject ? (
            <form onSubmit={handleSaveService} className="space-y-6">
              {/* CARD 1: DEDICATED GITHUB REPOSITORY SCOPING & BLAME */}
              <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
                <div className="border-b border-border-subtle pb-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                      <Github className="w-4 h-4 text-purple-600" />
                      <span>Microservice GitHub Scoping &amp; Triage Blame</span>
                    </h2>
                    <span className="font-mono text-[10px] font-bold text-emerald-600 uppercase px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      Scoped per Service
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Target GitHub repository, PR owner resolution, and stack trace path normalization unique to <strong>{selectedProject.name}</strong>.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Target Repository */}
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      GitHub Repository Scoping (owner/repo)
                    </label>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="relative flex-1">
                        <Github className="w-4 h-4 absolute left-3 top-2.5 text-text-muted" />
                        <input
                          type="text"
                          value={serviceForm.github_repo}
                          onChange={(e) => setServiceForm({ ...serviceForm, github_repo: e.target.value })}
                          placeholder="e.g. acme-corp/checkout-microservice"
                          className="w-full pl-9 pr-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleStartGitHubOAuth}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md bg-surface border border-border-subtle hover:bg-hover hover:border-purple-500 text-xs font-medium text-text-primary shrink-0 transition-colors shadow-2xs"
                      >
                        <Zap className="w-3.5 h-3.5 text-purple-600" />
                        <span>1-Click GitHub App Link</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-text-muted mt-1">
                      GraphQL blame queries this exact repository when an incident occurs in this microservice.
                    </p>
                  </div>

                  {/* Fallback Assignee & Path Prefix */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">
                        Fallback Assignee (GitHub Username)
                      </label>
                      <input
                        type="text"
                        value={serviceForm.fallback_assignee}
                        onChange={(e) => setServiceForm({ ...serviceForm, fallback_assignee: e.target.value })}
                        placeholder="e.g. vanshikarana06 or unassigned"
                        className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                      />
                      <p className="text-[11px] text-text-muted mt-1">
                        Assigned on GitHub when blame has no suspect or author is outside the organization.
                      </p>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">
                        Path Prefix Strip (Stack Normalizer)
                      </label>
                      <input
                        type="text"
                        value={serviceForm.path_prefix_strip}
                        onChange={(e) => setServiceForm({ ...serviceForm, path_prefix_strip: e.target.value })}
                        placeholder="e.g. /app/ or services/checkout/"
                        className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                      />
                      <p className="text-[11px] text-text-muted mt-1">
                        Strips docker/container prefixes so file paths match the Git repository root.
                      </p>
                    </div>
                  </div>

                  {/* Regression Window */}
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Regression Blame Window (Hours)
                    </label>
                    <input
                      type="number"
                      value={serviceForm.window_hours}
                      onChange={(e) => setServiceForm({ ...serviceForm, window_hours: Number(e.target.value) })}
                      className="w-32 px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                    />
                    <p className="text-[11px] text-text-muted mt-1">
                      Commits merged within this window receive highest suspect confidence.
                    </p>
                  </div>
                </div>
              </div>

              {/* CARD 2: DEDICATED SLACK ALERT WEBHOOK (UNIQUE PER SERVICE) */}
              <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
                <div className="border-b border-border-subtle pb-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-emerald-600" />
                      <span>Dedicated Slack Alert Webhook</span>
                    </h2>
                    <span className="font-mono text-[10px] font-bold text-emerald-600 uppercase px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      Unique per Microservice
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Route incidents and Gate 2 triage notifications directly to <strong>{selectedProject.name}</strong>&apos;s team channel.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Slack Incoming Webhook URL
                    </label>
                    <input
                      type="url"
                      value={serviceForm.webhook_url}
                      onChange={(e) => setServiceForm({ ...serviceForm, webhook_url: e.target.value })}
                      placeholder="https://hooks.slack.com/services/T00/B00/XXXX"
                      className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                    />
                    <p className="text-[11px] text-text-muted mt-1">
                      Leave empty to inherit the fleet platform default webhook if configured.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Slack Channel Label / Override
                    </label>
                    <input
                      type="text"
                      value={serviceForm.slack_channel_override}
                      onChange={(e) => setServiceForm({ ...serviceForm, slack_channel_override: e.target.value })}
                      placeholder="e.g. #alerts-checkout or #incident-response"
                      className="w-full sm:w-72 px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                    />
                  </div>
                </div>
              </div>

              {/* CARD 3: TELEMETRY KEYS & DSN */}
              <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
                <div className="border-b border-border-subtle pb-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                      <Key className="w-4 h-4 text-purple-600" />
                      <span>Telemetry Ingestion &amp; Sentry DSN</span>
                    </h2>
                    <span className="font-mono text-[10px] font-bold text-text-muted uppercase px-2 py-0.5 rounded bg-surface-raised border border-border-subtle">
                      Edge Ingestion
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Credentials required by application SDKs (Python, Node.js, Go) to ingest crashes into this service.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* DSN URL Preview */}
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Sentry SDK Compatible DSN
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={dsnPreview}
                        className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-muted select-all"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(dsnPreview, 'dsn')}
                        className="px-3 py-2 rounded-md bg-surface border border-border-subtle hover:bg-hover text-xs font-medium flex items-center gap-1.5 shrink-0"
                      >
                        {copiedKey === 'dsn' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-text-muted" />}
                        <span>{copiedKey === 'dsn' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">
                        Environment
                      </label>
                      <select
                        value={serviceForm.environment}
                        onChange={(e) => setServiceForm({ ...serviceForm, environment: e.target.value })}
                        className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs text-text-primary focus:outline-none focus:border-purple-600"
                      >
                        <option value="production">production</option>
                        <option value="staging">staging</option>
                        <option value="development">development</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-text-secondary block mb-1">
                        Rate Limit (Events / Minute)
                      </label>
                      <input
                        type="number"
                        value={serviceForm.rate_limit_min}
                        onChange={(e) => setServiceForm({ ...serviceForm, rate_limit_min: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs font-mono text-text-primary focus:outline-none focus:border-purple-600"
                      />
                    </div>
                  </div>

                  {/* Automation Mode Override */}
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Service Automation Mode Policy
                    </label>
                    <select
                      value={serviceForm.automation_mode_override}
                      onChange={(e) => setServiceForm({ ...serviceForm, automation_mode_override: e.target.value })}
                      className="w-full sm:w-80 px-3 py-2 bg-surface-raised border border-border-subtle rounded-md text-xs text-text-primary focus:outline-none focus:border-purple-600"
                    >
                      <option value="inherit">Inherit Fleet Default ({currentMode})</option>
                      <option value="full_manual">Force Full Manual (Always review Gate 1 &amp; Gate 2)</option>
                      <option value="semi_autonomous">Force Semi-Autonomous (Auto-AI root cause)</option>
                      <option value="fully_autonomous">Force Fully Autonomous (Auto-publish P1)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-2">
                <Button type="submit" variant="primary" disabled={savingService} className="gap-2 shadow-xs">
                  <Save className="w-4 h-4" />
                  <span>{savingService ? 'Saving...' : 'Save Microservice Settings'}</span>
                </Button>
              </div>
            </form>
          ) : (
            <div className="p-8 text-center text-text-muted border border-border-subtle rounded-xl bg-surface">
              No microservice selected. Please select a microservice above.
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW B: PLATFORM FLEET SETTINGS (SEVERITY CLASSIFIER & BASELINE POLICY) */}
      {/* ========================================================================= */}
      {activeTab === 'fleet' && (
        <form onSubmit={handleSaveFleet} className="space-y-6">
          {/* SECTION 1: SERVER B DUAL-GATE AUTOMATION POLICY ENGINE */}
          <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
            <div className="border-b border-border-subtle pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-600" />
                  <span>Server B Automation Policy Engine (Fleet Baseline)</span>
                </h2>
                <span className="font-mono text-[10px] font-bold text-purple-600 uppercase px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                  Cluster Default
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">
                Select how incoming telemetry errors pass through Gate 1 (Ingest Staging Queue) and Gate 2 (Draft Issue Staging).
              </p>
            </div>

            {/* 3 Modes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Mode 1: Manual Approval Mode */}
              <div
                onClick={() => handleModeChange('full_manual')}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  currentMode === 'full_manual'
                    ? 'border-purple-600 bg-surface shadow-xs ring-1 ring-purple-600'
                    : 'border-border-subtle bg-surface-raised hover:bg-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-xs text-text-primary">Manual Approval Mode</span>
                  {currentMode === 'full_manual' && <CheckCircle2 className="w-4 h-4 text-purple-600" />}
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  <strong>Gate 1:</strong> Holds all crashes in <code className="font-mono text-amber-500">staged_raw</code>.<br />
                  <strong>Gate 2:</strong> Requires operator manual sign-off before GitHub push.
                </p>
              </div>

              {/* Mode 2: Auto-AI Mode (Semi-Autonomous) */}
              <div
                onClick={() => handleModeChange('semi_autonomous')}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  currentMode === 'semi_autonomous'
                    ? 'border-purple-600 bg-surface shadow-xs ring-1 ring-purple-600'
                    : 'border-border-subtle bg-surface-raised hover:bg-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-text-primary">Auto-AI Mode</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-600 text-white font-mono uppercase">
                      Rec
                    </span>
                  </div>
                  {currentMode === 'semi_autonomous' && <CheckCircle2 className="w-4 h-4 text-purple-600" />}
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  <strong>Gate 1:</strong> Auto-dispatches to AI root-cause investigation.<br />
                  <strong>Gate 2:</strong> Staged at <code className="font-mono text-purple-500">staged_draft</code> for human review.
                </p>
              </div>

              {/* Mode 3: Full Auto Mode */}
              <div
                onClick={() => handleModeChange('fully_autonomous')}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  currentMode === 'fully_autonomous'
                    ? 'border-purple-600 bg-surface shadow-xs ring-1 ring-purple-600'
                    : 'border-border-subtle bg-surface-raised hover:bg-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-xs text-text-primary">Full Auto Mode</span>
                  {currentMode === 'fully_autonomous' && <CheckCircle2 className="w-4 h-4 text-purple-600" />}
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  <strong>Gate 1:</strong> Auto-dispatches to AI investigation.<br />
                  <strong>Gate 2:</strong> High confidence (&ge;90%) &amp; P1 auto-publishes directly to GitHub!
                </p>
              </div>
            </div>

            {/* AUTO-DISPATCH & RULE MATCH ENGINE */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-primary font-mono flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Auto-Dispatch Engine (Rule Matches)</span>
                  </h3>
                  <p className="text-[11px] text-text-muted">
                    Rules that match incoming incidents advance directly to the AI pipeline or auto-dismiss spam.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddRuleModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-border-subtle bg-surface hover:bg-hover text-xs font-medium text-text-primary transition-colors shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Rule</span>
                </button>
              </div>

              {/* Configured Rules List */}
              <div className="space-y-2">
                {activePolicy?.rule.rules && activePolicy.rule.rules.length > 0 ? (
                  activePolicy.rule.rules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-border-subtle bg-surface-raised/40 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text-primary truncate">{rule.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-border-subtle text-text-secondary">
                            {rule.condition.environment || 'any env'} • {rule.condition.severity || 'any sev'}
                          </span>
                        </div>
                        <div className="text-[11px] text-text-muted font-mono flex items-center gap-2">
                          <span>Gate 1: <strong>{rule.action.gate1 || 'auto_approve'}</strong></span>
                          <span>•</span>
                          <span>Gate 2: <strong>{rule.action.gate2 || 'require_manual'}</strong></span>
                          {rule.action.slack_alert && (
                            <>
                              <span>•</span>
                              <span className="text-emerald-600 font-medium">Slack Alert On</span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleRule(idx)}
                        className="p-1 rounded text-text-muted hover:text-red-500 transition-colors"
                        title="Remove rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-3 rounded-lg border border-border-subtle text-center text-xs text-text-muted bg-surface-raised/20">
                    No custom rules configured. Using default {currentMode} policy.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 2: DETERMINISTIC SEVERITY RULES (CLASSIFIER) */}
          <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
            <div className="border-b border-border-subtle pb-3">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-600" />
                <span>Deterministic Severity Rules (Cluster Classifier)</span>
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Calculated strictly from event and user counts. Applied fleet-wide across all services. The LLM never sets severity.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-surface-raised/40 border border-border-subtle rounded-lg space-y-1">
                <span className="font-semibold text-red-500 block">P1 Users Threshold</span>
                <input
                  type="number"
                  value={settings.p1_users}
                  onChange={(e) => setSettings({ ...settings, p1_users: Number(e.target.value) })}
                  className="w-full bg-surface border border-border-subtle rounded px-2.5 py-1.5 text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-text-muted block">&ge; 50 users in prod</span>
              </div>

              <div className="p-3 bg-surface-raised/40 border border-border-subtle rounded-lg space-y-1">
                <span className="font-semibold text-red-500 block">P1 Events Threshold</span>
                <input
                  type="number"
                  value={settings.p1_events}
                  onChange={(e) => setSettings({ ...settings, p1_events: Number(e.target.value) })}
                  className="w-full bg-surface border border-border-subtle rounded px-2.5 py-1.5 text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-text-muted block">&ge; 100 events in prod</span>
              </div>

              <div className="p-3 bg-surface-raised/40 border border-border-subtle rounded-lg space-y-1">
                <span className="font-semibold text-amber-500 block">P2 Users Threshold</span>
                <input
                  type="number"
                  value={settings.p2_users}
                  onChange={(e) => setSettings({ ...settings, p2_users: Number(e.target.value) })}
                  className="w-full bg-surface border border-border-subtle rounded px-2.5 py-1.5 text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-text-muted block">&ge; 10 users in prod</span>
              </div>

              <div className="p-3 bg-surface-raised/40 border border-border-subtle rounded-lg space-y-1">
                <span className="font-semibold text-amber-500 block">P2 Events Threshold</span>
                <input
                  type="number"
                  value={settings.p2_events}
                  onChange={(e) => setSettings({ ...settings, p2_events: Number(e.target.value) })}
                  className="w-full bg-surface border border-border-subtle rounded px-2.5 py-1.5 text-text-primary font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-text-muted block">&ge; 20 events in prod</span>
              </div>
            </div>
          </div>

          {/* Save Bar */}
          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" className="gap-2 shadow-xs">
              <Save className="w-4 h-4" />
              <span>Save Platform Settings</span>
            </Button>
          </div>
        </form>
      )}

      {/* Add Custom Policy Rule Modal */}
      {showAddRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface p-5 shadow-2xl space-y-4">
            <div className="border-b border-border-subtle pb-3">
              <h3 className="font-semibold text-sm text-text-primary">Add Fleet Auto-Dispatch Rule</h3>
              <p className="text-[11px] text-text-muted">Define how matching crashes are triaged across gates</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Rule Name</label>
                <input
                  type="text"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  placeholder="e.g. Critical Payments Escalation"
                  className="w-full px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Environment</label>
                  <select
                    value={newRuleEnv}
                    onChange={(e) => setNewRuleEnv(e.target.value)}
                    className="w-full px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                  >
                    <option value="production">production</option>
                    <option value="staging">staging</option>
                    <option value="development">development</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Severity</label>
                  <select
                    value={newRuleSev}
                    onChange={(e) => setNewRuleSev(e.target.value)}
                    className="w-full px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                  >
                    <option value="P1-Critical">P1-Critical</option>
                    <option value="P2-High">P2-High</option>
                    <option value="P3-Medium">P3-Medium</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Gate 1 (Ingest)</label>
                  <select
                    value={newRuleGate1}
                    onChange={(e) => setNewRuleGate1(e.target.value as any)}
                    className="w-full px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                  >
                    <option value="auto_approve">auto_approve (Advance to AI)</option>
                    <option value="require_manual">require_manual (Operator review)</option>
                    <option value="auto_dismiss">auto_dismiss (Spam filter)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Gate 2 (Draft)</label>
                  <select
                    value={newRuleGate2}
                    onChange={(e) => setNewRuleGate2(e.target.value as any)}
                    className="w-full px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                  >
                    <option value="require_manual">require_manual (Sign-off)</option>
                    <option value="auto_publish">auto_publish (Direct Push)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={newRuleSlack}
                  onChange={(e) => setNewRuleSlack(e.target.checked)}
                  className="rounded border-border-subtle text-purple-600"
                />
                <span className="text-text-secondary">Dispatch Slack notification alert</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setShowAddRuleModal(false)}
                className="px-3 py-1.5 rounded-md border border-border-subtle text-xs text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddRule}
                disabled={!newRuleName.trim()}
                className="px-3.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs"
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-text-muted text-dense">
          Loading settings...
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
