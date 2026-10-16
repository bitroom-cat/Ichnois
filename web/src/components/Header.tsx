'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@/lib/theme';
import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ProjectSwitcher } from '@/components/ProjectSwitcher';
import { BreadcrumbNav } from '@/components/BreadcrumbNav';
import {
  Search,
  Plus,
  Moon,
  Sun,
  Sparkles,
  Play,
  RotateCcw,
  X,
  HelpCircle,
  FolderKanban,
  Globe,
  Layers,
  Activity,
  ArrowRight,
  Shield,
} from 'lucide-react';

interface HeaderProps {
  currentTitle?: string;
  onOpenSearch?: () => void;
}

export function Header({ onOpenSearch }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { activeWorkspace, projects, selectWorkspace } = useWorkspace();

  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Built-in Search Command Palette State
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Global keyboard shortcut for Search (^K / Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (onOpenSearch) {
          onOpenSearch();
        } else {
          setSearchModalOpen((prev) => !prev);
        }
      }
      if (e.key === 'Escape') {
        setSearchModalOpen(false);
        setUserMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenSearch]);

  // Focus input when search opens
  useEffect(() => {
    if (searchModalOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [searchModalOpen]);

  const handleSearchClick = () => {
    if (onOpenSearch) {
      onOpenSearch();
    } else {
      setSearchModalOpen(true);
    }
  };

  const triggerReplay = async (fixture: 'payment_npe' | 'auth_jwt' | 'db_leak') => {
    setReplaying(true);
    try {
      const projId = activeWorkspace && activeWorkspace !== 'global' ? activeWorkspace : undefined;
      const newRun = await api.replaySavedFixture(fixture, projId);
      setReplayModalOpen(false);
      router.push(`/app/runs/${newRun.id}`);
    } finally {
      setReplaying(false);
    }
  };

  // Filtered search results
  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.project_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const quickNavItems = [
    { label: 'Fleet Overview', href: '/app/overview', icon: <Globe className="w-3.5 h-3.5 text-indigo-500" /> },
    { label: 'Fleet Incidents', href: '/app/runs', icon: <Activity className="w-3.5 h-3.5 text-purple-500" /> },
    { label: 'All Microservices', href: '/app/projects', icon: <Layers className="w-3.5 h-3.5 text-purple-500" /> },
    { label: 'Platform Settings', href: '/app/settings', icon: <Shield className="w-3.5 h-3.5 text-text-muted" /> },
  ].filter((item) => item.label.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      <header className="sticky top-0 z-40 w-full h-12 border-b border-border-subtle bg-surface/80 backdrop-blur-md flex items-center justify-between px-3 sm:px-4 text-xs select-none gap-3">
        {/* Left Side: Brand Logo, Workspace Switcher & Dynamic Breadcrumbs */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
          {/* Logo Mark */}
          <Link
            href="/app/overview"
            className="flex items-center gap-1.5 shrink-0 group"
            title="Ichnoscope SRE Autonomous Triage"
          >
            <div className="w-6 h-6 rounded bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-xs group-hover:bg-purple-700 transition-colors">
              I
            </div>
          </Link>

          {/* Project Switcher Dropdown */}
          <div className="shrink-0">
            <ProjectSwitcher />
          </div>

          <span className="text-text-muted/40 font-mono text-xs select-none shrink-0" aria-hidden="true">
            /
          </span>

          {/* Dynamic Contextual Breadcrumb Navigation */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <BreadcrumbNav />
          </div>
        </div>

        {/* Right Side: Global Search, + Incidents Quick Action, Theme, Avatar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Global Search Bar Trigger */}
          <button
            onClick={handleSearchClick}
            type="button"
            className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-subtle bg-canvas text-text-muted hover:text-text-primary hover:border-border-strong text-xs transition-colors shadow-2xs group"
            title="Quick search across incidents and projects (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-text-muted group-hover:text-text-primary transition-colors" />
            <span className="font-medium text-text-secondary">Search</span>
            <kbd className="text-[10px] bg-surface-raised px-1 py-0.5 rounded border border-border-subtle font-mono text-text-muted">
              ^K
            </kbd>
          </button>

          {/* + Incidents Quick Action Button */}
          <button
            onClick={() => setReplayModalOpen(true)}
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-xs transition-all active:scale-95 shrink-0"
            title="Simulate or inject Sentry error webhook"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Incidents</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            type="button"
            className="p-1.5 rounded-md hover:bg-hover text-text-secondary hover:text-text-primary transition-colors shrink-0"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4 text-purple-600" />}
          </button>

          {/* Help & Docs Link */}
          <a
            href="https://github.com/bitroom-cat/Ichnoscope-WCC-30"
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-md hover:bg-hover text-text-secondary hover:text-text-primary transition-colors hidden sm:block shrink-0"
            title="Help & documentation"
          >
            <HelpCircle className="w-4 h-4" />
          </a>

          {/* User Avatar */}
          <div className="relative shrink-0">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              type="button"
              className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center justify-center font-bold text-xs hover:ring-2 hover:ring-purple-500/20 transition-all uppercase"
              title={user?.email || 'User Account'}
            >
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-lg bg-surface border border-border-subtle shadow-popover py-1 z-50 animate-in fade-in slide-in-from-top-1 text-xs">
                <div className="px-3 py-2 border-b border-border-subtle font-medium">
                  <div className="text-text-primary truncate">
                    {user?.user_metadata?.full_name ||
                      user?.user_metadata?.user_name ||
                      user?.email?.split('@')[0] ||
                      'Authenticated User'}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {user?.email || 'Logged in'}
                  </div>
                </div>
                <Link
                  href="/app/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-3 py-1.5 text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
                >
                  Workspace Settings
                </Link>
                <Link
                  href="/app/connections"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-3 py-1.5 text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
                >
                  Service Integrations
                </Link>
                <div className="border-t border-border-subtle my-1" />
                <button
                  type="button"
                  onClick={async () => {
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    setUserMenuOpen(false);
                    router.push('/login');
                  }}
                  className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors font-medium"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Search Command Palette Modal */}
      {searchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="bg-surface border border-border-strong rounded-xl shadow-2xl max-w-lg w-full overflow-hidden text-xs">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
              <Search className="w-4 h-4 text-purple-600 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search incidents, microservices, or jump to views..."
                className="w-full bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-xs font-sans"
              />
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-3">
              {/* Quick Pages */}
              {quickNavItems.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Quick Navigation
                  </div>
                  <div className="space-y-0.5">
                    {quickNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setSearchModalOpen(false)}
                        className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-hover text-text-primary transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          {item.icon}
                          <span className="font-medium">{item.label}</span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-text-muted group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Microservices */}
              {filteredProjects.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Microservices Fleet
                  </div>
                  <div className="space-y-0.5">
                    {filteredProjects.map((p) => (
                      <div
                        key={p.project_id}
                        onClick={() => {
                          selectWorkspace(p.project_id);
                          setSearchModalOpen(false);
                          router.push(`/app/projects/${p.project_id}`);
                        }}
                        className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-hover text-text-primary transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FolderKanban className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                          <div className="truncate">
                            <span className="font-semibold">{p.name}</span>
                            <span className="text-[10px] text-text-muted font-mono ml-2">
                              {p.project_id}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider bg-surface-sunken text-text-muted border border-border-subtle shrink-0">
                          {p.environment}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {quickNavItems.length === 0 && filteredProjects.length === 0 && (
                <div className="py-8 text-center text-text-muted space-y-1">
                  <p className="text-xs font-medium">No results found for &quot;{searchQuery}&quot;</p>
                  <p className="text-[11px] text-text-muted">Try searching for a project name or incident ID.</p>
                </div>
              )}
            </div>

            <div className="px-3 py-2 border-t border-border-subtle bg-surface-raised/40 flex items-center justify-between text-[11px] text-text-muted">
              <span>Press <kbd className="px-1 py-0.5 rounded bg-surface border border-border-subtle font-mono text-[10px]">Esc</kbd> to close</span>
              <span>Navigate with arrow keys</span>
            </div>
          </div>
        </div>
      )}

      {/* Sentry Webhook Simulation Modal */}
      {replayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-surface border border-border-subtle rounded-xl shadow-popover max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <h3 className="font-semibold text-sm text-text-primary">
                  Inject Sentry Error Payload
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReplayModalOpen(false)}
                className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              Select a production crash fixture to simulate a live Sentry webhook. Ichnoscope will
              stage the event, correlate git blame, trigger LLM reasoning, and draft a GitHub issue.
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => triggerReplay('payment_npe')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold text-xs text-text-primary group-hover:text-purple-600 transition-colors">
                    KeyError: &apos;stripe_token&apos;
                  </div>
                  <div className="text-[11px] text-text-muted font-mono mt-0.5">
                    services/payment.py:84 • P1-Critical
                  </div>
                </div>
                <Play className="w-3.5 h-3.5 text-text-muted group-hover:text-purple-600" />
              </button>

              <button
                type="button"
                onClick={() => triggerReplay('auth_jwt')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold text-xs text-text-primary group-hover:text-purple-600 transition-colors">
                    JWTExpiredError: Token lifetime exceeded
                  </div>
                  <div className="text-[11px] text-text-muted font-mono mt-0.5">
                    middleware/auth.py:42 • P2-High
                  </div>
                </div>
                <Play className="w-3.5 h-3.5 text-text-muted group-hover:text-purple-600" />
              </button>

              <button
                type="button"
                onClick={() => triggerReplay('db_leak')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold text-xs text-text-primary group-hover:text-purple-600 transition-colors">
                    PoolTimeout: Connection pool exhausted
                  </div>
                  <div className="text-[11px] text-text-muted font-mono mt-0.5">
                    db/session.py:118 • P1-Critical
                  </div>
                </div>
                <Play className="w-3.5 h-3.5 text-text-muted group-hover:text-purple-600" />
              </button>
            </div>

            {replaying && (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-purple-600 font-medium animate-pulse">
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>Running automated triage pipeline...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
