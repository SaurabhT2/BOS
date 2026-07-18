-- Cognitive Platform Evolution Program — Milestone 2 (Knowledge Loop)
-- EM-2.6 (Ingestion Correlation & Confirmation)
--
-- Same correlation pattern as
-- 20260715120000_persona_intelligence_os_sync.sql, for uploaded/analyzed
-- brand assets. See apps/web/app/api/assets/route.ts and
-- .../[id]/analyze/route.ts.
--
-- NOT YET EXECUTED against any live database — see
-- supabase/migrations/README.md.
--
-- SAFETY NOTE: same to_regclass() guard as
-- 20260715120000_persona_intelligence_os_sync.sql, and for the same
-- reason — see that file's comment.

do $$
begin
  if to_regclass('public.brand_assets') is null then
    raise notice 'Skipping 20260715120100_brand_assets_intelligence_os_correlation.sql — public.brand_assets does not exist yet.';
    return;
  end if;

  alter table public.brand_assets
    add column if not exists intelligence_asset_id text;

  comment on column public.brand_assets.intelligence_asset_id is
    'IntelligenceOS knowledge-asset id from the most recent successful '
    'POST /v1/knowledge/ingest call for this asset. Null = never ingested, '
    'ingestion skipped (IntelligenceOS not configured), or ingestion failed — '
    'ingestion is best-effort and never blocks the upload/analyze response. '
    'Passed back as existingAssetId on re-ingestion so IntelligenceOS updates '
    'the same knowledge asset instead of accumulating a duplicate per re-analysis.';
end $$;
