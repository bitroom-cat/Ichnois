'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCw,
  XCircle,
  Flame,
  FileEdit,
  Radio,
  Slash,
  Server,
  Layout,
  Database,
  Cpu,
  ShieldCheck,
} from 'lucide-react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'draft' | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({
  className,
  variant = 'default',
  size = 'sm',
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium font-mono rounded-sm select-none',
        size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-2.5 py-1 text-xs',
        variant === 'default' && 'bg-surface text-secondary border border-border-subtle',
        variant === 'accent' && 'bg-accent/15 text-accent border border-accent/30',
        variant === 'success' && 'bg-success-subtle text-success border border-success/30',
        variant === 'warning' && 'bg-warning-subtle text-warning border border-warning/30',
        variant === 'danger' && 'bg-danger-subtle text-danger border border-danger/30',
        variant === 'info' && 'bg-info-subtle text-info border border-info/30',
        variant === 'draft' && 'bg-draft-subtle text-draft border border-draft/30',
        variant === 'outline' && 'bg-transparent text-secondary border border-border-strong',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export type RunStatus =
  | 'received'
  | 'parsing'
  | 'blaming'
  | 'explaining'
  | 'draft_ready'
  | 'published'
  | 'rejected'
  | 'failed'
  | 'suppressed';

export function StatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const config = {
    received: {
      label: 'Received',
      icon: <Clock className="w-3 h-3 text-text-muted" />,
      classes: 'bg-surface text-text-muted border border-border-subtle',
    },
    parsing: {
      label: 'Parsing stack',
      icon: <RotateCw className="w-3 h-3 text-info animate-spin" />,
      classes: 'bg-info-subtle text-info border border-info/30 animate-pulse',
    },
    blaming: {
      label: 'Querying blame',
      icon: <RotateCw className="w-3 h-3 text-info animate-spin" />,
      classes: 'bg-info-subtle text-info border border-info/30 animate-pulse',
    },
    explaining: {
      label: 'LLM reasoning',
      icon: <Radio className="w-3 h-3 text-info animate-pulse" />,
      classes: 'bg-info-subtle text-info border border-info/30 animate-pulse',
    },
    draft_ready: {
      label: 'Draft ready',
      icon: <FileEdit className="w-3 h-3 text-draft" />,
      classes: 'bg-draft-subtle text-draft border border-draft/40 font-semibold',
    },
    published: {
      label: 'Published',
      icon: <CheckCircle2 className="w-3 h-3 text-success" />,
      classes: 'bg-success-subtle text-success border border-success/30 font-medium',
    },
    rejected: {
      label: 'Rejected',
      icon: <XCircle className="w-3 h-3 text-text-muted" />,
      classes: 'bg-surface text-text-muted border border-border-subtle',
    },
    suppressed: {
      label: 'Suppressed',
      icon: <Slash className="w-3 h-3 text-text-muted" />,
      classes: 'bg-surface text-text-muted border border-border-subtle',
    },
    failed: {
      label: 'Failed',
      icon: <AlertCircle className="w-3 h-3 text-danger" />,
      classes: 'bg-danger-subtle text-danger border border-danger/30 font-medium',
    },
  }[status] || {
    label: status,
    icon: <Clock className="w-3 h-3" />,
    classes: 'bg-surface text-text-muted border border-border-subtle',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none',
        config.classes,
        className
      )}
    >
      {config.icon}
      <span>{config.label}</span>
    </span>
  );
}

export type Severity = 'P1-Critical' | 'P2-High' | 'P3-Medium';

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const config = {
    'P1-Critical': {
      label: 'P1-Critical',
      icon: <Flame className="w-3 h-3 text-danger" />,
      classes: 'bg-danger-subtle text-danger border border-danger/30 font-semibold',
    },
    'P2-High': {
      label: 'P2-High',
      icon: <AlertTriangle className="w-3 h-3 text-severity-high" />,
      classes: 'bg-severity-high/10 text-severity-high border border-severity-high/30 font-semibold',
    },
    'P3-Medium': {
      label: 'P3-Medium',
      icon: <AlertCircle className="w-3 h-3 text-warning" />,
      classes: 'bg-warning-subtle text-warning border border-warning/30 font-medium',
    },
  }[severity] || {
    label: severity,
    icon: <AlertCircle className="w-3 h-3" />,
    classes: 'bg-surface text-text-muted border border-border-subtle',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-caption font-mono select-none',
        config.classes,
        className
      )}
    >
      {config.icon}
      <span>{config.label}</span>
    </span>
  );
}

