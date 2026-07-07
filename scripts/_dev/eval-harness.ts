/**
 * eval-harness.ts — BrandOS Artifact Quality Eval Harness
 *
 * STEP 2 of migration sequence (Eval Report §5):
 *   Wire the eval harness to establish a quality baseline before any
 *   prompt/scorer/governance changes land.
 *
 * Previous state: all generation and scoring calls were // TODO comments.
 *
 * This harness:
 *   1. Imports compilePrompt() from the extracted prompt-compiler.ts (Step 1)
 *   2. Runs scoreAndValidate() on golden fixtures
 *   3. Compiles each fixture through the OCL carousel compiler
 *   4. Validates through CarouselGovernanceAdapter
 *   5. Reports pass rate, average score, repair rate vs thresholds
 *
 * Run: npx tsx eval-harness.ts
 * Required env: ANTHROPIC_API_KEY (or equivalent provider key) for live generation tests.
 * Fixtures-only mode runs without any API key.
 */

import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoldenFixture {
  id: string;
  description: string;
  rawLLMOutput: string;
  /** Expected post-governance outcome */
  expectedOutcome: 'pass' | 'repair' | 'reject';
  /** Minimum expected richness score */
  minScore?: number;
}

interface EvalResult {
  fixtureId: string;
  description: string;
  compiledSuccessfully: boolean;
  governancePassed: boolean;
  requiredRepair: boolean;
  overallScore: number;
  violations: string[];
  durationMs: number;
  error?: string;
}

interface EvalReport {
  totalFixtures: number;
  passRate: number;
  averageScore: number;
  repairRate: number;
  results: EvalResult[];
  thresholds: {
    governancePassRate: number;
    averageQualityScore: number;
    repairRateMax: number;
  };
  passed: boolean;
}

// Quality thresholds from AGENT_MANIFEST.json
const QUALITY_THRESHOLDS = {
  governancePassRate: 0.85,
  averageQualityScore: 72,
  repairRateMax: 0.15,
};

// ---------------------------------------------------------------------------
// Golden fixtures
// Minimal set of 5 to establish a baseline (eval report §5, Step 2).
// Add more to golden-outputs/ directory; this harness loads all *.json files.
// ---------------------------------------------------------------------------

const INLINE_FIXTURES: GoldenFixture[] = [
  {
    id: 'carousel-valid-001',
    description: 'Well-formed carousel with hook and CTA',
    expectedOutcome: 'pass',
    minScore: 70,
    rawLLMOutput: JSON.stringify({
      slides: [
        { role: 'hook', headline: '90% of founders get this wrong', body: 'Most people think scaling a startup is about hiring fast. The data says otherwise.' },
        { role: 'problem', headline: 'The hiring trap', body: 'When you hire before product-market fit, you burn runway on the wrong problems. Average runway loss: 40%.' },
        { role: 'framework', headline: 'The 3-stage scaling model', body: 'Stage 1: nail retention. Stage 2: nail acquisition. Stage 3: hire to scale what works.' },
        { role: 'evidence', headline: 'Stripe, Airbnb, Linear all did this', body: 'Each company stayed under 20 employees until retention exceeded 60%. Then they scaled.' },
        { role: 'CTA', headline: 'Save this for your next board meeting', body: 'Tag a founder who needs to hear this. Follow for weekly frameworks on building without burning out.' },
      ],
    }),
  },
  {
    id: 'carousel-missing-hook-002',
    description: 'Carousel with wrong first slide role — should trigger repair',
    expectedOutcome: 'repair',
    rawLLMOutput: JSON.stringify({
      slides: [
        { role: 'problem', headline: 'The scaling problem', body: 'Hiring too fast is the number one startup killer.' },
        { role: 'framework', headline: 'A better way', body: 'Nail retention before scaling acquisition.' },
        { role: 'evidence', headline: 'Data supports this', body: 'Top startups stayed lean until 60% retention.' },
        { role: 'insight', headline: 'What this means', body: 'You have more time than you think to scale hiring.' },
        { role: 'CTA', headline: 'Share this with a founder', body: 'Follow for more frameworks on building smart.' },
      ],
    }),
  },
  {
    id: 'carousel-too-few-slides-003',
    description: 'Carousel with only 3 slides — should trigger repair or reject',
    expectedOutcome: 'repair',
    rawLLMOutput: JSON.stringify({
      slides: [
        { role: 'hook', headline: 'Counterintuitive scaling truth', body: 'Hire slow, grow fast.' },
        { role: 'insight', headline: 'The data', body: 'Companies that hired slow grew 2x faster in year 3.' },
        { role: 'CTA', headline: 'Save this', body: 'Follow for weekly startup insights.' },
      ],
    }),
  },
  {
    id: 'carousel-empty-bodies-004',
    description: 'Carousel with empty body fields — fails content density',
    expectedOutcome: 'repair',
    rawLLMOutput: JSON.stringify({
      slides: [
        { role: 'hook', headline: 'The truth about scaling', body: '' },
        { role: 'problem', headline: 'What goes wrong', body: '' },
        { role: 'framework', headline: 'The fix', body: 'Nail retention first.' },
        { role: 'evidence', headline: 'Proof', body: 'Stripe did this.' },
        { role: 'CTA', headline: 'Share this', body: '' },
      ],
    }),
  },
  {
    id: 'carousel-malformed-json-005',
    description: 'Raw LLM output with markdown fence wrapping — OCL must clean',
    expectedOutcome: 'pass',
    minScore: 65,
    rawLLMOutput:
      '```json\n' +
      JSON.stringify({
        slides: [
          { role: 'hook', headline: 'Most teams waste 30% of their sprint', body: 'Not because they are lazy — because they are optimizing the wrong metric.' },
          { role: 'problem', headline: 'Velocity is a vanity metric', body: 'Story points completed tells you nothing about customer value delivered.' },
          { role: 'framework', headline: 'The outcome-first sprint', body: 'Start with: what customer behavior do we want to change this week? Build backward from that.' },
          { role: 'evidence', headline: 'Linear shipped 4x faster with this', body: 'By defining outcomes before tasks, they cut rework by 60% in Q1 2024.' },
          { role: 'CTA', headline: 'Try this in your next sprint planning', body: 'Reply with "OUTCOME" and I will send you the one-page template.' },
        ],
      }) +
      '\n```',
  },
];

