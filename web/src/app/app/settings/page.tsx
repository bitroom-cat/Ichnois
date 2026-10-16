'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, SystemSettings, PolicyDocument, PolicyRule } from '@/lib/api';
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
} from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [activePolicy, setActivePolicy] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

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

    // Save core platform fleet settings
    await api.updateSettings(settings);

    // Save active fleet policy if modified
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

  if (loading || !settings) {
    return (
      <div className="py-20 text-center text-text-muted text-dense">
        Loading fleet platform configuration &amp; Server B policy rules...
      </div>
    );
  }

  const currentMode = settings.automation_mode || 'semi_autonomous';

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-text-primary flex items-center gap-2">
              <Server className="w-5 h-5 text-purple-600" />
              Platform Fleet Settings &amp; Automation Engine
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              Fleet Level
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Cluster-wide deterministic severity rules, Server B baseline dual-gate policies, and incident dispatch rules.
          </p>
        </div>

        {saved && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-fadeIn">
            <Check className="w-4 h-4" />
            Platform settings saved
          </div>
        )}
      </div>

      {/* INFORMATIONAL CALLOUT: PLATFORM VS MICROSERVICE DECOUPLING */}
      <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h3 className="text-xs font-semibold text-text-primary">
              Microservice Decoupling Active
            </h3>
            <p className="text-xs text-text-secondary">
              Repository scoping, blame stripping, regression windows, and dedicated Slack channels now belong to individual microservices.
            </p>
          </div>
        </div>

        <Link
          href="/app/projects"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface hover:bg-hover border border-border-subtle text-xs font-medium text-purple-600 dark:text-purple-400 shrink-0 transition-colors shadow-2xs"
        >
          <FolderKanban className="w-3.5 h-3.5" />
          <span>Manage Microservices</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SECTION 1: SERVER B DUAL-GATE AUTOMATION POLICY ENGINE */}
        <div className="p-5 sm:p-6 rounded-xl border border-border-subtle bg-surface shadow-xs space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                Server B Automation Policy Engine (Fleet Baseline)
              </h2>
              <span className="font-mono text-[10px] font-bold text-purple-600 uppercase px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                Core Gate Control
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
                  Auto-Dispatch Engine (Rule Matches)
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
              Deterministic Severity Rules (Cluster Classifier)
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
            Save Platform Settings
          </Button>
        </div>
      </form>

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
