import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;

  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app/runs';
  const error = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');

  // Determine production origin accurately (supporting Vercel forwarded headers)
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin);

  // If Supabase returned an OAuth provider error
  if (error || errorDesc) {
    const errorParam = encodeURIComponent(errorDesc || error || 'auth_failed');
    return NextResponse.redirect(`${origin}/login?error=${errorParam}`);
  }

  if (code) {
    const supabase = createServerSupabaseClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${next}`);
    } else {
      console.error('[auth/callback] exchangeCodeForSession failed:', exchangeError);
      const msg = encodeURIComponent(exchangeError.message || 'auth_failed');
      return NextResponse.redirect(`${origin}/login?error=${msg}`);
    }
  }

  // Fallback: Auth failed or missing code
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
