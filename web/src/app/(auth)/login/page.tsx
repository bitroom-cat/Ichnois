'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/primitives/Button';
import { Lock, Mail, ArrowRight, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';

function GithubIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/app/runs';
  const urlError = searchParams.get('error');
  const urlErrorDesc = searchParams.get('error_description');

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    if (urlErrorDesc) {
      setError(decodeURIComponent(urlErrorDesc.replace(/\+/g, ' ')));
    } else if (urlError === 'auth_failed') {
      setError('OAuth authentication failed or was cancelled. Please try again.');
    } else if (urlError) {
      setError(decodeURIComponent(urlError.replace(/\+/g, ' ')));
    }
  }, [urlError, urlErrorDesc]);

  const getSiteUrl = () => {
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }
    return 'https://ichnoscope-wcc-30.vercel.app';
  };

  const supabase = createClient();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message);
          setLoading(false);
          return;
        }

        router.push(nextUrl);
        router.refresh();
      } else if (mode === 'signup') {
        const { error: signUpError, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
          },
        });

        if (signUpError) {
          setError(signUpError.message);
          setLoading(false);
          return;
        }

        if (data.session) {
          router.push(nextUrl);
          router.refresh();
        } else {
          setMessage('Account created! Please check your email inbox to verify your account.');
          setLoading(false);
        }
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${getSiteUrl()}/auth/callback?next=/app/settings`,
        });

        if (resetError) {
          setError(resetError.message);
        } else {
          setMessage('Password reset link sent! Check your email inbox.');
        }
        setLoading(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setError(null);
    setMessage(null);
    setOauthLoading(true);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setOauthLoading(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OAuth request failed');
      setOauthLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface p-6 sm:p-7 shadow-xs space-y-5 transition-colors">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Logo size="lg" showWordmark={false} />
          </div>
          <h1 className="text-title-3 font-semibold text-primary">
            {mode === 'forgot'
              ? 'Reset your password'
              : mode === 'signup'
              ? 'Create your account'
              : 'Sign in to the dashboard'}
          </h1>
          <p className="text-caption text-secondary">
            {mode === 'forgot'
              ? 'We will send a secure reset link to your email.'
              : mode === 'signup'
              ? 'Join your engineering team to monitor & triage incidents.'
              : 'Sign in to review and approve incident triage runs.'}
          </p>
        </div>

        {/* Auth Mode Toggle Tabs (when not in forgot password) */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 p-1 bg-canvas border border-border-subtle rounded-md text-caption font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setMessage(null);
              }}
              className={`py-1.5 rounded transition-all text-center ${
                mode === 'signin'
                  ? 'bg-surface text-primary shadow-xs font-semibold'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setMessage(null);
              }}
              className={`py-1.5 rounded transition-all text-center ${
                mode === 'signup'
                  ? 'bg-surface text-primary shadow-xs font-semibold'
                  : 'text-text-muted hover:text-primary'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* GitHub OAuth Button */}
        {mode !== 'forgot' && (
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={oauthLoading || loading}
              onClick={handleGithubSignIn}
              className="w-full justify-center gap-2.5 border border-border-subtle bg-canvas hover:bg-surface-hover text-primary font-medium py-2"
            >
              <GithubIcon className="w-4 h-4 flex-shrink-0" />
              <span>{oauthLoading ? 'Connecting to GitHub...' : 'Continue with GitHub'}</span>
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-subtle" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-surface px-2 text-text-muted font-medium">or continue with email</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-danger-subtle border border-danger/30 text-danger text-caption">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-danger" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {message && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-success-subtle border border-success/30 text-success text-caption">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-success" />
            <span className="leading-snug">{message}</span>
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label className="block text-caption font-medium text-secondary mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-9 pr-3 py-2 bg-canvas border border-border-subtle rounded-md text-dense text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-caption font-medium text-secondary">
                  Password
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setMessage(null);
                    }}
                    className="text-caption text-accent hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Choose a strong password (6+ chars)' : 'Enter password...'}
                  className="w-full pl-9 pr-3 py-2 bg-canvas border border-border-subtle rounded-md text-dense text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={loading || oauthLoading}
            className="w-full justify-center gap-2"
          >
            <span>
              {loading
                ? mode === 'forgot'
                  ? 'Sending link...'
                  : mode === 'signup'
                  ? 'Creating account...'
                  : 'Authenticating...'
                : mode === 'forgot'
                ? 'Send reset link'
                : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>

          {mode === 'forgot' && (
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setMessage(null);
              }}
              className="w-full text-center text-caption text-text-muted hover:text-primary pt-1"
            >
              ← Back to Sign In
            </button>
          )}
        </form>

        <div className="pt-3 border-t border-border-subtle text-caption text-text-muted space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-secondary">
            <ShieldCheck className="w-3.5 h-3.5 text-accent" />
            <span>Enterprise Security & Access</span>
          </div>
          <p className="leading-relaxed">
            Authenticated via Supabase Auth with PKCE and JWT session management. Project tokens and sensitive credentials remain secure on Server B.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[75vh] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface p-6 sm:p-7 shadow-xs text-center space-y-3">
            <div className="text-caption text-text-muted">Loading authentication...</div>
          </div>
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
