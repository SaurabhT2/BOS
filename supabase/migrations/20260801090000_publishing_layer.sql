-- ============================================================
-- 20260801090000_publishing_layer.sql
--
-- Publishing Foundation (Phase 10) — PUBLISHING_ARCHITECTURE_V1.md §4/§6.
--
-- Table names are deliberately prefixed brandos_publishing_* to avoid any
-- collision with control-plane-layer's existing, unrelated
-- brandos_artifact_versions / brandos_artifact_approvals tables (which
-- back a different, content-generation-time concept — see the naming
-- note at the top of packages/publishing-layer/src/types.ts).
--
-- STATUS: written, reviewed-ready SQL, not yet executed against any live
-- database — see supabase/migrations/README.md's standing note for this
-- repository. Verified by inspection, column-for-column, against the row
-- mappers in packages/publishing-layer/src/repository-supabase.ts; not
-- confirmed against a live Supabase project.
--
-- No RLS policies are defined here, consistent with every other migration
-- in this directory (grep confirms zero "ROW LEVEL SECURITY" usage
-- anywhere in supabase/migrations today) — workspace isolation is
-- enforced at the application layer (every repository method in
-- repository-supabase.ts filters by workspace_id), the same posture the
-- rest of this schema already takes.
-- ============================================================

-- ─── Artifacts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_artifacts (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  owner_id text NOT NULL,
  title text NOT NULL,
  artifact_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  current_state text NOT NULL,
  current_version_id uuid,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_artifacts_workspace
  ON brandos_publishing_artifacts (workspace_id);

-- ─── ArtifactVersions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_artifact_versions (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES brandos_publishing_artifacts (id),
  workspace_id text NOT NULL,
  version_number integer NOT NULL,
  source_artifact_type text NOT NULL,
  source_content_hash text NOT NULL,
  source_payload jsonb,
  rendered_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  supersedes uuid REFERENCES brandos_publishing_artifact_versions (id),
  superseded_by uuid REFERENCES brandos_publishing_artifact_versions (id),
  -- Guards the "read count, then write" versionNumber assignment in
  -- publishing-service.ts: a race under concurrent writers fails loudly
  -- here instead of silently duplicating a version number. See
  -- PUBLISHING_LAYER_NOTES.md's "Known limitations" for the full caveat.
  UNIQUE (artifact_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_versions_artifact
  ON brandos_publishing_artifact_versions (artifact_id, workspace_id);

-- ─── Approvals ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_approvals (
  id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL REFERENCES brandos_publishing_artifact_versions (id),
  workspace_id text NOT NULL,
  purpose text NOT NULL,
  decision text NOT NULL,
  reason text,
  decided_by jsonb NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  policy_snapshot jsonb NOT NULL
  -- Immutable by convention (§6): no UPDATE/DELETE path exists in
  -- repository-supabase.ts's ApprovalRepository — a "re-approval" is
  -- always a new row, never a mutation of this one.
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_approvals_version
  ON brandos_publishing_approvals (artifact_version_id, workspace_id);

-- ─── Destinations ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_destinations (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  publisher_id text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_destinations_workspace
  ON brandos_publishing_destinations (workspace_id);

-- ─── DistributionJobs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_distribution_jobs (
  id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL REFERENCES brandos_publishing_artifact_versions (id),
  destination_id uuid NOT NULL REFERENCES brandos_publishing_destinations (id),
  workspace_id text NOT NULL,
  -- v1.1: which of the version's rendered formats this job targets, set once
  -- at submission and reused on retry (see PUBLISHING_ARCHITECTURE_V1.md §4 —
  -- a job with no format reference had no way to know which rendered output
  -- a retry should reuse). CHECK mirrors RenderedOutputRef['format'] in types.ts.
  format text NOT NULL CHECK (format IN ('html', 'pdf', 'pptx', 'png', 'email')),
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  requested_by jsonb NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  publication_id uuid -- FK added below, after brandos_publishing_publications exists (forward reference)
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_jobs_version
  ON brandos_publishing_distribution_jobs (artifact_version_id, workspace_id);

-- ─── Publications ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_publications (
  id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL REFERENCES brandos_publishing_artifact_versions (id),
  destination_id uuid NOT NULL REFERENCES brandos_publishing_destinations (id),
  distribution_job_id uuid NOT NULL REFERENCES brandos_publishing_distribution_jobs (id),
  workspace_id text NOT NULL,
  destination_reference text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  revoked_reason text
  -- §8: never deleted, even on rollback — repository-supabase.ts's
  -- PublicationRepository.revoke() only ever sets revoked/revoked_at/
  -- revoked_reason, never DELETEs a row.
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_publications_version
  ON brandos_publishing_publications (artifact_version_id, workspace_id);

ALTER TABLE brandos_publishing_distribution_jobs
  ADD CONSTRAINT fk_brandos_publishing_jobs_publication
  FOREIGN KEY (publication_id) REFERENCES brandos_publishing_publications (id);

-- ─── PublishEvents ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_events (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  artifact_id uuid NOT NULL REFERENCES brandos_publishing_artifacts (id),
  artifact_version_id uuid REFERENCES brandos_publishing_artifact_versions (id),
  workspace_id text NOT NULL,
  actor jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
  -- Append-only (§4/§6): PublishEventRepository never exposes an
  -- update/delete method.
);

CREATE INDEX IF NOT EXISTS idx_brandos_publishing_events_artifact
  ON brandos_publishing_events (artifact_id, workspace_id, occurred_at);

-- ─── RetentionPolicies ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brandos_publishing_retention_policies (
  workspace_id text PRIMARY KEY,
  min_retention_days integer,
  hard_delete_allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL
);
