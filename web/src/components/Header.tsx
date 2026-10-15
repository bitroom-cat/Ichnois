'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@/lib/theme';
import { api } from '@/lib/api';
import { ProjectSwitcher } from '@/components/ProjectSwitcher';
import {
  Search,
  Plus,
  Moon,
  Sun,
  ChevronDown,
  Layers,
  Sparkles,
  Play,
  RotateCcw,
  X,
  Radio,
  ExternalLink,
  HelpCircle,
} from 'lucide-react';

interface HeaderProps {
  currentTitle?: string;
  onOpenSearch?: () => void;
}

export function Header({ currentTitle, onOpenSearch }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Compute breadcrumb segments from pathname
  const pathParts = pathname.split('/').filter(Boolean);
  const isRunsList = pathname === '/app/runs';
  const isRunDetail = pathname.startsWith('/app/runs/') && pathParts.length >= 3;
  const runId = isRunDetail ? pathParts[2] : null;

  const triggerReplay = async (fixture: 'payment_npe' | 'auth_jwt' | 'db_leak') => {
    setReplaying(true);
    try {
      const newRun = await api.replaySavedFixture(fixture);
      setReplayModalOpen(false);
      router.push(`/app/runs/${newRun.id}`);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full h-12 border-b border-border-subtle bg-surface/80 backdrop-blur-md flex items-center justify-between px-3 sm:px-4 text-xs select-none">
        {/* Left Side: Brand Logo, Workspace Switcher & Breadcrumbs */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Logo Mark */}
          <Link href="/app/runs" className="flex items-center gap-1.5 shrink-0 group">
            <div className="w-6 h-6 rounded bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-xs group-hover:bg-purple-700 transition-colors">
              I
            </div>
          </Link>

          {/* Project Switcher */}
          <ProjectSwitcher />

          <span className="text-text-muted hidden sm:inline">/</span>

          {/* Breadcrumb Path */}
          <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1.5 text-text-secondary min-w-0">
            <span className="flex items-center gap-1 text-text-muted">
              <span>Production</span>
            </span>
            <span className="text-text-muted">/</span>
            <Link
              href="/app/runs"
              className="text-text-secondary hover:text-text-primary transition-colors truncate max-w-[140px]"
            >
              automation-api
            </Link>

            {isRunsList && (
              <>
                <span className="text-text-muted">/</span>
                <span className="text-text-primary font-medium">Deploys & Incidents</span>
              </>
            )}

            {isRunDetail && (
              <>
                <span className="text-text-muted">/</span>
                <Link href="/app/runs" className="text-text-secondary hover:text-text-primary transition-colors">
                  Deploys
                </Link>
                <span className="text-text-muted">/</span>
                <span className="text-purple-600 dark:text-purple-400 font-mono font-medium truncate max-w-[120px]">
                  {runId}
                </span>
              </>
            )}

            {pathname === '/app/connections' && (
              <>
                <span className="text-text-muted">/</span>
                <span className="text-text-primary font-medium">Connections</span>
              </>
            )}

            {pathname === '/app/settings' && (
              <>
                <span className="text-text-muted">/</span>
                <span className="text-text-primary font-medium">Settings</span>
              </>
            )}
          </nav>
        </div>

        {/* Right Side: Quick Search, Replay CTA, Theme, Avatar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Search Trigger */}
          <button
            onClick={onOpenSearch}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md border border-border-subtle bg-canvas text-text-muted hover:text-text-primary hover:border-border-strong text-xs transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
            <kbd className="text-[10px] bg-surface px-1 py-0.5 rounded border border-border-subtle">
              ^K
            </kbd>
          </button>

          {/* Trigger Replay / New Incident Button */}
          <button
            onClick={() => setReplayModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Incident</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Help link */}
          <a
            href="https://github.com/bitroom-cat/Ichnoscope-WCC-30"
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-md hover:bg-hover text-text-secondary hover:text-text-primary transition-colors hidden sm:block"
            title="Help & documentation"
          >
            <HelpCircle className="w-4 h-4" />
          </a>

          {/* User Avatar */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center justify-center font-bold text-xs hover:ring-2 hover:ring-purple-500/20 transition-all"
            >
              F
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-lg bg-surface border border-border-subtle shadow-popover py-1 z-50 animate-in fade-in slide-in-from-top-1 text-xs">
                <div className="px-3 py-2 border-b border-border-subtle font-medium">
                  <div className="text-text-primary">SRE Operator</div>
                  <div className="text-[11px] text-text-muted">admin@ichnoscope.local</div>
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
                  onClick={() => {
                    api.logout();
                    setUserMenuOpen(false);
                    router.push('/login');
                  }}
                  className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Replay Modal */}
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
                onClick={() => setReplayModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Select a production crash fixture to simulate a live Sentry webhook. Ichnoscope will
              correlate git blame, query LLM reasoning, and prepare an issue draft.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => triggerReplay('payment_npe')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group"
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
                onClick={() => triggerReplay('auth_jwt')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group"
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
                onClick={() => triggerReplay('db_leak')}
                disabled={replaying}
                className="w-full text-left p-3 rounded-lg border border-border-subtle hover:border-purple-500/50 hover:bg-hover transition-all flex items-center justify-between group"
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
