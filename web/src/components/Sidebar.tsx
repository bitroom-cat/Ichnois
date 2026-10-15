'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Globe,
  Activity,
  Settings,
  Radio,
  Terminal,
  ShieldCheck,
  Layers,
  Key,
  PlayCircle,
  FileText,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  CheckCircle2,
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
  serviceName = 'automation-api',
  environment = 'production',
}: SidebarProps) {
  const pathname = usePathname();

  const isCurrent = (path: string) => {
    if (path === '/app/runs') {
      return pathname.startsWith('/app/runs');
    }
    return pathname.startsWith(path);
  };

  const navSectionMain = [
    {
      href: '/app/runs',
      label: 'Deploys & Incidents',
      shortLabel: 'Deploys',
      icon: <Activity className="w-4 h-4 shrink-0" />,
      badge: 'Live',
    },
    {
      href: '/app/projects',
      label: 'Projects & DSNs',
      shortLabel: 'Projects',
      icon: <Layers className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/settings',
      label: 'Settings',
      shortLabel: 'Settings',
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  const navSectionMonitor = [
    {
      href: '/app/runs',
      label: 'Events & Triage',
      shortLabel: 'Events',
      icon: <Flame className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/runs',
      label: 'Logs Console',
      shortLabel: 'Logs',
      icon: <Terminal className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/connections',
      label: 'Service Health',
      shortLabel: 'Health',
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    },
  ];

  const navSectionManage = [
    {
      href: '/app/connections',
      label: 'Connections',
      shortLabel: 'Connect',
      icon: <Layers className="w-4 h-4 shrink-0" />,
    },
    {
      href: '/app/settings',
      label: 'Environment & Secrets',
      shortLabel: 'Env',
      icon: <Key className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <aside
      className={`relative flex flex-col border-r border-border-subtle bg-surface/50 backdrop-blur-sm transition-all duration-200 select-none ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Service Context Header */}
      <div className="p-3 border-b border-border-subtle">
        {!collapsed ? (
          <div>
            <Link
              href="/app/runs"
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-1.5"
            >
              <span>← Environment</span>
            </Link>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-canvas border border-border-subtle flex items-center justify-center text-text-primary shrink-0">
                  <Globe className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-text-primary truncate">
                    {serviceName}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>{environment}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <div className="w-8 h-8 rounded-md bg-canvas border border-border-subtle flex items-center justify-center">
              <Globe className="w-4 h-4 text-purple-600 dark:text-purple-400" />
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
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
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
              Monitor
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

        {/* Manage Section */}
        <div className="space-y-0.5">
          {!collapsed && (
            <div className="px-2.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Manage
            </div>
          )}
          {navSectionManage.map((item) => {
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
              <span className="flex items-center gap-2">
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
              <span className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Documentation</span>
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
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
