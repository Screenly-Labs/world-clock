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
import { run as syncFonts } from './sync-fonts.ts'

const DIST = 'dist'

// Vendor the Bun-managed webfonts into ./assets/fonts before copying them on.
await syncFonts()

// Start from a clean dist so removed files never linger in a deploy.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/styles`, { recursive: true })

// Bundle main.ts (which imports clocks.ts) into a single minified ES module.
const js = await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: DIST,
  minify: true,
  target: 'browser',
  format: 'esm',
  naming: '[name].js'
})
if (!js.success) {
  console.error('✗ JS build failed')
  for (const log of js.logs) console.error(log)
  process.exit(1)
}
console.log(`✓ JS: ${DIST}/main.js`)

// Minify the CSS in place under dist. external: ['*'] leaves url(../fonts/...)
// references untouched rather than trying to resolve them as build-time assets.
const css = await Bun.build({
  entrypoints: ['assets/styles/main.css'],
  outdir: `${DIST}/styles`,
  minify: true,
  external: ['*']
})
if (!css.success) {
  console.error('✗ CSS build failed')
  for (const log of css.logs) console.error(log)
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

// Disable Jekyll so Pages serves the files exactly as built (no underscore
// handling, no Markdown processing).
await Bun.write(`${DIST}/.nojekyll`, '')
console.log(`✓ ${DIST}/.nojekyll`)

console.log('Build complete — static site written to ./dist')
