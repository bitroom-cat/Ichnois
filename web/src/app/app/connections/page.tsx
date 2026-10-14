'use client';

import React, { useState, useEffect } from 'react';
import { api, DependencyHealth } from '@/lib/api';
import { HealthCard } from '@/components/HealthCard';
import { Button } from '@/components/primitives/Button';
import { Radio, RefreshCw, Zap, Info } from 'lucide-react';

export default function ConnectionsPage() {
  const [healthList, setHealthList] = useState<DependencyHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const data = await api.getHealth();
      setHealthList(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, []);

  const handlePing = async (key: string) => {
    const updated = await api.pingHealth(key);
    setHealthList(updated);
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      for (const item of healthList) {
        await api.pingHealth(item.key);
      }
      const refreshed = await api.getHealth();
      setHealthList(refreshed);
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <h1 className="text-title-2 font-semibold text-primary tracking-tight flex items-center gap-2">
            <Radio className="w-5 h-5 text-accent" />
            Service Health & Integrations
          </h1>
          <p className="text-dense text-secondary mt-1">
            Status and latency metrics for external systems connected to the triage pipeline.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleRefreshAll}
          disabled={refreshingAll}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
          <span>{refreshingAll ? 'Probing all services...' : 'Probe All Services'}</span>
        </Button>
      </div>

      {/* Notice */}
      <div className="p-4 rounded-lg border border-accent/20 bg-accent-subtle flex items-start gap-3 text-dense text-primary">
        <Info className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-primary">Host Standby & Cold Starts</p>
          <p className="text-secondary leading-relaxed">
            Free hosting tiers may sleep after inactivity. Probe services prior to a live presentation to warm up database connection pools and API rate limit caches.
          </p>
        </div>
      </div>

      {/* Grid of Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-2 py-12 text-center text-text-muted text-dense">
            Querying service telemetry...
          </div>
        ) : (
          healthList.map((health) => (
            <HealthCard key={health.key} health={health} onPing={handlePing} />
          ))
        )}
      </div>

      {/* Architecture Responsibility Box */}
      <div className="p-5 rounded-lg border border-border-subtle bg-surface shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-secondary flex items-center gap-1.5 font-mono">
            <Zap className="w-4 h-4 text-warning" />
            Server B Core Dual-Gate Architecture
          </h3>
          <span className="text-caption text-text-muted font-mono">Internal Network / Core Orchestration</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-caption">
          <div className="p-3 rounded-md border border-border-subtle bg-canvas space-y-1">
            <span className="font-mono font-semibold text-amber-500 block">Stage 1: Staging Queue</span>
            <p className="text-secondary text-caption">
              Status <code className="font-mono text-amber-500">staged_raw</code> (Gate 1). Raw crashes staged first with zero AI tokens and zero git calls. Operator reviews or auto-dispatches.
            </p>
          </div>
          <div className="p-3 rounded-md border border-border-subtle bg-canvas space-y-1">
            <span className="font-mono font-semibold text-purple-600 block">AI &amp; Git Orchestrator</span>
            <p className="text-secondary text-caption">
              Stack normalizer &rarr; SHA-256 dedupe &rarr; GraphQL blame at release SHA &rarr; LLM hypothesis &amp; 3-point checklist &rarr; Severity classifier.
            </p>
          </div>
          <div className="p-3 rounded-md border border-border-subtle bg-canvas space-y-1">
            <span className="font-mono font-semibold text-purple-400 block">Stage 2: Draft Staging</span>
            <p className="text-secondary text-caption">
              Status <code className="font-mono text-purple-400">staged_draft</code> (Gate 2). Interactive Markdown preview, custom title &amp; assignee editing, human sign-off.
            </p>
          </div>
          <div className="p-3 rounded-md border border-border-subtle bg-canvas space-y-1">
            <span className="font-mono font-semibold text-emerald-500 block">Dispatch Adapters</span>
            <p className="text-secondary text-caption">
              GitHub REST/GraphQL opens official issue with suspect commit diff. Slack webhook posts actionable incident card.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
