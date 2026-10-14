'use client';

import React, { useState, useEffect } from 'react';
import { api, SystemSettings, PolicyDocument, PolicyRule } from '@/lib/api';
import { Button } from '@/components/primitives/Button';
import {
  Settings,
  Save,
  Check,
  GitBranch,
  Cpu,
  Bell,
  Sliders,
  Send,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Zap,
  SlidersHorizontal,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Slash,
} from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [activePolicy, setActivePolicy] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackFeedback, setSlackFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showAdminToken, setShowAdminToken] = useState(false);

  // New rule modal state
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleEnv, setNewRuleEnv] = useState('production');
  const [newRuleSev, setNewRuleSev] = useState('P1-Critical');
  const [newRuleGate1, setNewRuleGate1] = useState<'require_manual' | 'auto_approve' | 'auto_dismiss'>('auto_approve');
  const [newRuleGate2, setNewRuleGate2] = useState<'require_manual' | 'auto_publish'>('require_manual');
  const [newRuleSlack, setNewRuleSlack] = useState(true);

  useEffect(() => {
    const load = async () => {
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
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    // Save core settings
    await api.updateSettings(settings);

    // Save active policy if modified
    if (activePolicy) {
      await api.upsertPolicy({
        id: activePolicy.id,
        name: activePolicy.name,
        is_active: activePolicy.is_active,
        rule: activePolicy.rule,
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
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
    // We can remove or toggle
    const rule = updatedRules[ruleIndex];
    if (rule) {
      // Toggle rule presence or action
      const newRules = updatedRules.filter((_, idx) => idx !== ruleIndex);
      setActivePolicy({
        ...activePolicy,
        rule: { ...activePolicy.rule, rules: newRules },
      });
    }
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

  const handleTestSlack = async () => {
    if (!settings) return;
    setTestingSlack(true);
    setSlackFeedback(null);
    try {
      const res = await api.testSlackWebhook(settings.slack_webhook_url);
      setSlackFeedback({ type: 'success', message: res.message || 'Test notification sent to Slack successfully!' });
    } catch (err: any) {
      setSlackFeedback({
        type: 'error',
        message: err.message || 'Failed to dispatch Slack test alert. Please verify your Webhook URL.',
      });
    } finally {
      setTestingSlack(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="py-20 text-center text-text-muted text-dense">
        Loading configuration &amp; Server B policy rules...
      </div>
    );
  }

  const currentMode = settings.automation_mode || 'semi_autonomous';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <h1 className="text-title-2 font-semibold text-primary tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" />
            Server B Orchestration &amp; Pipeline Settings
          </h1>
          <p className="text-dense text-secondary mt-1">
            Configure Gate 1 ingestion, Auto-Dispatch rules, Gate 2 publication policies, and integrations.
          </p>
        </div>

        {saved && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success-subtle border border-success/30 text-success text-caption font-medium animate-fadeIn">
            <Check className="w-4 h-4 text-success" />
            Configuration saved
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SECTION 0: SERVER B DUAL-GATE AUTOMATION MODES */}
        <div className="p-5 sm:p-6 rounded-lg border border-purple-500/30 bg-purple-500/5 shadow-xs space-y-4">
          <div className="border-b border-purple-500/20 pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-dense font-semibold text-primary flex items-center gap-2 font-mono">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                Server B Automation Policy Engine
              </h2>
              <span className="font-mono text-[11px] font-semibold text-purple-600 uppercase px-2 py-0.5 rounded bg-purple-500/10">
                Core Gate Control
              </span>
            </div>
            <p className="text-caption text-secondary mt-0.5">
              Select how incoming Sentry errors pass through Gate 1 (Ingest Staging Queue) and Gate 2 (Draft Issue Staging).
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
                  : 'border-border-subtle bg-canvas hover:bg-surface'
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
                  : 'border-border-subtle bg-canvas hover:bg-surface'
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
                <strong>Gate 1:</strong> Auto-dispatches to AI investigation.<br />
                <strong>Gate 2:</strong> Staged at <code className="font-mono text-purple-500">staged_draft</code> for human review.
              </p>
            </div>

            {/* Mode 3: Full Auto Mode */}
            <div
              onClick={() => handleModeChange('fully_autonomous')}
              className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                currentMode === 'fully_autonomous'
                  ? 'border-purple-600 bg-surface shadow-xs ring-1 ring-purple-600'
                  : 'border-border-subtle bg-canvas hover:bg-surface'
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
                  <Zap className="w-3.5 h-3.5 text-warning" />
                  Auto-Dispatch Engine (Rule Matches)
                </h3>
                <p className="text-[11px] text-text-muted">
                  Rules that match incoming incidents advance directly to the AI pipeline or auto-dismiss spam.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAddRuleModal(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-border-subtle bg-surface hover:bg-hover text-xs font-medium text-text-primary transition-colors"
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
                    className="p-3 rounded-lg border border-border-subtle bg-surface flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text-primary truncate">{rule.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-canvas border border-border-subtle text-text-secondary">
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
                      className="p-1 rounded text-text-muted hover:text-rose-500 transition-colors"
                      title="Remove rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded border border-border-subtle text-center text-xs text-text-muted">
                  No custom rules configured. Using default {currentMode} policy.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 1: GitHub Repository Scoping */}
        <div className="p-5 sm:p-6 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <h2 className="text-dense font-semibold text-primary flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-accent" />
              Repository Scoping
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-dense">
            <div>
              <label className="text-secondary block font-medium mb-1">
                Target Repository (<code className="font-mono text-accent">GITHUB_REPOSITORY</code>)
              </label>
              <input
                type="text"
                value={settings.github_repo}
                onChange={(e) => setSettings({ ...settings, github_repo: e.target.value })}
                className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono focus:outline-none focus:border-accent"
              />
              <span className="text-caption text-text-muted mt-1 block">Format: owner/repo</span>
            </div>

            <div>
              <label className="text-secondary block font-medium mb-1">
                Fallback Assignee (<code className="font-mono text-accent">FALLBACK_ASSIGNEE</code>)
              </label>
              <input
                type="text"
                value={settings.fallback_assignee}
                onChange={(e) => setSettings({ ...settings, fallback_assignee: e.target.value })}
                className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono focus:outline-none focus:border-accent"
              />
              <span className="text-caption text-text-muted mt-1 block">Assigned if author is not in repo assignees</span>
            </div>

            <div>
              <label className="text-secondary block font-medium mb-1">
                Path Prefix Strip (<code className="font-mono text-accent">PATH_PREFIX_STRIP</code>)
              </label>
              <input
                type="text"
                value={settings.path_prefix_strip}
                onChange={(e) => setSettings({ ...settings, path_prefix_strip: e.target.value })}
                className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono focus:outline-none focus:border-accent"
              />
              <span className="text-caption text-text-muted mt-1 block">e.g. /app/ to convert container path to repo-relative</span>
            </div>

            <div>
              <label className="text-secondary block font-medium mb-1">
                Regression Window (<code className="font-mono text-accent">WINDOW_HOURS</code>)
              </label>
              <input
                type="number"
                value={settings.window_hours}
                onChange={(e) => setSettings({ ...settings, window_hours: Number(e.target.value) })}
                className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono focus:outline-none focus:border-accent"
              />
              <span className="text-caption text-text-muted mt-1 block">Hours since commit to mark as regression (default: 24h)</span>
            </div>
          </div>
        </div>

        {/* Section 2: Severity Heuristics */}
        <div className="p-5 sm:p-6 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <h2 className="text-dense font-semibold text-primary flex items-center gap-2">
              <Sliders className="w-4 h-4 text-warning" />
              Deterministic Severity Rules (Classifier)
            </h2>
            <p className="text-caption text-secondary mt-0.5">
              Calculated strictly from event and user counts. The LLM never sets severity.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-dense">
            <div className="p-3 bg-canvas border border-border-subtle rounded-md space-y-1">
              <span className="font-semibold text-danger block">P1 Users</span>
              <input
                type="number"
                value={settings.p1_users}
                onChange={(e) => setSettings({ ...settings, p1_users: Number(e.target.value) })}
                className="w-full bg-surface border border-border-subtle rounded px-2 py-1 text-primary font-mono text-dense"
              />
              <span className="text-caption text-text-muted block">&ge; 50 in prod</span>
            </div>

            <div className="p-3 bg-canvas border border-border-subtle rounded-md space-y-1">
              <span className="font-semibold text-danger block">P1 Events</span>
              <input
                type="number"
                value={settings.p1_events}
                onChange={(e) => setSettings({ ...settings, p1_events: Number(e.target.value) })}
                className="w-full bg-surface border border-border-subtle rounded px-2 py-1 text-primary font-mono text-dense"
              />
              <span className="text-caption text-text-muted block">&ge; 100 in prod</span>
            </div>

            <div className="p-3 bg-canvas border border-border-subtle rounded-md space-y-1">
              <span className="font-semibold text-warning block">P2 Users</span>
              <input
                type="number"
                value={settings.p2_users}
                onChange={(e) => setSettings({ ...settings, p2_users: Number(e.target.value) })}
                className="w-full bg-surface border border-border-subtle rounded px-2 py-1 text-primary font-mono text-dense"
              />
              <span className="text-caption text-text-muted block">&ge; 10 in prod</span>
            </div>

            <div className="p-3 bg-canvas border border-border-subtle rounded-md space-y-1">
              <span className="font-semibold text-warning block">P2 Events</span>
              <input
                type="number"
                value={settings.p2_events}
                onChange={(e) => setSettings({ ...settings, p2_events: Number(e.target.value) })}
                className="w-full bg-surface border border-border-subtle rounded px-2 py-1 text-primary font-mono text-dense"
              />
              <span className="text-caption text-text-muted block">&ge; 20 in prod</span>
            </div>
          </div>
        </div>

        {/* Section 3: LLM Provider */}
        <div className="p-5 sm:p-6 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <h2 className="text-dense font-semibold text-primary flex items-center gap-2">
              <Cpu className="w-4 h-4 text-accent" />
              LLM Explanation Provider
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-dense">
            <div>
              <label className="text-secondary block font-medium mb-1">
                Primary Model Provider
              </label>
              <select
                value={settings.llm_provider}
                onChange={(e) => setSettings({ ...settings, llm_provider: e.target.value as any })}
                className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono text-dense focus:outline-none focus:border-accent"
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Structured Outputs)</option>
                <option value="groq-llama3">Groq (Llama-3-70B)</option>
                <option value="openrouter">OpenRouter (Free tier fallback)</option>
                <option value="pollinations">Pollinations API</option>
              </select>
              <span className="text-caption text-text-muted mt-1 block">
                Evidence context bounded to 4,096 tokens max.
              </span>
            </div>

            <div className="flex items-center gap-2 pt-6">
              <label className="flex items-center gap-2 cursor-pointer text-secondary">
                <input
                  type="checkbox"
                  checked={settings.dry_run}
                  onChange={(e) => setSettings({ ...settings, dry_run: e.target.checked })}
                  className="rounded border-border-subtle text-accent focus:ring-accent h-4 w-4"
                />
                <span className="text-dense font-medium">
                  Dry-run mode (<code className="font-mono text-accent">DRY_RUN=true</code>)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Section 4: Notifications (Slack Webhook) */}
        <div className="p-5 sm:p-6 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-5">
          <div className="border-b border-border-subtle pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-dense font-semibold text-primary flex items-center gap-2">
                <Bell className="w-4 h-4 text-success" />
                Slack Notifications &amp; Webhook Dispatch Adapter
              </h2>
              <p className="text-caption text-secondary mt-0.5">
                Dispatch actionable incident alert cards to Slack when drafts are published.
              </p>
            </div>
            {settings.slack_webhook_url && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-success-subtle text-success border border-success/20">
                <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                Webhook Configured
              </span>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-secondary block font-medium mb-1 text-dense">
                Slack Incoming Webhook URL (<code className="font-mono text-accent">SLACK_WEBHOOK_URL</code>)
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="password"
                  value={settings.slack_webhook_url || ''}
                  onChange={(e) => setSettings({ ...settings, slack_webhook_url: e.target.value })}
                  placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
                  className="flex-1 bg-canvas border border-border-subtle rounded-md px-3 py-2 text-primary font-mono text-dense focus:outline-none focus:border-accent"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={testingSlack || (!settings.slack_webhook_url && !settings.slack_enabled)}
                  onClick={handleTestSlack}
                  className="gap-2 whitespace-nowrap shrink-0"
                >
                  {testingSlack ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Testing Dispatch...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 text-accent" />
                      Send Test Alert
                    </>
                  )}
                </Button>
              </div>
            </div>

            {slackFeedback && (
              <div
                className={`p-3.5 rounded-md border flex items-start gap-2.5 text-dense animate-fadeIn ${
                  slackFeedback.type === 'success'
                    ? 'bg-success-subtle/50 border-success/30 text-success'
                    : 'bg-danger-subtle/50 border-danger/30 text-danger'
                }`}
              >
                {slackFeedback.type === 'success' ? (
                  <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className="font-medium text-caption">
                    {slackFeedback.type === 'success' ? 'Alert Delivered' : 'Delivery Failed'}
                  </p>
                  <p className="text-caption opacity-90 mt-0.5">{slackFeedback.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 5: Security & Admin Token */}
        <div className="p-5 sm:p-6 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <h2 className="text-dense font-semibold text-primary flex items-center gap-2">
              <Lock className="w-4 h-4 text-warning" />
              Security &amp; Admin Token
            </h2>
            <p className="text-caption text-secondary mt-0.5">
              Protect administrative endpoints and gate manual approvals.
            </p>
          </div>

          <div className="text-dense">
            <label className="text-secondary block font-medium mb-1">
              Admin Access Token (<code className="font-mono text-accent">ADMIN_TOKEN</code>)
            </label>
            <div className="relative max-w-lg">
              <input
                type={showAdminToken ? 'text' : 'password'}
                value={settings.admin_token || ''}
                onChange={(e) => setSettings({ ...settings, admin_token: e.target.value })}
                placeholder="ichnoscope-secret-admin-token"
                className="w-full bg-canvas border border-border-subtle rounded-md pl-3 pr-10 py-2 text-primary font-mono focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowAdminToken(!showAdminToken)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-primary transition-colors"
                title={showAdminToken ? 'Hide token' : 'Show token'}
              >
                {showAdminToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Save Bar */}
        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" className="gap-2">
            <Save className="w-4 h-4" />
            Save Configuration
          </Button>
        </div>
      </form>

      {/* Add Custom Policy Rule Modal */}
      {showAddRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface p-5 shadow-popover space-y-4">
            <div className="border-b border-border-subtle pb-3">
              <h3 className="font-semibold text-sm text-text-primary">Add Auto-Dispatch Policy Rule</h3>
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
                  className="w-full px-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Environment</label>
                  <select
                    value={newRuleEnv}
                    onChange={(e) => setNewRuleEnv(e.target.value)}
                    className="w-full px-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
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
                    className="w-full px-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
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
                    className="w-full px-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
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
                    className="w-full px-3 py-1.5 bg-canvas border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
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
                className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
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
