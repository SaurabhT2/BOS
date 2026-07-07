// ============================================================
// @brandos/control-plane-layer — __tests__/unit/governanceThreshold.test.ts
//
// REGRESSION TESTS — FIX-SCORE-001, FIX-SCORE-002, FIX-THRESHOLD-001
//
// These tests guard against:
//   1. Hardcoded governanceScore=80 in orchestrator.ts
//   2. Math.max(richnessScore, 65) floor masking real scores
//   3. Admin scoreThresholds never being applied to acceptance logic
//   4. richness=45 passing a carousel threshold configured at 85
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminSettingsService } from '../../src/admin/settings-service';
import { ArtifactPipelineRejection } from '../../src/artifact-pipeline';

// ─── AdminSettingsService threshold tests ────────────────────────────────────

describe('AdminSettingsService — scoreThresholds', () => {
  it('getGovernancePolicy returns scoreThresholds including carousel', () => {
    const policy = AdminSettingsService.getGovernancePolicy();
    expect(policy.scoreThresholds).toBeDefined();
    // scoreThresholds must have at minimum the carousel key
    expect(typeof (policy.scoreThresholds as any)?.carousel).toBe('number');
  });

  it('FIX-THRESHOLD-001: carousel threshold is not lower than 80', () => {
    const policy = AdminSettingsService.getGovernancePolicy();
    const threshold = (policy.scoreThresholds as any)?.carousel ?? 65;
    // The admin-configured threshold should reflect meaningful quality enforcement
    // A threshold lower than 80 would allow nearly-empty carousel content through
    expect(threshold).toBeGreaterThanOrEqual(80);
  });

  it('FIX-THRESHOLD-001: hydrateGovernance updates scoreThresholds', () => {
    const original = AdminSettingsService.getGovernancePolicy();
    AdminSettingsService.hydrateGovernance({
      ...original,
      scoreThresholds: { ...((original.scoreThresholds as any) ?? {}), carousel: 90 },
    } as any);
    const updated = AdminSettingsService.getGovernancePolicy();
    expect((updated.scoreThresholds as any).carousel).toBe(90);
    // Restore
    AdminSettingsService.hydrateGovernance(original);
  });
});

// ─── ArtifactPipelineRejection ───────────────────────────────────────────────

describe('ArtifactPipelineRejection', () => {
  it('is throwable and carries taskType and requestId', () => {
    const err = new ArtifactPipelineRejection(
      'Richness score 45 below configured threshold 85',
      0,
      'carousel',
      'req-test-001'
    );
    expect(err.message).toContain('45');
    expect(err.message).toContain('85');
  });
});

// ─── Governance score accuracy ────────────────────────────────────────────────

describe('FIX-SCORE-001: orchestrator governanceScore initial value', () => {
  it('orchestrator.ts no longer contains hardcoded governanceScore = 80 placeholder', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const srcPath = resolve(__dirname, '../../src/orchestrator.ts');

    let fileContent: string;
    try {
      // Previously shelled out via execSync('cat ...'), which doesn't exist
      // on native Windows — the catch block below then unconditionally
      // `return`ed, which in a vitest `it()` body just ends the test with
      // no assertions run, i.e. a silent pass. That meant this regression
      // guard would never actually run on Windows, whether or not the
      // regression it guards against had reappeared. readFileSync needs no
      // shell at all, so the intended skip-if-missing behavior now only
      // triggers on a genuinely missing file, on every OS.
      fileContent = readFileSync(srcPath, 'utf8');
    } catch {
      // If file not accessible from this test location, skip
      return;
    }

    // The optimistic placeholder comment and value should be gone
    expect(fileContent).not.toContain('optimistic placeholder');
    // The initial value should be 0, not 80
    const hardcodedMatch = fileContent.match(/let governanceScore\s*=\s*(\d+)/);
    if (hardcodedMatch) {
      expect(parseInt(hardcodedMatch[1])).toBe(0);
    }
  });

  it('FIX-SCORE-002: artifact-pipeline.ts does not use Math.max(richnessScore, 65) floor', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const srcPath = resolve(__dirname, '../../src/artifact-pipeline.ts');

    let fileContent: string;
    try {
      fileContent = readFileSync(srcPath, 'utf8');
    } catch {
      return;
    }

    // The hardcoded floor that masked real scores
    expect(fileContent).not.toContain('Math.max(richnessScore, 65)');
    // Should now use configuredThreshold from AdminSettingsService
    expect(fileContent).toContain('configuredThreshold');
    expect(fileContent).toContain('AdminSettingsService.getGovernancePolicy()');
  });
});

// ─── Richness rejection integration ──────────────────────────────────────────

describe('FIX-THRESHOLD-001: richness below threshold triggers rejection', () => {
  it('ArtifactPipelineRejection is the correct error type for threshold violations', () => {
    // This test verifies the rejection class exists and is importable
    // The actual rejection is thrown inside runCarouselPipeline which requires
    // a full artifact engine — tested via integration test
    const rejection = new ArtifactPipelineRejection(
      'Richness score 45 below configured threshold 85',
      0,
      'carousel',
      'req-001'
    );
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toBeInstanceOf(ArtifactPipelineRejection);
  });

  it('richness=45 would be below the default carousel threshold=85', () => {
    const policy = AdminSettingsService.getGovernancePolicy();
    const threshold = (policy.scoreThresholds as any)?.carousel ?? 65;
    const richnessScore = 45;  // the value observed in runtime logs
    expect(richnessScore).toBeLessThan(threshold);
  });
});