export type Domain = 'backend' | 'frontend' | 'database' | 'infra';

export function DomainBadge({ domain, className }: { domain: Domain | string; className?: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    backend: <Server className="w-3 h-3 text-secondary" />,
    frontend: <Layout className="w-3 h-3 text-secondary" />,
    database: <Database className="w-3 h-3 text-secondary" />,
    infra: <Cpu className="w-3 h-3 text-secondary" />,
  };
  const icon = iconMap[domain] || <Server className="w-3 h-3 text-secondary" />;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-mono bg-surface text-secondary border border-border-subtle select-none',
        className
      )}
    >
      {icon}
      <span>{domain}</span>
    </span>
  );
}

export function ConfidenceBadge({ confidence, className }: { confidence: 'high' | 'low'; className?: string }) {
  if (confidence === 'high') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-caption font-mono bg-success-subtle text-success border border-success/30 select-none',
          className
        )}
      >
        <ShieldCheck className="w-3 h-3 text-success" />
        <span>High confidence (Blame matched)</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-caption font-mono bg-warning-subtle text-warning border border-warning/30 select-none',
        className
      )}
    >
      <AlertTriangle className="w-3 h-3 text-warning" />
      <span>Low confidence (Fallback commits)</span>
    </span>
  );
}

export function RegressionBadge({ isRegression, className }: { isRegression?: boolean; className?: string }) {
  if (!isRegression) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-caption font-mono font-semibold bg-accent-subtle text-accent border border-accent/30 select-none',
        className
      )}
    >
      Regression
    </span>
  );
}

export function RunStatusBadge({ status, className }: { status: any; className?: string }) {
  // Gracefully handles Server B dual-gate and legacy run statuses
  if (status === 'staged_raw') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-amber-500/10 text-amber-500 border border-amber-500/30 font-semibold',
          className
        )}
      >
        <Clock className="w-3 h-3 text-amber-500 animate-pulse" />
        <span>Stage 1: Gate 1 Raw</span>
      </span>
    );
  }
  if (status === 'staged_draft' || status === 'pending_approval' || status === 'draft_ready') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-purple-500/15 text-purple-400 border border-purple-500/40 font-semibold',
          className
        )}
      >
        <FileEdit className="w-3 h-3 text-purple-400" />
        <span>Stage 2: Gate 2 Draft</span>
      </span>
    );
  }
  if (status === 'dismissed') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-surface text-text-muted border border-border-subtle',
          className
        )}
      >
        <Slash className="w-3 h-3 text-text-muted" />
        <span>Gate 1 Dismissed (0 Tokens)</span>
      </span>
    );
  }
  if (status === 'approved' || status === 'published') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-success-subtle text-success border border-success/30 font-medium',
          className
        )}
      >
        <CheckCircle2 className="w-3 h-3 text-success" />
        <span>Published</span>
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-surface text-text-muted border border-border-subtle',
          className
        )}
      >
        <XCircle className="w-3 h-3 text-text-muted" />
        <span>Draft Discarded</span>
      </span>
    );
  }
  if (status === 'investigating' || status === 'parsing' || status === 'blaming' || status === 'explaining') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-info-subtle text-info border border-info/30 animate-pulse',
          className
        )}
      >
        <RotateCw className="w-3 h-3 text-info animate-spin" />
        <span>Investigating</span>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-caption font-medium font-mono select-none bg-danger-subtle text-danger border border-danger/30 font-medium',
          className
        )}
      >
        <AlertCircle className="w-3 h-3 text-danger" />
        <span>Pipeline Error</span>
      </span>
    );
  }
  return <StatusBadge status={status} className={className} />;
}

