import { describe, it, expect } from 'vitest';
import { ContractAssemblerFactory } from '../../src/contract-assembler/ContractAssemblerFactory';
import { compilePromptFromContract } from '../../src/prompt-compiler/compilePromptFromContract';
import { normalizeOutput } from '../../src/output-normalizer/normalizeOutput';
import { compileCarouselArtifact } from '../../src/artifact-compiler/compilers/carouselCompiler';
import { compileDeckArtifact } from '../../src/artifact-compiler/compilers/deckCompiler';
import { compileReportArtifact } from '../../src/artifact-compiler/compilers/reportCompiler';
import {
  MINIMAL_CONTRIBUTOR_CONTEXT,
  CONTRIBUTOR_CONTEXT_WITH_BRAND,
  RAW_CAROUSEL_VALID,
  RAW_DECK_VALID,
  RAW_REPORT_VALID,
  makeRuntimeOutput,
  CAROUSEL_OPTIONS,
  DECK_OPTIONS,
  REPORT_OPTIONS,
} from '../fixtures';

const COMPILE_OPTIONS = {
  topic: 'Founder retention strategies',
  runtimeMode: 'cloud',
  provider: 'anthropic',
  requestId: 'test-req-001',
};

describe('Full pipeline: contract assembly → prompt compilation', () => {
  it('produces a CompiledPrompt with system and user strings', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);
    const prompt = compilePromptFromContract(contract);
    expect(typeof prompt.system).toBe('string');
    expect(typeof prompt.user).toBe('string');
    expect(prompt.user).toBe(MINIMAL_CONTRIBUTOR_CONTEXT.userPrompt);
  });

  it('system prompt is non-empty for carousel', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble({ ...MINIMAL_CONTRIBUTOR_CONTEXT, taskType: 'carousel' });
    const prompt = compilePromptFromContract(contract);
    expect(prompt.system.length).toBeGreaterThan(0);
  });

  it('system prompt is defined with brand context', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(CONTRIBUTOR_CONTEXT_WITH_BRAND);
    const prompt = compilePromptFromContract(contract);
    expect(typeof prompt.system).toBe('string');
  });

  it('attempt > 1 adds STRICT MODE instruction', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble({ ...MINIMAL_CONTRIBUTOR_CONTEXT, attempt: 2 });
    const prompt = compilePromptFromContract(contract);
    expect(prompt.system).toContain('STRICT MODE');
  });
});

describe('Full pipeline: normalize → compile carousel', () => {
  it('produces a valid CarouselArtifact from raw LLM output', async () => {
    const normalizeResult = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_VALID), CAROUSEL_OPTIONS);
    expect(normalizeResult.success).toBe(true);

    const compileResult = compileCarouselArtifact(normalizeResult.content, COMPILE_OPTIONS);
    expect(compileResult.artifact).toBeDefined();
    expect(compileResult.artifact.artifact_type).toBe('carousel');
    expect(Array.isArray(compileResult.artifact.slides)).toBe(true);
    expect(compileResult.artifact.slides.length).toBeGreaterThan(0);
  });

  it('carousel artifact has required fields (artifact_type, slides, id)', async () => {
    const normalizeResult = await normalizeOutput(makeRuntimeOutput(RAW_CAROUSEL_VALID), CAROUSEL_OPTIONS);
    const compileResult = compileCarouselArtifact(normalizeResult.content, COMPILE_OPTIONS);
    expect(compileResult.artifact.artifact_type).toBeDefined();
    expect(compileResult.artifact.id).toBeDefined();
    expect(compileResult.artifact.slides).toBeDefined();
  });
});

describe('Full pipeline: normalize → compile deck', () => {
  it('produces a valid DeckArtifact from raw LLM output', async () => {
    const normalizeResult = await normalizeOutput(makeRuntimeOutput(RAW_DECK_VALID), DECK_OPTIONS);
    expect(normalizeResult.success).toBe(true);

    const compileResult = compileDeckArtifact(normalizeResult.content, COMPILE_OPTIONS);
    expect(compileResult.artifact).toBeDefined();
    expect(compileResult.artifact.artifact_type).toBe('deck');
  });
});

describe('Full pipeline: normalize → compile report', () => {
  it('produces a valid ReportArtifact from raw LLM output', async () => {
    const normalizeResult = await normalizeOutput(makeRuntimeOutput(RAW_REPORT_VALID), REPORT_OPTIONS);
    expect(normalizeResult.success).toBe(true);

    const compileResult = compileReportArtifact(normalizeResult.content, COMPILE_OPTIONS);
    expect(compileResult.artifact).toBeDefined();
    expect(compileResult.artifact.artifact_type).toBe('report');
  });
});

describe('Pipeline idempotency', () => {
  it('normalizeOutput is idempotent on same input', async () => {
    const input = makeRuntimeOutput(RAW_CAROUSEL_VALID);
    const r1 = await normalizeOutput(input, CAROUSEL_OPTIONS);
    const r2 = await normalizeOutput(input, CAROUSEL_OPTIONS);
    expect(r1.success).toBe(r2.success);
    expect(JSON.stringify(r1.content)).toBe(JSON.stringify(r2.content));
  });

  it('compilePromptFromContract is idempotent', async () => {
    const assembler = ContractAssemblerFactory.create({ contributorSet: 'default' });
    const contract = await assembler.assemble(MINIMAL_CONTRIBUTOR_CONTEXT);
    const p1 = compilePromptFromContract(contract);
    const p2 = compilePromptFromContract(contract);
    expect(p1.system).toBe(p2.system);
    expect(p1.user).toBe(p2.user);
  });
});


