// Purpose: Protect /app dashboard routes and handle authentication flow using Supabase.
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // If an OAuth code arrives on any page (e.g. Supabase default Site URL fallback to "/"),
  // immediately forward it to /auth/callback so it gets exchanged for session cookies
  if (searchParams.has('code')) {
    const callbackUrl = new URL('/auth/callback', request.url);
    searchParams.forEach((val, key) => {
      callbackUrl.searchParams.set(key, val);
    });
    if (!callbackUrl.searchParams.has('next')) {
      callbackUrl.searchParams.set('next', '/app/runs');
    }
    return NextResponse.redirect(callbackUrl);
  }

  const { user, supabaseResponse } = await updateSession(request);

  // If already authenticated and visiting /login, redirect to /app
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  // Protect /app routes - require active Supabase user session
  if (pathname.startsWith('/app')) {
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|auth).*)'],
};
