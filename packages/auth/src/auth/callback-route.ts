// ============================================================
// @brandos/auth — src/auth/callback-route.ts
//
// OAUTH CALLBACK ROUTE HANDLER
//
// HOW TO USE:
//   Copy this file to your Next.js app at:
//     app/auth/callback/route.ts
//
//   Or import the GET handler directly:
//     export { GET } from '@brandos/auth/callback-route';
//     (requires 'callback-route' to be exported from index.ts)
//
// PURPOSE:
//   Handles the OAuth redirect from Supabase after:
//     1. Google sign-in (code exchange)
//     2. Email confirmation click (PKCE flow)
//     3. Magic link click (PKCE flow)
//
// FLOW:
//   1. Supabase redirects to /auth/callback?code=<code>[&next=<path>]
//   2. This handler exchanges the code for a session (PKCE)
//   3. Redirects to `next` (if safe) or to authConfig.redirects.afterLogin
//
// SECURITY NOTES:
//   - The `next` parameter is validated to be a relative path only.
//     An attacker cannot redirect to an external URL (open redirect prevention).
//   - We use @supabase/ssr createServerClient here (NOT the browser singleton)
//     because this runs in a Next.js Route Handler — a server context.
//     The browser client singleton (createBrowserClient) is not available here.
//
// AGENT GUIDANCE:
//   This file imports from 'next/server' which couples it to Next.js.
//   This is intentional — it is a Next.js Route Handler by design.
//   Do NOT import this file in non-Next.js contexts.
//
//   If you need SSR session handling in middleware, use @supabase/ssr's
//   createServerClient directly in middleware.ts — do not reuse this handler.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { authConfig } from '../config';

/**
 * Validate that a redirect target is safe (relative path only).
 *
 * Prevents open redirect attacks where an attacker crafts a link like:
 *   /auth/callback?next=https://evil.com
 *
 * RULES:
 *   - Must be a non-empty string
 *   - Must start with '/' (relative path)
 *   - Must NOT start with '//' (protocol-relative URL — same as absolute)
 *   - Must NOT contain a protocol (http:, https:, javascript:)
 */
function isSafeRedirectPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(path)) return false;
  return true;
}

/**
 * Next.js Route Handler for the Supabase OAuth/PKCE callback.
 *
 * This handler MUST exist at /auth/callback in your Next.js app.
 * It is invoked by Supabase after every OAuth sign-in and email confirmation.
 *
 * EDGE CASE — no code in URL:
 *   If `code` is absent, the user may have navigated to /auth/callback directly.
 *   We redirect to afterLogin without exchanging a code.
 *
 * EDGE CASE — code exchange failure:
 *   If exchangeCodeForSession() fails (expired code, already used),
 *   Supabase returns an error. We redirect to afterLogin anyway — the user's
 *   session state will be determined by their next page load.
 *   TODO: Add error query param to afterLogin to show an "auth failed" toast.
 *
 * COOKIES:
 *   createServerClient requires a cookies() handler to write the session cookie.
 *   This is why we use createServerClient here — the browser singleton cannot
 *   write cookies in a server context.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl  = new URL(request.url);
  const code        = requestUrl.searchParams.get('code');
  const rawNext     = requestUrl.searchParams.get('next');
  const redirectTo  = (rawNext && isSafeRedirectPath(rawNext))
    ? rawNext
    : authConfig.redirects.afterLogin;

  if (code) {
    // Build a cookies adapter for Next.js Route Handlers.
    // createServerClient needs to read request cookies and write response cookies
    // to persist the new session.
    const cookieStore = request.cookies;

    // We build the response first so we can attach Set-Cookie headers to it.
    const response = NextResponse.redirect(new URL(redirectTo, authConfig.appUrl));

    const supabase = createServerClient(
      authConfig.supabase.url,
      authConfig.supabase.anonKey,
      {
        cookies: {
          // Read from the incoming request cookies
          getAll() {
            return cookieStore.getAll();
          },
          // Write new/updated cookies to the outgoing response
          // Write new/updated cookies to the outgoing response
setAll(
  cookiesToSet: Array<{
    name: string
    value: string
    options?: Record<string, unknown>
  }>
) {
  cookiesToSet.forEach(
    ({
      name,
      value,
      options
    }: {
      name: string
      value: string
      options?: Record<string, unknown>
    }) => {
      response.cookies.set(name, value, options)
    }
  )
},
        },
      }
    );

    // Exchange the authorization code for a session.
    // On success: Supabase writes the session JWT to cookies via setAll() above.
    // On failure: session remains null; user is redirected without a session.
    await supabase.auth.exchangeCodeForSession(code);

    return response;
  }

  // No code present — just redirect (e.g., direct navigation to /auth/callback)
  return NextResponse.redirect(new URL(redirectTo, authConfig.appUrl));
}


