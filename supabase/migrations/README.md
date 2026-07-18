# supabase/migrations

This directory did not exist in this repository before the Cognitive
Platform Evolution Program. BrandOS's Supabase schema has, up to this
point, been managed entirely out-of-band (dashboard/CLI changes applied
directly against the project, with no SQL checked into this codebase) —
there was no existing migration convention here to follow.

Files in this directory from this program are **written, reviewed-ready
SQL, not yet executed against any live database.** This sandbox/session
has no credentials or network path to the real Supabase project, so
"migrations execute correctly" for these files means "applies cleanly to
a schema matching what `packages/contracts/src/auth-types.ts` /
`packages/auth/src/db/dbService.ts` document the current table shape to
be" (verified by inspection against those files), not "confirmed against
production."

Before applying: run `supabase db push` (or the equivalent for however
this project's Supabase instance is actually managed) against a staging
project first, and reconcile this directory with whatever the live schema
actually is — since it was previously unmanaged in-repo, there is a real
possibility the live schema has columns/constraints not reflected in
`auth-types.ts`.

| File | Program reference | What it does |
|---|---|---|
| `20260715120000_persona_intelligence_os_sync.sql` | EM-1.2 / EM-1.3 / EM-1.4 | Adds `intelligence_asset_id`, `synced_to_intelligence_os_at` to `personas`. |
| `20260715120100_brand_assets_intelligence_os_correlation.sql` | EM-2.6 | Adds `intelligence_asset_id` to `brand_assets`. |
