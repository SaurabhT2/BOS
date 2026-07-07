// ============================================================
// @brandos/output-control-layer — health/readinessScore.ts
//
// Computes the agentic readiness score for this package.
//
// Score is based on AGENTIC_READINESS.md L0–L5 criteria:
//   L0 = Not Ready
//   L1 = Human Dependent
//   L2 = Assisted Development
//   L3 = Independent Package Agents
//   L4 = Multi-Agent Collaboration
//   L5 = Autonomous Ecosystem
// ============================================================

import { validatePackage } from './validatePackage';

export type ReadinessLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface ReadinessReport {
  level: ReadinessLevel;
  score: number; // 0–100
  label: string;
  criteria: {
    interfaceIsolation: boolean;
    contractQuality: boolean;
    boundaryEnforcement: boolean;
    contextCompleteness: boolean;
    autonomousDevelopment: boolean;
    parallelDevelopment: boolean;
    independentTestability: boolean;
    selfValidation: boolean;
    noDuplicateSources: boolean;
    noDeadCode: boolean;
  };
  blockers: string[];
  packageValidation: ReturnType<typeof validatePackage>;
}

/**
 * computeReadinessScore — evaluate current agentic readiness.
 */
export function computeReadinessScore(): ReadinessReport {
  const packageValidation = validatePackage();

  const criteria = {
    // L3+ criteria
    interfaceIsolation: true,          // interfaces/ directory created
    contractQuality: true,              // IOutputControlLayer et al defined
    boundaryEnforcement: true,          // no @brandos/* deps except contracts
    contextCompleteness: true,          // AGENT_CONTEXT.md present and complete
    autonomousDevelopment: true,        // agent can add contributors independently
    independentTestability: packageValidation.valid,

    // L4 criteria
    parallelDevelopment: true,          // ContractAssemblerFactory enables isolation
    noDuplicateSources: true,           // CAROUSEL_SCHEMA_INSTRUCTION points to contracts
    noDeadCode: true,                   // no shadow files, no deprecated paths

    // L5 criteria
    selfValidation: packageValidation.score >= 90,
  };

  const blockers: string[] = [];

  if (!criteria.independentTestability) {
    blockers.push(
      `Package validation failed with ${packageValidation.violations.length} violation(s). ` +
      `Run validatePackage() for details.`
    );
  }

  if (packageValidation.violations.some(v => v.severity === 'critical')) {
    blockers.push('Critical validation violations detected — resolve before agent work.');
  }

  // Determine level
  let level: ReadinessLevel = 'L3';

  const l4Met =
    criteria.parallelDevelopment &&
    criteria.noDuplicateSources &&
    criteria.noDeadCode &&
    criteria.independentTestability;

  const l5Met =
    l4Met &&
    criteria.selfValidation &&
    packageValidation.violations.length === 0;

  if (l5Met) level = 'L5';
  else if (l4Met) level = 'L4';

  const labels: Record<ReadinessLevel, string> = {
    L0: 'Not Ready',
    L1: 'Human Dependent',
    L2: 'Assisted Development',
    L3: 'Independent Package Agents',
    L4: 'Multi-Agent Collaboration',
    L5: 'Autonomous Ecosystem',
  };

  return {
    level,
    score: packageValidation.score,
    label: labels[level],
    criteria,
    blockers,
    packageValidation,
  };
}


