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

// Bundle the JS and minify the CSS concurrently — they share no inputs, so
// running them in parallel keeps the hot rebuild path short.
//   JS:  bundle main.ts (which imports clocks.ts) into one minified ES module.
//   CSS: minify; external: ['*'] leaves url(../fonts/...) refs untouched rather
//        than trying to resolve them as build-time assets.
const [js, css] = await Promise.all([
  Bun.build({
    entrypoints: ['src/main.ts'],
    outdir: DIST,
    minify: true,
    target: 'browser',
    format: 'esm',
    naming: '[name].js'
  }),
  Bun.build({
    entrypoints: ['assets/styles/main.css'],
    outdir: `${DIST}/styles`,
    minify: true,
    external: ['*']
  })
])
for (const { label, result, out } of [
  { label: 'JS', result: js, out: `${DIST}/main.js` },
  { label: 'CSS', result: css, out: `${DIST}/styles/main.css` }
]) {
  if (!result.success) {
    console.error(`✗ ${label} build failed`)
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`✓ ${label}: ${out}`)
}

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
