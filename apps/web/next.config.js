/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Transpile all internal @brandos/* workspace packages ──────────────────
  //
  // CRITICAL: Every package that holds process-scoped singletons (module-level
  // `let _runtime = null` variables) MUST be in this list.
  //
  // When a package is in transpilePackages, Next.js/webpack bundles its source
  // (or dist) into a SINGLE shared chunk — so all importers (instrumentation.ts,
  // route handlers, CPL) read from the SAME module instance, and the singleton
  // `_runtime` variable is shared across all of them.
  //
  // When a package is NOT in transpilePackages, webpack may resolve it to
  // separate module instances across different compilation units (instrumentation
  // chunk vs. app chunk vs. route chunk). Writing `_runtime` in one instance is
  // invisible to readers in another — the singleton appears null at call time
  // even though initialization succeeded at startup.
  //
  // Root cause of the Phase 2 runtime initialization failure:
  //   @brandos/brand-intelligence was missing from this list.
  //   instrumentation.ts wrote to instance A; carousel route read from instance B.
  //
  // Rule: all internal @brandos/* packages must be listed here.
  transpilePackages: [
    '@brandos/contracts',
    '@brandos/shared-utils',
    '@brandos/runtime-config',
    '@brandos/artifact-config',
    '@brandos/governance-config',
    '@brandos/brand-intelligence',       // ← was missing — caused _runtime = null in routes
    '@brandos/ai-runtime-layer',
    '@brandos/output-control-layer',
    '@brandos/governance-layer',
    '@brandos/artifact-engine-layer',
    '@brandos/iskill-runtime',
    '@brandos/control-plane-layer',
    '@brandos/presentation-layer',
    '@brandos/ui-admin',
  ],

  // pptxgenjs must NOT be bundled by webpack.
  //
  // pptxgenjs is pure JavaScript (no native .node binaries), but its CJS build
  // uses require('jszip') and Node built-in shims ('https', 'image-size') that
  // webpack incorrectly stubs when targeting a Node server bundle, producing
  // "require is not defined" or corrupted JSZip output at runtime.
  //
  // serverExternalPackages tells Next.js to leave pptxgenjs (and its transitive
  // deps) as a genuine Node.js require() at runtime rather than inlining it
  // into the webpack bundle. The API routes that use pptxgenjs load it via
  // dynamic import() — see lib/artifact-export-pptx.ts for the rationale.
  //
  // G-19 (Architecture Verification Report, P2): @napi-rs/canvas ships a
  // native .node binary (js-binding.js loads it) — Turbopack/webpack cannot
  // bundle native addons into an ESM chunk ("non-ecmascript placeable
  // asset"), the same fundamental issue as pptxgenjs above, just for a
  // different reason (native binary vs. Node-builtin shimming). pdfjs-dist
  // is listed alongside it since its legacy/Node build also does
  // environment-dependent dynamic requires internally that are safer left
  // unbundled. See lib/scanned-pdf-ocr.ts, which loads pdfjs-dist via
  // dynamic import() for the same reason artifact-export-pptx.ts does for
  // pptxgenjs.
  serverExternalPackages: ['pptxgenjs', '@napi-rs/canvas', 'pdfjs-dist'],

  // Lint is configured via .eslintrc and run separately with `next lint` or
  // the ESLint CLI. The `eslint` key is no longer supported in next.config.js
  // as of Next.js 15+ — lint options are now CLI flags only.
  // (Removing this key eliminates the "Unrecognized key(s): 'eslint'" warning.)

  typescript: {
    // Keep build-time type errors fatal. Separate from the eslint key above —
    // typescript config is still a valid next.config.js key in Next.js 16.
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig


