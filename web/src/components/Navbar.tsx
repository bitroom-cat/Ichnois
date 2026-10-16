'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Logo } from '@/components/Logo';
import {
  Activity,
  Radio,
  Settings,
  Play,
  LogOut,
  Lock,
  Sun,
  Moon,
  X,
  Sparkles,
} from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    api.isAuthenticated().then(setIsAuth);
  }, [pathname]);

  const handleLogout = async () => {
    await api.logout();
    setIsAuth(false);
    router.push('/login');
  };

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

  const navLinks = [
    { href: '/app/runs', label: 'Incidents', icon: <Activity className="w-4 h-4" /> },
    { href: '/app/connections', label: 'Connections', icon: <Radio className="w-4 h-4" /> },
    { href: '/app/settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-subtle bg-canvas/80 backdrop-blur-md transition-colors">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Left: Brand & Navigation */}
        <div className="flex items-center gap-6">
          <Link href="/app/runs" className="flex items-center gap-2.5 group">
            <Logo size="md" showWordmark={true} />
            <span className="px-1.5 py-0.5 rounded-sm text-caption font-mono font-medium bg-surface text-secondary border border-border-subtle">
              App
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-dense font-medium transition-colors ${
                    active
                      ? 'bg-surface text-accent font-semibold border border-border-subtle'
                      : 'text-secondary hover:text-primary hover:bg-surface'
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Actions, Theme Switcher, Auth */}
        <div className="flex items-center gap-2.5">
          {/* Replay Simulation Button */}
          <button
            onClick={() => setReplayModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-subtle hover:bg-accent/20 text-accent text-dense font-medium border border-accent/30 transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-accent text-accent" />
            <span className="hidden sm:inline">Simulate Incident</span>
            <span className="sm:hidden">Simulate</span>
          </button>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-md text-text-muted hover:text-primary hover:bg-surface transition-colors border border-transparent hover:border-border-subtle"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4 text-secondary" />}
          </button>

          {/* Auth button */}
          {isAuth ? (
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-dense font-medium text-text-muted hover:text-danger hover:bg-surface transition-colors"
              title="Sign out of admin session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-dense font-medium text-secondary hover:text-primary hover:bg-surface transition-colors"
            >
              <Lock className="w-3.5 h-3.5 text-text-muted" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
        </div>
      </div>

      {/* Sentry Replay Simulation Modal */}
      {replayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-surface border border-border-subtle p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-primary text-body">
                  Simulate Incoming Sentry Webhook
                </h3>
              </div>
              <button
                onClick={() => setReplayModalOpen(false)}
                className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-canvas transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-dense text-secondary leading-relaxed">
              Trigger a real pipeline replay from saved fixtures. The system computes deterministic release-SHA blame, generates an LLM hypothesis, and stages a draft issue for human approval:
            </p>

            <div className="space-y-2.5">
              <button
                disabled={replaying}
                onClick={() => triggerReplay('auth_jwt')}
                className="w-full text-left p-3.5 rounded-lg border border-border-subtle bg-canvas hover:border-accent hover:bg-surface transition-all group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dense font-semibold text-primary group-hover:text-accent">
                    KeyError: &apos;jwt_refresh_token&apos; in auth/jwt_handler.py:215
                  </span>
                  <span className="text-caption px-2 py-0.5 rounded-sm font-mono font-medium bg-danger-subtle text-danger border border-danger/30">
                    P1-Critical
                  </span>
                </div>
                <p className="text-caption text-text-muted mt-1">
                  Regression on closed issue GH-151. 114 duplicate events deduplicated. Blames @devin-m via PR-151.
                </p>
              </button>

              <button
                disabled={replaying}
                onClick={() => triggerReplay('db_leak')}
                className="w-full text-left p-3.5 rounded-lg border border-border-subtle bg-canvas hover:border-accent hover:bg-surface transition-all group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-dense font-semibold text-primary group-hover:text-accent">
                    OperationalError: EOF in infra/database_connector.py:112
                  </span>
                  <span className="text-caption px-2 py-0.5 rounded-sm font-mono font-medium bg-warning-subtle text-warning border border-warning/30">
                    P2-High
                  </span>
                </div>
                <p className="text-caption text-text-muted mt-1">
                  TCP keepalive timeout mismatch causing connection drops. Blames commit b819f09 by @j-tucker.
                </p>
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-border-subtle">
              <button
                onClick={() => setReplayModalOpen(false)}
                className="px-3.5 py-1.5 rounded-md text-dense font-medium text-secondary hover:bg-canvas transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
