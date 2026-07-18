-- Cognitive Platform Evolution Program — Milestone 1 (Cognitive Ownership)
-- EM-1.2 (Workspace Configuration Write Path) / EM-1.3 (Backfill Job) /
-- EM-1.4 (Visual Identity Ownership Transfer)
--
-- `personas` becomes a write-through cache of IntelligenceOS's workspace
-- configuration (ADR-003 §2.4) rather than the system of record. These
-- columns let BrandOS know, per persona row, whether/when the local write
-- was successfully mirrored to IntelligenceOS, and which IntelligenceOS
-- knowledge-asset record it corresponds to.
--
-- NOT YET EXECUTED against any live database — this repository had no
-- supabase/migrations directory before this program (schema changes were
-- previously applied out-of-band, outside the checked-in codebase; see
-- this directory's README). Apply via `supabase db push` or the
-- equivalent CLI/dashboard flow for the real project, after review.
--
-- SAFETY NOTE (added after a report of a post-reset signup regression):
-- this file has no way of knowing where it sorts relative to whatever
-- migration(s) actually create `public.personas` in the real project —
-- that schema was never part of what this program had visibility into.
-- `ALTER TABLE public.personas ...` on a table that does not exist yet
-- throws (`relation "public.personas" does not exist`), and depending on
-- the migration runner, one failed migration can abort an entire batch —
-- which, if a signup/workspace-bootstrap trigger is defined in a later
-- migration, would explain a total post-reset signup failure with no
-- application-code involvement at all. Guarded with `to_regclass()` below
-- so this migration is a safe no-op if the table doesn't exist yet,
-- instead of a hard failure that could block unrelated migrations after
-- it. If it no-ops, re-run this file once `personas` exists.

do $$
begin
  if to_regclass('public.personas') is null then
    raise notice 'Skipping 20260715120000_persona_intelligence_os_sync.sql — public.personas does not exist yet.';
    return;
  end if;

  alter table public.personas
    add column if not exists intelligence_asset_id text,
    add column if not exists synced_to_intelligence_os_at timestamptz;

  comment on column public.personas.intelligence_asset_id is
    'IntelligenceOS knowledge-asset id returned by POST /v1/workspace-configuration '
    '(WorkspaceConfigurationClient.sync()). Null until the first successful sync. '
    'See @brandos/control-plane-layer/src/workspace-configuration/service.ts.';

  comment on column public.personas.synced_to_intelligence_os_at is
    'Timestamp of the most recent successful IntelligenceOS sync for this persona. '
    'Null means either never synced, or the most recent sync attempt failed — '
    'callers should treat null as "stale," not as an error state to surface to '
    'the user (sync is best-effort; the local write already succeeded).';

  -- Backing index for the EM-1.3 backfill job's "find everything not yet
  -- synced" query.
  create index if not exists idx_personas_unsynced
    on public.personas (id)
    where synced_to_intelligence_os_at is null;
end $$;
