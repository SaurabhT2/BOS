-- Cognitive Platform Evolution Program — Knowledge Lifecycle Completion (2026-07-23)
--
-- Same correlation pattern as 20260715120100_brand_assets_intelligence_os_correlation.sql,
-- for the ContributionSummary IntelligenceOS's POST /v1/knowledge/ingest now
-- returns alongside assetId. See apps/web/app/api/assets/route.ts and
-- .../[id]/analyze/route.ts, and @brandos/cognition-client's
-- KnowledgeIngestClient.
--
-- NOT YET EXECUTED against any live database — see supabase/migrations/README.md.
--
-- SAFETY NOTE: same to_regclass() guard as
-- 20260715120100_brand_assets_intelligence_os_correlation.sql, and for the
-- same reason — see that file's comment.

do $$
begin
  if to_regclass('public.brand_assets') is null then
    raise notice 'Skipping 20260723130000_brand_assets_knowledge_contribution.sql — public.brand_assets does not exist yet.';
    return;
  end if;

  alter table public.brand_assets
    add column if not exists knowledge_contribution jsonb;

  comment on column public.brand_assets.knowledge_contribution is
    'ContributionSummary from the most recent successful POST /v1/knowledge/ingest '
    'call for this asset (IntelligenceOS''s knowledge/types.ts) — how much this '
    'document expanded the workspace''s knowledge surface (score, isDuplicate, '
    'noveltyRatio, corroborationScore, termCount, frameworkCount, patternCount, '
    'reasons). Null until ingested, if ingestion was skipped/failed, or for '
    'non-text assets contribution scoring does not apply to. Purely descriptive — '
    'has no bearing on identity/confidence, which remain governed by IntelligenceOS''s '
    'Evidence/Identity Bridge (ADR-005) and are not exposed to BrandOS at all.';
end $$;
