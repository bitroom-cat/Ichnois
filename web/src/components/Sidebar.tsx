'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  Globe,
  Activity,
  Settings,
  ShieldCheck,
  Layers,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  CheckCircle2,
  FolderKanban,
  GitPullRequest,
  ArrowLeft,
  Terminal,
} from 'lucide-react';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  serviceName?: string;
  environment?: string;
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentWorkspace, isGlobal, activeProject, projects, metrics, selectWorkspace } = useWorkspace();

  const isCurrent = (path: string) => {
    if (path.includes('?')) {
      const basePath = path.split('?')[0];
      return pathname === basePath;
    }
    if (path === '/app/runs') {
      return pathname === '/app/runs';
    }
    return pathname.startsWith(path);
  };

  const globalNavMain = [
    {
      href: '/app/overview',
      label: 'Fleet Overview',
      shortLabel: 'Overview',
      icon: <Globe className="w-4 h-4 shrink-0" />,
      badge: 'HQ',
    },
    {
      href: '/app/runs',
      label: 'Fleet Incidents',
      shortLabel: 'Incidents',
      icon: <Activity className="w-4 h-4 shrink-0" />,
      badge: metrics?.total_runs ? `${metrics.total_runs}` : 'Live',
    },
    {
      href: '/app/projects',
      label: 'Microservices',
      shortLabel: 'Services',
      icon: <Layers className="w-4 h-4 shrink-0" />,
      badge: `${projects.length}`,
    },
    {
      href: '/app/settings',
      label: 'Platform Settings',
      shortLabel: 'Settings',
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  const projectNavMain = [
    {
      href: `/app/projects/${currentWorkspace}`,
      label: 'Service Hub',
      shortLabel: 'Hub',
      icon: <FolderKanban className="w-4 h-4 shrink-0" />,
      badge: 'Active',
    },
    {
      href: `/app/runs?project=${currentWorkspace}`,
      label: 'Incidents Queue',
      shortLabel: 'Incidents',
      icon: <Flame className="w-4 h-4 shrink-0" />,
      badge: metrics?.staged_raw_count ? `${metrics.staged_raw_count} new` : undefined,
    },
    {
      href: '/app/projects',
      label: 'All Microservices',
      shortLabel: 'Fleet',
      icon: <Layers className="w-4 h-4 shrink-0" />,
    },
    {
      href: `/app/settings?project=${currentWorkspace}`,
      label: 'Service Settings',
      shortLabel: 'Settings',
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  const navSectionMain = isGlobal ? globalNavMain : projectNavMain;

  const globalNavMonitor = [
    {
      href: '/app/runs',
      label: 'Dual-Gate Triage',
      shortLabel: 'Triage',
      icon: <Flame className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/connections',
      label: 'Service Health',
      shortLabel: 'Health',
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    },
  ];

  const projectNavMonitor = [
    {
      href: `/app/runs?project=${currentWorkspace}&status=staged_raw`,
      label: 'Gate 1: Raw Queue',
      shortLabel: 'Gate 1',
      icon: <Flame className="w-4 h-4 shrink-0" />,
    },
    {
      href: `/app/runs?project=${currentWorkspace}&status=staged_draft`,
      label: 'Gate 2: Drafts',
      shortLabel: 'Gate 2',
      icon: <GitPullRequest className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/connections',
      label: 'System Health',
      shortLabel: 'Health',
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    },
  ];

  const navSectionMonitor = isGlobal ? globalNavMonitor : projectNavMonitor;

  return (
    <aside
      className={`relative flex flex-col border-r border-border-subtle bg-surface/50 backdrop-blur-sm transition-all duration-200 select-none ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Workspace Context Header */}
      <div className="p-3 border-b border-border-subtle">
        {!collapsed ? (
          <div>
            {!isGlobal ? (
              <button
                type="button"
                onClick={() => {
                  selectWorkspace('global');
                  router.push('/app/overview');
                }}
                className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-purple-600 dark:hover:text-purple-400 transition-colors mb-2 font-medium group"
              >
                <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                <span>Switch to Fleet</span>
              </button>
            ) : (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                Global Workspace
              </div>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                isGlobal
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                  : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
              }`}>
                {isGlobal ? <Globe className="w-4 h-4" /> : <FolderKanban className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs text-text-primary truncate">
                  {isGlobal ? 'Fleet Operations' : activeProject?.name || currentWorkspace}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-text-muted font-mono truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="truncate">{isGlobal ? `${projects.length} microservices` : (activeProject?.environment || 'production')}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <div className="w-8 h-8 rounded-lg bg-canvas border border-border-subtle flex items-center justify-center">
              {isGlobal ? (
                <Globe className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              ) : (
                <FolderKanban className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {/* Main Section */}
        <div className="space-y-0.5">
          {navSectionMain.map((item) => {
            const active = isCurrent(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-hover'
                }`}
                title={collapsed ? item.label : undefined}
              >
                {item.icon}
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </div>

        {/* Monitor Section */}
        <div className="space-y-0.5">
          {!collapsed && (
            <div className="px-2.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              {isGlobal ? 'Fleet Monitor' : 'Service Monitor'}
            </div>
          )}
          {navSectionMonitor.map((item) => {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
                title={collapsed ? item.label : undefined}
              >
                {item.icon}
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Footer Info & Collapse Toggle */}
      <div className="p-2 border-t border-border-subtle space-y-1 text-xs">
        {!collapsed && (
          <>
            <Link
              href="/app/connections"
              className="flex items-center justify-between px-2.5 py-1.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            >
              <span className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>All systems normal</span>
              </span>
            </Link>
            <a
              href="https://github.com/bitroom-cat/Ichnoscope-WCC-30"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-2.5 py-1.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            >
              <span className="flex items-center gap-2 text-xs">
                <Terminal className="w-3.5 h-3.5" />
                <span>v2.1 Architecture</span>
              </span>
              <ExternalLink className="w-3 h-3 text-text-muted" />
            </a>
          </>
        )}

        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors text-xs"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center gap-1.5">
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
