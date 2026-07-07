/**
 * compare-providers.ts — Provider Comparison Harness
 *
 * PURPOSE: Run the same prompt across multiple providers and produce a
 * side-by-side score / latency / cost table. The primary tool for:
 *   - Validating DeepSeek vs existing providers
 *   - Verifying admin settings are reaching providers
 *   - Measuring cost vs quality tradeoffs
 *   - Testing local model competitiveness
 *
 * USAGE: npx ts-node compare-providers.ts
 *
 * WIRE-UP REQUIRED:
 *   The forceProvider option does not exist yet in callWithMode/RoutingHint.
 *   See TODO_FORCE_PROVIDER.md for the 3-line change needed.
 *   Until then, use WORKAROUND: temporarily disable all providers except
 *   the target in admin settings, then run normally.
 */

// TODO: import { callWithMode } from './packages/ai-runtime-layer/src/llmRouter'
// TODO: import { scoreAndValidate } from './packages/control-plane-layer/src/scorer'

// ── Configuration ──────────────────────────────────────────────────────────
const TEST_PROMPT  = "Why most B2B SaaS companies fail at product-led growth"
const TASK_TYPE    = "post" as const    // start with text — no JSON parsing complexity
const RUNTIME_MODE = "cloud"

// When forceProvider is implemented, test these:
const PROVIDERS_TO_TEST = [
  { id: "anthropic",  mode: "cloud",  label: "Claude Sonnet" },
  { id: "openai",     mode: "cloud",  label: "GPT-4o" },
  { id: "groq",       mode: "cloud", label: "Llama 3 (Groq)" },
  { id: "deepseek",   mode: "cloud", label: "DeepSeek Chat" },
  { id: "ollama",     mode: "local",    label: "Local Llama3" },
] as const

// ── Result types ────────────────────────────────────────────────────────────
interface CompareResult {
  provider:       string
  label:          string
  mode:           string
  model:          string
  score:          number
  latency_ms:     number
  cost_est_usd:   number
  content_length: number
  flags:          string[]
  error?:         string
}

// ── Cost estimator (conservative) ───────────────────────────────────────────
const COST_PER_1K: Record<string, number> = {
  anthropic: 0.003,
  openai:    0.005,
  groq:      0.0,
  deepseek:  0.00014,
  ollama:    0.0,
}

function estimateCost(provider: string, tokens: number): number {
  return ((COST_PER_1K[provider] ?? 0.003) * tokens) / 1000
}

// ── Comparison run ──────────────────────────────────────────────────────────
async function runProvider(p: typeof PROVIDERS_TO_TEST[number]): Promise<CompareResult> {
  // STUB: replace with real callWithMode when forceProvider is available
  console.log(`  [STUB] ${p.id} — wire callWithMode with forceProvider to get real results`)

  return {
    provider:       p.id,
    label:          p.label,
    mode:           p.mode,
    model:          "[stub]",
    score:          0,
    latency_ms:     0,
    cost_est_usd:   0,
    content_length: 0,
    flags:          ["STUB — wire callWithMode"],
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== BrandOS Provider Comparison ===\n")
  console.log(`Prompt: "${TEST_PROMPT}"`)
  console.log(`Task:   ${TASK_TYPE}`)
  console.log(`Run at: ${new Date().toISOString()}\n`)

  const results: CompareResult[] = []

  for (const p of PROVIDERS_TO_TEST) {
    process.stdout.write(`Testing ${p.label} (${p.id})... `)
    try {
      const r = await runProvider(p)
      results.push(r)
      console.log(`score=${r.score} latency=${r.latency_ms}ms cost=$${r.cost_est_usd.toFixed(5)}`)
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`)
      results.push({
        provider: p.id, label: p.label, mode: p.mode,
        model: "error", score: 0, latency_ms: 0, cost_est_usd: 0,
        content_length: 0, flags: [], error: e.message,
      })
    }
  }

  // ── Results table ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70))
  console.log("Provider       | Score | Latency   | Cost Est   | Flags")
  console.log("-".repeat(70))
  const sorted = [...results].sort((a, b) => b.score - a.score)
  for (const r of sorted) {
    const flags = r.error ? `ERROR: ${r.error}` : r.flags.join(", ") || "none"
    console.log(
      `${(r.label).padEnd(15)}| ${String(r.score).padEnd(6)}| ${String(r.latency_ms + "ms").padEnd(10)}| $${r.cost_est_usd.toFixed(5).padEnd(10)} | ${flags}`
    )
  }
  console.log("=".repeat(70))

  // ── Recommendation ─────────────────────────────────────────────────────────
  const best = sorted[0]
  if (best && best.score > 0) {
    console.log(`\nRecommended: ${best.label} (score=${best.score}, latency=${best.latency_ms}ms)`)
  }
}

main().catch(console.error)

