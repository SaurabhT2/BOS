# TEST_READINESS.md — @brandos/output-control-layer

## Coverage Requirements

| Metric | Target | Enforced By |
|---|---|---|
| Statements | ≥ 95% | vitest.config.ts thresholds |
| Branches | ≥ 90% | vitest.config.ts thresholds |
| Functions | 100% | vitest.config.ts thresholds |
| Lines | ≥ 95% | vitest.config.ts thresholds |

Run: `pnpm test:coverage`

---

## Critical Paths — All Must Have Tests

| Path | Test File | Status |
|---|---|---|
| `normalizeOutput()` | `tests/integration/normalizeOutput.test.ts` | ✅ |
| `compilePromptFromContract()` | `tests/integration/fullPipeline.test.ts` | ✅ |
| `ContractAssembler` / `ContractAssemblerFactory` | `tests/contracts/contributors.test.ts` | ✅ |
| `WeakModelAdapter` (detectRichness, adaptWeakOutput) | `tests/unit/weakModelAdapter.test.ts` | ✅ |
| All contributors (5) | `tests/contracts/contributors.test.ts` | ✅ |
| `cleanOutput()` | `tests/unit/cleanOutput.test.ts` | ✅ |
| `extractJSON()` | `tests/unit/extractJSON.test.ts` | ✅ |
| `repairJSON()` + `repairWithLLM()` | `tests/unit/repairJSON.test.ts` | ✅ |
| `parseArtifact()` + `parseArtifactJSON()` | `tests/unit/parseArtifact.test.ts` | ✅ |
| `validateArtifactFields()` | `tests/unit/parseArtifact.test.ts` | ✅ |
| Artifact transformers (carousel/deck/report) | `tests/integration/fullPipeline.test.ts` | ✅ |
| Mutation / adversarial inputs | `tests/mutation/invalidInputs.test.ts` | ✅ |

---

## Test Structure

```
tests/
  unit/             — pure function tests, no I/O, no async dependencies
  integration/      — multi-module pipeline tests
  contracts/        — interface conformance tests
  fixtures/         — shared test data (immutable)
  mutation/         — adversarial and edge-case inputs
```

---

## Mutation Test Requirements

The mutation test suite must verify:

| Scenario | Covered |
|---|---|
| Invalid JSON (empty, whitespace, plain text) | ✅ |
| Malformed JSON (trailing commas, single quotes, unclosed braces) | ✅ |
| Deeply nested structures | ✅ |
| Mismatched brackets | ✅ |
| Binary/control characters | ✅ |
| Very long strings | ✅ |
| Wrong JSON types (slides = null, slides = string) | ✅ |
| Schema drift (correct JSON, wrong shape) | ✅ |
| Missing required fields | ✅ |
| Duplicate keys | ✅ |
| Null/undefined content field | ✅ |

---

## Test Quality Rules

1. **No shared mutable state between tests** — each test creates its own fixtures
2. **No real LLM calls** — `callLLM` is always a `vi.fn()` mock
3. **No real Supabase calls** — OCL has no DB access; none needed
4. **Fixtures are immutable** — imported from `tests/fixtures/index.ts`, never mutated in-test
5. **Async tests must use `await`** — no floating promises
6. **Each test asserts one behavior** — single expect per it() block preferred
7. **Mutation tests cover all MUTATIONS array entries** — generated via loop, not manual

---

## Adding Tests for New Features

When adding a new contributor:
- Add conformance test block in `tests/contracts/contributors.test.ts`
- Verify `contribute()` returns T | null, never throws
- Verify output shape for relevant task types

When adding a new artifact type:
- Add fixture raw LLM output to `tests/fixtures/index.ts`
- Add `NormalizeOptions` constant
- Add integration test in `normalizeOutput.test.ts`
- Add full pipeline test in `fullPipeline.test.ts`
- Add mutation test entries