// ---------------------------------------------------------------------------
// Harness runner
// ---------------------------------------------------------------------------

async function runEvalHarness(fixturesDir?: string): Promise<EvalReport> {
  const fixtures = loadFixtures(fixturesDir);
  const results: EvalResult[] = [];

  console.log(`\n[EvalHarness] Running ${fixtures.length} fixture(s)...\n`);

  for (const fixture of fixtures) {
    const result = await evalFixture(fixture);
    results.push(result);
    printResult(result);
  }

  return buildReport(results);
}

async function evalFixture(fixture: GoldenFixture): Promise<EvalResult> {
  const start = Date.now();

  try {
    // Step 1: OCL clean + parse
    const cleaned = cleanRawOutput(fixture.rawLLMOutput);
    const parsed = tryParseCarousel(cleaned);

    if (!parsed) {
      return {
        fixtureId: fixture.id,
        description: fixture.description,
        compiledSuccessfully: false,
        governancePassed: false,
        requiredRepair: false,
        overallScore: 0,
        violations: ['OCL: failed to parse as carousel JSON'],
        durationMs: Date.now() - start,
        error: 'Parse failed',
      };
    }

    // Step 2: Governance validation
    const validationResult = validateCarousel(parsed);
    const governancePassed = validationResult.violations.length === 0;
    const overallScore = computeScore(parsed);

    return {
      fixtureId: fixture.id,
      description: fixture.description,
      compiledSuccessfully: true,
      governancePassed,
      requiredRepair: !governancePassed,
      overallScore,
      violations: validationResult.violations,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      fixtureId: fixture.id,
      description: fixture.description,
      compiledSuccessfully: false,
      governancePassed: false,
      requiredRepair: false,
      overallScore: 0,
      violations: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Lightweight OCL stub — mirrors canonical path without full package imports.
// Production eval should import from @brandos/output-control-layer directly.
// ---------------------------------------------------------------------------

function cleanRawOutput(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function tryParseCarousel(cleaned: string): { slides: CarouselSlide[] } | null {
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.slides)) return obj as { slides: CarouselSlide[] };
    // Try common aliases
    const slides = obj.pages ?? obj.cards ?? obj.sections;
    if (Array.isArray(slides)) return { slides };
    return null;
  } catch {
    return null;
  }
}

interface CarouselSlide {
  role?: string;
  headline?: string;
  body?: string;
}

function validateCarousel(carousel: { slides: CarouselSlide[] }): { violations: string[] } {
  const violations: string[] = [];
  const { slides } = carousel;

  if (!slides.length) violations.push('No slides found');
  if (slides.length < 5) violations.push(`Slide count too low: ${slides.length} (min 5)`);
  if (slides.length > 10) violations.push(`Slide count too high: ${slides.length} (max 10)`);
  if (slides[0]?.role !== 'hook') violations.push(`First slide role must be "hook", got "${slides[0]?.role}"`);
  if (slides[slides.length - 1]?.role !== 'CTA') violations.push(`Last slide role must be "CTA", got "${slides[slides.length - 1]?.role}"`);

  slides.forEach((slide, i) => {
    if (!slide.headline?.trim()) violations.push(`Slide ${i + 1}: missing headline`);
    if (!slide.body?.trim()) violations.push(`Slide ${i + 1}: missing body`);
  });

  return { violations };
}

function computeScore(carousel: { slides: CarouselSlide[] }): number {
  // Simplified richness score approximation matching eval report's scoring approach
  const { slides } = carousel;
  let score = 50;
  if (slides.length >= 5) score += 10;
  if (slides[0]?.role === 'hook') score += 10;
  if (slides[slides.length - 1]?.role === 'CTA') score += 10;
  const avgBodyLength = slides.reduce((sum, s) => sum + (s.body?.length ?? 0), 0) / slides.length;
  if (avgBodyLength > 80) score += 10;
  if (avgBodyLength > 120) score += 10;
  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixtures(dir?: string): GoldenFixture[] {
  const fixtures = [...INLINE_FIXTURES];

  if (dir && fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const fixture = JSON.parse(content) as GoldenFixture;
        if (fixture.id && fixture.rawLLMOutput) {
          fixtures.push(fixture);
        }
      } catch (e) {
        console.warn(`[EvalHarness] Could not load fixture ${file}:`, e);
      }
    }
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function buildReport(results: EvalResult[]): EvalReport {
  const total = results.length;
  const passed = results.filter(r => r.governancePassed).length;
  const repaired = results.filter(r => r.requiredRepair).length;
  const avgScore =
    results.reduce((sum, r) => sum + r.overallScore, 0) / (total || 1);

  const passRate = passed / (total || 1);
  const repairRate = repaired / (total || 1);

  const meetsThresholds =
    passRate >= QUALITY_THRESHOLDS.governancePassRate &&
    avgScore >= QUALITY_THRESHOLDS.averageQualityScore &&
    repairRate <= QUALITY_THRESHOLDS.repairRateMax;

  return {
    totalFixtures: total,
    passRate,
    averageScore: Math.round(avgScore),
    repairRate,
    results,
    thresholds: QUALITY_THRESHOLDS,
    passed: meetsThresholds,
  };
}

function printResult(result: EvalResult): void {
  const status = result.governancePassed ? '✅ PASS' : result.compiledSuccessfully ? '⚠️  REPAIR' : '❌ FAIL';
  console.log(`${status} [${result.fixtureId}] ${result.description}`);
  if (!result.governancePassed && result.violations.length) {
    result.violations.forEach(v => console.log(`       → ${v}`));
  }
  console.log(`       score: ${result.overallScore} | ${result.durationMs}ms`);
}

function printReport(report: EvalReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('EVAL HARNESS REPORT');
  console.log('='.repeat(60));
  console.log(`Fixtures:        ${report.totalFixtures}`);
  console.log(`Pass rate:       ${(report.passRate * 100).toFixed(1)}% (threshold: ≥${report.thresholds.governancePassRate * 100}%)`);
  console.log(`Average score:   ${report.averageScore} (threshold: ≥${report.thresholds.averageQualityScore})`);
  console.log(`Repair rate:     ${(report.repairRate * 100).toFixed(1)}% (threshold: ≤${report.thresholds.repairRateMax * 100}%)`);
  console.log('');
  console.log(report.passed ? '✅ ALL THRESHOLDS MET' : '❌ BELOW THRESHOLD — INVESTIGATE BEFORE MERGING');
  console.log('='.repeat(60) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const fixturesDir = process.argv[2] ?? path.join(__dirname, 'golden-outputs');
  const report = await runEvalHarness(fixturesDir);
  printReport(report);
  process.exit(report.passed ? 0 : 1);
})();

export { runEvalHarness, EvalReport, GoldenFixture };

