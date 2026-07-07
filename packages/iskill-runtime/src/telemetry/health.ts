/**
 * @brandos/iskill-runtime — telemetry/health.ts
 *
 * Lightweight primitives for computing SkillHealthScore from
 * SkillExecutionTelemetry records. No external dependencies.
 *
 * R3: Moved from @brandos/shared-utils (domain logic belongs in domain package).
 */
import type { SkillExecutionTelemetry, SkillHealthScore } from "@brandos/contracts";

/**
 * computeSkillHealth — derives SkillHealthScore from telemetry records.
 * Pass all records for a single skillId.
 */
export function computeSkillHealth(
  skillId: string,
  records: SkillExecutionTelemetry[]
): SkillHealthScore {
  if (records.length === 0) {
    return {
      skillId,
      successRate: 0,
      repairRate: 0,
      schemaCompliance: 0,
      avgDurationMs: 0,
      sampleCount: 0,
      lastExecutedAt: new Date(0).toISOString(),
    };
  }

  const successCount = records.filter((r) => r.success).length;
  const repairCount = records.filter((r) => r.repairInvoked).length;
  const schemaFailCount = records.filter((r) => r.validationFailures.length > 0).length;
  const totalDuration = records.reduce((sum, r) => sum + r.durationMs, 0);
  const evalScores = records
    .map((r) => r.evaluationScore)
    .filter((s): s is number => s !== undefined);

  const sorted = [...records].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const lastExecutedAt = sorted[0]?.timestamp ?? new Date(0).toISOString();

  const avgEvaluationScore =
    evalScores.length > 0
      ? evalScores.reduce((a, b) => a + b, 0) / evalScores.length
      : undefined;

  return {
    skillId,
    successRate: successCount / records.length,
    repairRate: repairCount / records.length,
    schemaCompliance: 1 - schemaFailCount / records.length,
    avgDurationMs: Math.round(totalDuration / records.length),
    ...(avgEvaluationScore !== undefined && { avgEvaluationScore }),
    sampleCount: records.length,
    lastExecutedAt,
  };
}

/**
 * healthSummary — human-readable one-line summary for logging.
 */
export function healthSummary(score: SkillHealthScore): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    `[${score.skillId}] success=${pct(score.successRate)} ` +
    `repair=${pct(score.repairRate)} ` +
    `schema=${pct(score.schemaCompliance)} ` +
    `avgMs=${score.avgDurationMs} n=${score.sampleCount}`
  );
}


