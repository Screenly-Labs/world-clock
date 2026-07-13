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
import { bundleJs, injectGate, processCss } from '@screenly-labs/signage-kit/build'
import { run as syncFonts } from './sync-fonts.ts'

const DIST = 'dist'

// Vendor the Bun-managed webfonts into ./assets/fonts before copying them on.
await syncFonts()

// Start from a clean dist so removed files never linger in a deploy.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/styles`, { recursive: true })

// JS: kit bundler, format:'esm' so the page keeps loading it with
// <script type="module">. CSS: kit pipeline with the shared kill-switch prepended
// (the app's own @supports container-query fallback + .anim reveal stay in the CSS).
try {
  await bundleJs('src/main.ts', `${DIST}/main.js`, { format: 'esm' })
} catch (error) {
  console.error('✗ JS build failed')
  console.error(error)
  process.exit(1)
}
console.log(`✓ JS: ${DIST}/main.js`)

try {
  const css = await processCss(await Bun.file('assets/styles/main.css').text(), {
    includeDegraded: true,
    filename: 'assets/styles/main.css'
  })
  await Bun.write(`${DIST}/styles/main.css`, css)
} catch (error) {
  console.error('✗ CSS build failed')
  console.error(error)
  process.exit(1)
}
console.log(`✓ CSS: ${DIST}/styles/main.css`)

// Copy the HTML shell (with the shared degraded-mode gate injected) and the fonts.
await Bun.write(`${DIST}/index.html`, injectGate(await Bun.file('index.html').text()))
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
