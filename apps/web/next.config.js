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
  // bin/al2023.tar.br; verified present in this repo's installed package)
  // are large, compressed, non-JS files that Next.js's default output file
  // tracing frequently fails to detect as "reachable" from the route that
  // needs them, since they're only ever read via a dynamically-constructed
  // path at runtime (chromium.executablePath()), not a static require/import
  // Next.js's tracer can follow. outputFileTracingIncludes tells Next.js
  // explicitly which extra files to bundle into a given route's deployed
  // serverless function, regardless of what static analysis finds. Scoped
  // to only the one route that actually uses puppeteer-core/
  // @sparticuz/chromium (verified: apps/web/app/api/artifact/export/
  // route.ts is the only one, transitively via artifact-export-pdf.ts and
  // artifact-export-image.ts), not applied globally, to avoid bloating
  // every other route's deployed function size unnecessarily.
  // pptxgenjs needs the same outputFileTracingIncludes treatment as
  // @sparticuz/chromium's bin/ assets above, for a related but distinct
  // reason: it is loaded via createRequire(process.cwd() + '/_') (see
  // artifact-export-pptx.ts's own header comment for why — avoiding a real,
  // previously-diagnosed ESM/CJS dual-package hazard in its dependency
  // jszip), and a createRequire() call whose argument is a RUNTIME-COMPUTED
  // STRING is invisible to @vercel/nft's static file tracer entirely —
  // unlike @sparticuz/chromium/puppeteer-core, which use a literal `await
  // import('pkg-name')` the tracer CAN follow. Verified directly: building
  // this app and inspecting the resulting
  // .next/server/app/api/artifact/export/route.js.nft.json trace manifest
  // shows ZERO pptxgenjs files and ZERO jszip files without this entry,
  // despite pptxgenjs being correctly listed in serverExternalPackages —
  // serverExternalPackages controls bundling, not tracing. This is the
  // deployment-side root cause of the production "Cannot find module
  // 'pptxgenjs'" error: local dev/build always has the full node_modules
  // tree regardless of tracing; Vercel's deployed function ships only the
  // traced subset. NOT fixed by switching pptxgenjs to a literal dynamic
  // import() instead — that would reintroduce the exact ESM/CJS jszip
  // failure createRequire() was chosen to avoid. This is a deployment-
  // packaging fix; artifact-export-pptx.ts's loading mechanism is untouched.
  // pptxgenjs needs the same outputFileTracingIncludes treatment as
  // @sparticuz/chromium's bin/ assets above, for a related but distinct
  // reason: it is loaded via createRequire(process.cwd() + '/_') (see
  // artifact-export-pptx.ts's own header comment for why — avoiding a real,
  // previously-diagnosed ESM/CJS dual-package hazard in its dependency
  // jszip), and a createRequire() call whose argument is a RUNTIME-COMPUTED
  // STRING is invisible to @vercel/nft's static file tracer entirely —
  // unlike @sparticuz/chromium/puppeteer-core, which use a literal `await
  // import('pkg-name')` the tracer CAN follow, including their own full
  // transitive dependency trees automatically (confirmed: puppeteer-core
  // alone traced 132 files with no extra config needed).
  //
  // v2 of this fix (the first version only included pptxgenjs/** and
  // jszip/** themselves) — production evidence
  // (Error: Cannot find module 'setimmediate', required from
  // jszip/lib/utils.js) proved that including a package's OWN directory is
  // NOT enough under pnpm's structure. pnpm gives each resolved package its
  // own ISOLATED node_modules directory
  // (node_modules/.pnpm/<pkg>@<version>/node_modules/) containing that
  // package itself PLUS symlinks to exactly its own direct dependencies —
  // sibling entries, not descendants of the package's own folder. A glob
  // like './node_modules/jszip/**' only reaches inside the jszip folder;
  // it does not reach 'setimmediate', 'lie', 'pako', or 'readable-stream',
  // which live one level up, as siblings, inside jszip's OWN isolated
  // node_modules directory. This was proven directly, not assumed: `ls
  // node_modules/.pnpm/jszip@3.10.1/node_modules/` shows exactly
  // [jszip, lie, pako, readable-stream, setimmediate] side by side.
  //
  // The fix: include each PACKAGE'S OWN isolated node_modules directory
  // (one level up from the package folder itself), for every package in
  // the chain that itself has further dependencies — every other package
  // in the tree is then automatically captured as a sibling inside one of
  // these. The full resolved tree below was read directly out of
  // pnpm-lock.yaml (not guessed, not walked one production error at a
  // time): pptxgenjs -> {https, image-size -> {queue -> {inherits}}, jszip
  // -> {lie -> {immediate}, pako, readable-stream -> {core-util-is,
  // isarray, process-nextick-args, safe-buffer, string_decoder,
  // util-deprecate}, setimmediate}}. (@types/node and its own dependency
  // undici-types are pptxgenjs's one other declared dependency — omitted
  // deliberately: they are TypeScript type declarations only, never
  // require()'d at runtime, so they need no entry here.) Every package
  // above with children needs its own glob root; every leaf package is
  // then a sibling inside one of those six directories automatically:
  //   pptxgenjs, image-size, queue, jszip, lie, readable-stream
  // Version numbers are wildcarded (pkg@*) rather than pinned, so a future
  // version bump of any of these (from a routine dependency update) does
  // not silently reintroduce this exact bug by making a pinned path stop
  // matching.
  outputFileTracingIncludes: {
    '/api/artifact/export': [
      './node_modules/@sparticuz/chromium/bin/**',
      '../../node_modules/.pnpm/pptxgenjs@*/node_modules/**',
      '../../node_modules/.pnpm/image-size@*/node_modules/**',
      '../../node_modules/.pnpm/queue@*/node_modules/**',
      '../../node_modules/.pnpm/jszip@*/node_modules/**',
      '../../node_modules/.pnpm/lie@*/node_modules/**',
      '../../node_modules/.pnpm/readable-stream@*/node_modules/**',
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


