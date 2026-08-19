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
  // puppeteer-core + @sparticuz/chromium must ALSO not be bundled by
  // webpack/Turbopack, for the same underlying reason as pptxgenjs above but
  // with a more severe failure mode: @sparticuz/chromium ships a Chromium
  // BINARY (not just native .node addons) that it locates at runtime via a
  // path relative to its own package directory
  // (node_modules/@sparticuz/chromium/bin). If left un-externalized, Next.js
  // either bundles/relocates the package's JS into a chunk whose relative
  // path no longer matches where the binary actually lives, or its output
  // file tracing doesn't know to include that bin/ directory in the
  // deployed serverless function at all — producing exactly the error this
  // comment exists to prevent:
  //   "@sparticuz/chromium failed to load... input directory
  //   .../@sparticuz/chromium/bin does not exist... you must externalize
  //   @sparticuz/chromium so it is not relocated."
  // (See https://github.com/Sparticuz/chromium#bundler-configuration.)
  // artifact-export-pdf.ts and artifact-export-image.ts both load these via
  // dynamic import() specifically so the code path isn't statically analyzed
  // by the bundler either — belt-and-suspenders with this config entry, not
  // a substitute for it.
  serverExternalPackages: ['pptxgenjs', '@napi-rs/canvas', 'pdfjs-dist', 'puppeteer-core', '@sparticuz/chromium'],

  // serverExternalPackages alone is frequently NOT sufficient for
  // @sparticuz/chromium on Vercel specifically — its runtime assets
  // (bin/chromium.br, bin/fonts.tar.br, bin/swiftshader.tar.br,
  // bin/al2023.tar.br) are large, compressed, non-JS files that Next.js's
  // default output file tracing frequently fails to detect as "reachable"
  // from the route that needs them, since they're only ever read via a
  // dynamically-constructed path at runtime (chromium.executablePath()),
  // not a static require/import the tracer can follow.
  // outputFileTracingIncludes tells Next.js explicitly which extra files
  // to bundle into a given route's deployed serverless function.
  //
  // pptxgenjs needs the equivalent treatment for a different reason: it's
  // loaded via createRequire(process.cwd() + '/_') (see
  // artifact-export-pptx.ts's own header for why — avoiding an ESM/CJS
  // dual-package hazard in its dependency jszip), and a createRequire()
  // call whose argument is a RUNTIME-COMPUTED STRING is invisible to
  // @vercel/nft's static file tracer entirely — unlike
  // @sparticuz/chromium/puppeteer-core, which use a literal
  // `await import('pkg-name')` the tracer CAN follow on its own.
  //
  // FUNCTION-SIZE SPLIT (this fix): these used to all live under one
  // '/api/artifact/export' key because every format was one route/one
  // function. Bundling Chromium (~70MB) + puppeteer-core + the full
  // pptxgenjs/jszip tree into that single function is what pushed it over
  // Vercel's 250MB uncompressed function-size limit — the build always
  // succeeded, but the deployment itself failed right after, during
  // "Deploying outputs...". Now that pdf/pptx/png are separate routes
  // (see lib/artifact-export-request.ts), each gets ONLY the includes it
  // actually needs: pdf and png both render via headless Chromium
  // (artifact-export-pdf.ts, artifact-export-image.ts) and need the
  // chromium bin/ glob; pptx needs the pptxgenjs/jszip globs and nothing
  // Chromium-related. Splitting these keeps each function's uncompressed
  // size well clear of the 250MB ceiling instead of stacking all three
  // dependency trees into one bundle.
  //
  // pnpm detail (unchanged from the original single-route fix, still
  // applies per-package here): pnpm gives each resolved package its own
  // ISOLATED node_modules directory
  // (node_modules/.pnpm/<pkg>@<version>/node_modules/) containing the
  // package itself PLUS symlinks to its direct dependencies as siblings,
  // not descendants — so a glob must target that isolated directory one
  // level up from the package folder, not the package folder itself, or
  // transitive deps (e.g. jszip's 'setimmediate', 'lie', 'pako',
  // 'readable-stream') go missing at runtime with "Cannot find module".
  // Versions are pinned, not wildcarded ('pkg@4.0.1', not 'pkg@*') —
  // Vercel's build pipeline (Turbopack) does not resolve a wildcard
  // embedded inside a path segment the way local `next build` does, and
  // treats e.g. 'pptxgenjs@*' as a literal, nonexistent directory name
  // (ENOENT) rather than a pattern. MAINTENANCE NOTE: bumping pptxgenjs,
  // jszip, or any of their listed dependencies requires updating the
  // pinned version segment below to match, or this exact failure mode
  // returns. Versions below match pnpm-lock.yaml as of this fix:
  //   pptxgenjs@4.0.1, image-size@1.2.1, queue@6.0.2, jszip@3.10.1,
  //   lie@3.3.0, readable-stream@2.3.8
  outputFileTracingIncludes: {
    '/api/artifact/export/pdf': [
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/artifact/export/png': [
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    // canva's fallback path (lib/canva-export.ts) renders a PDF under the
    // hood via the same artifact-export-pdf.ts renderer pdf/route.ts uses
    // — needs the same Chromium bin/ assets for the same reason.
    '/api/artifact/export/canva': [
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/artifact/export/pptx': [
      '../../node_modules/.pnpm/pptxgenjs@4.0.1/node_modules/**',
      '../../node_modules/.pnpm/image-size@1.2.1/node_modules/**',
      '../../node_modules/.pnpm/queue@6.0.2/node_modules/**',
      '../../node_modules/.pnpm/jszip@3.10.1/node_modules/**',
      '../../node_modules/.pnpm/lie@3.3.0/node_modules/**',
      '../../node_modules/.pnpm/readable-stream@2.3.8/node_modules/**',
    ],
  },

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


