#!/usr/bin/env bun
// Builds the fully static site into ./dist for GitHub Pages. There is no server
// and no framework: this bundles the TypeScript to one ES module, minifies the
// CSS, and copies the HTML shell + vendored fonts. The output is plain files
// that Pages serves as-is.
//
// Paths in index.html / main.css are RELATIVE (./main.js, ../fonts/...), so the
// site works unchanged whether it is served from a domain root or from a
// project subpath like https://<org>.github.io/world-clock/.

import { cp, mkdir, rm } from 'node:fs/promises'
import browserslist from 'browserslist'
import { build as esbuild } from 'esbuild'
import { browserslistToTargets, transform as lightningcss } from 'lightningcss'
import { run as syncFonts } from './sync-fonts.ts'

const DIST = 'dist'

// The `browserslist` field in package.json is the CSS support floor: Lightning
// CSS down-levels the stylesheet to it. The JS is lowered separately by esbuild to
// a fixed ES2017 syntax floor (kept at/below the browserslist minimum); esbuild
// can't read browserslist, so keep the two in sync if you change the floor. See
// the degraded-mode notes in index.html / main.css.
const cssTargets = browserslistToTargets(browserslist())

// Vendor the Bun-managed webfonts into ./assets/fonts before copying them on.
await syncFonts()

// Start from a clean dist so removed files never linger in a deploy.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/styles`, { recursive: true })

// JS:  esbuild bundles main.ts (inlining clocks.ts + the polyfills shim) into one
//      minified ES module and lowers modern syntax (?., ??, spread) to the ES2017
//      floor so old signage players can parse it. Kept as an ES module (the page
//      still loads it with <script type="module">, supported at the floor); only
//      the syntax level changes.
// CSS: Lightning CSS down-levels to the browserslist floor and minifies;
//      url(../fonts/...) refs are left untouched.
try {
  await esbuild({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2017'],
    outfile: `${DIST}/main.js`
  })
} catch (error) {
  console.error('✗ JS build failed')
  console.error(error)
  process.exit(1)
}
console.log(`✓ JS: ${DIST}/main.js`)

try {
  const { code: cssCode } = lightningcss({
    filename: 'assets/styles/main.css',
    code: await Bun.file('assets/styles/main.css').bytes(),
    minify: true,
    targets: cssTargets
  })
  await Bun.write(`${DIST}/styles/main.css`, cssCode)
} catch (error) {
  console.error('✗ CSS build failed')
  console.error(error)
  process.exit(1)
}
console.log(`✓ CSS: ${DIST}/styles/main.css`)

// Copy the HTML shell and the vendored fonts verbatim.
await Bun.write(`${DIST}/index.html`, Bun.file('index.html'))
console.log(`✓ HTML: ${DIST}/index.html`)

await cp('assets/fonts', `${DIST}/fonts`, { recursive: true })
console.log(`✓ Fonts: ${DIST}/fonts/`)

// Brand assets (the Screenly logo lockup).
await cp('assets/images', `${DIST}/images`, { recursive: true })
console.log(`✓ Images: ${DIST}/images/`)

// The self-describing signage-app manifest. Served verbatim at the well-known
// path (schema documented in the separate Screenly-Labs/app-store repository,
// docs/app-manifest.md) so the app store and players can read
// this app's config surface. GitHub Pages serves it as application/json with
// Access-Control-Allow-Origin: * (all Pages responses), and the .nojekyll marker
// keeps the dot-prefixed directory from being skipped.
await cp('.well-known', `${DIST}/.well-known`, { recursive: true })
console.log(`✓ Manifest: ${DIST}/.well-known/signage-app.json`)

// Disable Jekyll so Pages serves the files exactly as built (no underscore
// handling, no Markdown processing).
await Bun.write(`${DIST}/.nojekyll`, '')
console.log(`✓ ${DIST}/.nojekyll`)

console.log('Build complete — static site written to ./dist')
