'use client';

import React, { useState, useEffect } from 'react';
import { RunItem, api } from '@/lib/api';
import { SeverityBadge, DomainBadge, ConfidenceBadge } from '@/components/primitives/Badge';
import { DiffView } from '@/components/primitives/DiffView';
import {
  Copy,
  Check,
  GitPullRequest,
  FileCode,
  CheckSquare,
  ExternalLink,
  Edit3,
  Save,
  Plus,
  Trash2,
  Sparkles,
} from 'lucide-react';

interface IssuePreviewProps {
  run: RunItem;
  editable?: boolean;
  onDraftSaved?: (updatedRun: RunItem) => void;
}

export function IssuePreview({ run, editable = true, onDraftSaved }: IssuePreviewProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'rendered' | 'edit' | 'markdown'>('rendered');
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});

  // Editing state
  const defaultTitle = run.draft_title || `[Auto-triage] ${run.incident.exception_type}: ${run.incident.error_message}`;
  const [title, setTitle] = useState(defaultTitle);
  const [assignee, setAssignee] = useState(run.custom_assignee || run.culprit.author_login || '');
  const [checklist, setChecklist] = useState<string[]>(
    run.explanation.checklist && run.explanation.checklist.length > 0
      ? run.explanation.checklist
      : ['Verify stack trace', 'Inspect suspect commit diff', 'Validate fix in staging']
  );
  const [newStepText, setNewStepText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setTitle(run.draft_title || `[Auto-triage] ${run.incident.exception_type}: ${run.incident.error_message}`);
    setAssignee(run.custom_assignee || run.culprit.author_login || '');
    if (run.explanation.checklist && run.explanation.checklist.length > 0) {
      setChecklist(run.explanation.checklist);
    }
  }, [run]);

  const toggleCheck = (idx: number) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleAddStep = () => {
    if (!newStepText.trim()) return;
    setChecklist((prev) => [...prev, newStepText.trim()]);
    setNewStepText('');
  };

  const handleRemoveStep = (idx: number) => {
    setChecklist((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const updatedBody = `## ${title}

**Severity:** ${run.severity}  **Domain:** \`${run.explanation.domain}\`  **Confidence:** ${run.culprit.confidence}
**Failing line:** \`${run.incident.file_path}:${run.incident.line_number}\`
**Suspect:** @${assignee} via ${run.culprit.sha} (PR-${run.culprit.pr_number || 'N/A'})
**Last changed:** ${run.culprit.within_window ? 'recent change (likely regression)' : 'old code (likely triggered by new data)'}

### Why it probably failed
${run.explanation.root_cause_hypothesis}

### Suspect change
\`\`\`diff
${run.culprit.diff}
\`\`\`

### Verification checklist
${checklist.map((step) => `- [ ] ${step}`).join('\n')}

<!-- ichnoscope:fp=${run.fingerprint} -->`;

      const res = await api.updateDraft(run.id, {
        draft_title: title,
        draft_body: updatedBody,
        custom_assignee: assignee,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (onDraftSaved) {
        onDraftSaved(res);
      }
      setActiveTab('rendered');
    } finally {
      setSaving(false);
    }
  };

  const rawMarkdown = `## ${title}

**Severity:** ${run.severity}  **Domain:** \`${run.explanation.domain}\`  **Confidence:** ${run.culprit.confidence}
**Failing line:** \`${run.incident.file_path}:${run.incident.line_number}\`
**Suspect:** @${assignee} via ${run.culprit.sha} (PR-${run.culprit.pr_number || 'N/A'})
**Last changed:** ${run.culprit.within_window ? 'recent change (likely regression)' : 'old code (likely triggered by new data)'}

### Why it probably failed
${run.explanation.root_cause_hypothesis}

### Suspect change
\`\`\`diff
${run.culprit.diff}
\`\`\`

### Verification checklist
${checklist.map((step: string) => `- [ ] ${step}`).join('\n')}

<!-- ichnoscope:fp=${run.fingerprint} -->`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(rawMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-surface overflow-hidden shadow-xs transition-colors">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-canvas/60 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-dense font-semibold text-primary">
            Gate 2: GitHub Issue Draft Review
          </span>
          <span className="text-text-muted">•</span>
          <span className="text-caption font-mono text-text-muted">
            fp:{run.fingerprint}
          </span>
          {saveSuccess && (
            <span className="ml-2 inline-flex items-center gap-1 text-caption text-emerald-500 font-medium">
              <Check className="w-3.5 h-3.5" /> Draft saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-canvas border border-border-subtle p-0.5 text-caption font-medium">
            <button
              onClick={() => setActiveTab('rendered')}
              className={`px-3 py-1 rounded-sm transition-colors ${
                activeTab === 'rendered'
                  ? 'bg-surface text-primary shadow-xs font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Preview
            </button>
            {editable && (
              <button
                onClick={() => setActiveTab('edit')}
                className={`px-3 py-1 rounded-sm transition-colors flex items-center gap-1 ${
                  activeTab === 'edit'
                    ? 'bg-surface text-primary shadow-xs font-semibold text-purple-600'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                <span>Edit Draft</span>
              </button>
            )}
            <button
              onClick={() => setActiveTab('markdown')}
              className={`px-3 py-1 rounded-sm transition-colors ${
                activeTab === 'markdown'
                  ? 'bg-surface text-primary shadow-xs font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Markdown
            </button>
          </div>

          <button
            onClick={copyToClipboard}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface text-secondary hover:text-primary border border-border-subtle text-caption font-medium transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {run.issue_url && (
            <a
              href={run.issue_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-subtle text-accent hover:bg-accent/20 border border-accent/30 text-caption font-medium transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open on GitHub
            </a>
          )}
        </div>
      </div>

      {/* Mode 1: Edit Draft Mode */}
      {activeTab === 'edit' && (
        <div className="p-5 sm:p-6 space-y-5 bg-canvas/30">
          <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <div>
              <h3 className="font-semibold text-xs text-text-primary uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-purple-600" />
                Interactive Control Center (Gate 2 Editor)
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5">
                Customize issue title, assigned owner, and actionable verification steps before Gate 2 publication.
              </p>
            </div>
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Draft'}</span>
            </button>
          </div>

          {/* Title input */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-text-secondary">
              GitHub Issue Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium font-sans bg-surface border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
              placeholder="e.g. [Auto-triage] KeyError: stripe_customer_id in payment.py"
            />
          </div>

          {/* Assignee input */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-text-secondary">
              GitHub Assignee (GitHub Username)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted font-mono font-semibold">@</span>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full max-w-sm px-3 py-2 text-xs font-mono bg-surface border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                placeholder="octocat"
              />
            </div>
            <span className="text-[10px] text-text-muted block">
              Suspect author from git blame: <code className="text-purple-600 font-mono">@{run.culprit.author_login}</code>
            </span>
          </div>

          {/* Interactive Checklist Editor */}
          <div className="space-y-2 pt-2">
            <label className="block text-xs font-semibold text-text-secondary">
              Verification Checklist Steps
            </label>
            <div className="space-y-2">
              {checklist.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded border border-border-strong text-purple-600 flex items-center justify-center shrink-0 text-[10px] font-mono font-bold">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    value={step}
                    onChange={(e) => {
                      const updated = [...checklist];
                      updated[idx] = e.target.value;
                      setChecklist(updated);
                    }}
                    className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveStep(idx)}
                    className="p-1.5 text-text-muted hover:text-rose-500 rounded hover:bg-canvas transition-colors"
                    title="Remove step"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new step */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newStepText}
                onChange={(e) => setNewStepText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddStep();
                  }
                }}
                placeholder="Add verification step (e.g. Verify Stripe payload in test fixture)..."
                className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-purple-600"
              />
              <button
                type="button"
                onClick={handleAddStep}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border-subtle bg-surface hover:bg-hover text-text-secondary text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Step</span>
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-border-subtle">
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Draft & Preview'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Mode 2: Body Area (Rendered Preview) */}
      {activeTab === 'rendered' && (
        <div className="p-5 sm:p-6 space-y-6">
          {/* Issue Header */}
          <div className="space-y-1.5 border-b border-border-subtle pb-4">
            <div className="flex items-center gap-2 text-caption text-text-muted">
              <span className="px-2 py-0.5 rounded-sm font-medium font-mono bg-purple-500/15 text-purple-400 border border-purple-500/30">
                Gate 2 Review Ready
              </span>
              <span>Drafted by Ichnoscope from Sentry telemetry &amp; git blame</span>
            </div>
            <h2 className="text-title-3 font-semibold text-primary tracking-tight flex items-baseline gap-2">
              <span>{title}</span>
            </h2>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 rounded-lg bg-canvas border border-border-subtle text-caption">
            <div>
              <span className="text-text-muted block mb-1">Severity &amp; Domain</span>
              <div className="flex items-center gap-1.5">
                <SeverityBadge severity={run.severity} />
                <DomainBadge domain={run.explanation.domain} />
              </div>
            </div>

            <div>
              <span className="text-text-muted block mb-1">Failing Line</span>
              <div
                className="font-mono text-accent font-medium truncate flex items-center gap-1.5"
                title={`${run.incident.file_path}:${run.incident.line_number}`}
              >
                <FileCode className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  {run.incident.file_path}:{run.incident.line_number}
                </span>
              </div>
            </div>

            <div>
              <span className="text-text-muted block mb-1">Target Assignee</span>
              <div className="flex items-center gap-1.5 text-primary">
                <span className="font-semibold">@{assignee}</span>
                {run.culprit.pr_number && (
                  <span className="text-text-muted font-mono text-caption flex items-center">
                    <GitPullRequest className="w-3 h-3 ml-1 mr-0.5 text-accent" />
                    PR-{run.culprit.pr_number}
                  </span>
                )}
              </div>
            </div>

            <div>
              <span className="text-text-muted block mb-1">Confidence</span>
              <ConfidenceBadge confidence={run.culprit.confidence} />
            </div>
          </div>

          {/* Why it probably failed */}
          <div className="space-y-2">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              Why it probably failed
            </h3>
            <div className="p-4 rounded-lg bg-surface border border-border-subtle text-dense text-secondary leading-relaxed">
              {run.explanation.root_cause_hypothesis}
            </div>
          </div>

          {/* Suspect change (Diff) */}
          <div className="space-y-2">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-text-muted">
              Suspect change
            </h3>
            <DiffView
              diff={run.culprit.diff}
              sha={run.culprit.sha}
              message={run.culprit.message}
            />
          </div>

          {/* Verification checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-caption font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-success" />
                Verification checklist
              </h3>
              {editable && (
                <button
                  onClick={() => setActiveTab('edit')}
                  className="text-xs text-purple-600 hover:underline flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Customize checklist</span>
                </button>
              )}
            </div>
            <div className="space-y-2">
              {checklist.map((step: string, idx: number) => (
                <label
                  key={idx}
                  onClick={() => toggleCheck(idx)}
                  className={`flex items-start gap-3 p-3 rounded-md border text-dense cursor-pointer transition-colors ${
                    checkedSteps[idx]
                      ? 'bg-success-subtle border-success/30 text-success line-through'
                      : 'bg-surface border-border-subtle text-secondary hover:border-border-strong'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!checkedSteps[idx]}
                    onChange={() => {}}
                    className="mt-0.5 h-4 w-4 rounded border-border-subtle text-accent focus:ring-accent"
                  />
                  <span>{step}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Footer watermark */}
          <div className="pt-3 border-t border-border-subtle text-caption text-text-muted font-mono flex items-center justify-between">
            <span>&lt;!-- ichnoscope:fp={run.fingerprint} --&gt;</span>
            <span>Deterministic blame at release SHA</span>
          </div>
        </div>
      )}

      {/* Mode 3: Raw Markdown */}
      {activeTab === 'markdown' && (
        <div className="p-4">
          <pre className="p-4 rounded-md bg-canvas border border-border-subtle text-caption font-mono text-accent overflow-x-auto whitespace-pre-wrap">
            {rawMarkdown}
          </pre>
        </div>
      )}
    </div>
  );
}
