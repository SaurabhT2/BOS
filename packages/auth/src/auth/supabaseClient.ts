// ============================================================
// @brandos/auth — src/auth/supabaseClient.ts
//
// SUPABASE CLIENT SINGLETON
//
// ARCHITECTURAL ROLE:
//   This is the single point of Supabase client initialization for the
//   entire @brandos/auth package. No other file in this package should
//   import from @supabase/ssr or @supabase/supabase-js directly to
//   construct a client — always use the functions exported here.
//
// TWO CLIENTS, TWO PURPOSES:
//
//   1. getSupabaseClient() → browser singleton via createBrowserClient
//      - Stores auth tokens in cookies (not localStorage)
//      - Why cookies? Next.js server route handlers can read cookies but
//        NOT localStorage. Using createBrowserClient ensures that when the
//        user is authenticated in the browser, the session is also visible
//        to server-side handlers without any extra work.
//      - Root cause of the pre-SSR 401 bug: bare createClient() used
//        localStorage; createServerClient() read cookies — they never synced.
//        createBrowserClient fixes this permanently.
//
//   2. getSupabaseAdmin() → server-only admin client
//      - Uses the service role key → BYPASSES Row Level Security.
//      - Never import this in React components or client-side code.
//      - Creates a fresh client each call (stateless, no session needed).
//
// AGENT GUIDANCE:
//   - Never add a third client type here. If you need SSR-specific cookie
//     handling (e.g. middleware), use @supabase/ssr createServerClient
//     directly in that file — don't generalise it here.
//   - The `supabase` lazy proxy is the idiomatic import for React components
//     and services that run in the browser. It defers initialization until
//     the first property access, preventing build-time throws when env vars
//     are evaluated during Next.js compilation.
// ============================================================

import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authConfig } from '../config';

// ── Browser client singleton ──────────────────────────────────
// Lazily initialized on first call to getSupabaseClient().
// Shared across all modules that import `supabase` from this file.
let _client: SupabaseClient | null = null;

/**
 * Returns the singleton browser-side Supabase client.
 *
 * Uses createBrowserClient from @supabase/ssr which:
 *   - Writes auth tokens to cookies (readable by Next.js route handlers)
 *   - Handles automatic token refresh when the JWT nears expiry
 *   - Syncs auth state across browser tabs via storage events
 *
 * THROWS on missing environment variables — this is intentional.
 * Silent failure here would cause cryptic 401s or undefined behaviour.
 *
 * PERFORMANCE: The Proxy wrapper on `supabase` below defers this call
 * until the first auth operation, avoiding throws during Next.js build.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  if (!authConfig.supabase.url || !authConfig.supabase.anonKey) {
    throw new Error(
      '[brandos-auth] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Check your .env.local file and ensure these are set before starting the dev server.'
    );
  }

  _client = createBrowserClient(
    authConfig.supabase.url,
    authConfig.supabase.anonKey
  );

  return _client;
}

/**
 * Lazy-initialized browser client proxy.
 *
 * Use this in React components, hooks, and client-side service modules.
 * The Proxy wrapper defers initialization until the first property access,
 * so this can be safely imported at module load time even if env vars
 * are not available yet (e.g., during Next.js build-time static analysis).
 *
 * EDGE CASE: If you access `supabase.auth` at the top level of a module
 * (outside a function) during SSR, it will throw. Always access inside
 * async functions or event handlers.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    // Defer initialization to first property access
    return getSupabaseClient()[prop as keyof SupabaseClient];
  },
});

/**
 * Returns a server-side Supabase admin client.
 *
 * SECURITY WARNING:
 *   This client uses the service role key which bypasses ALL Row Level Security
 *   policies. It can read and write any data in your Supabase project.
 *   Only import this function in:
 *     - Next.js Route Handlers (app/api/**.ts)
 *     - Server Actions
 *     - Background workers / cron jobs
 *   NEVER pass this client (or the key) to the browser.
 *
 * STATELESS: Creates a new client on each call (no session persistence).
 * persistSession: false prevents the client from trying to read/write cookies.
 * autoRefreshToken: false prevents background timer setup (unnecessary server-side).
 *
 * THROWS if SUPABASE_SERVICE_ROLE_KEY is missing — fail loud, not silent.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!authConfig.supabase.serviceRoleKey) {
    throw new Error(
      '[brandos-auth] Missing SUPABASE_SERVICE_ROLE_KEY. ' +
      'This client is for server-side use only. ' +
      'Never set NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY — use server-only env vars.'
    );
  }

  return createClient(
    authConfig.supabase.url,
    authConfig.supabase.serviceRoleKey,
    {
      auth: {
        persistSession:  false,  // No cookie/localStorage writes server-side
        autoRefreshToken: false, // No background refresh timers
      },
    }
  );
}


