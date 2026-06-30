#!/usr/bin/env bun
// Local dev server for testing the static build on the LAN. It builds the site
// once, serves ./dist on 0.0.0.0 (so other devices on the network can reach it),
// and rebuilds whenever a source file changes. This is a dev convenience only —
// production is the static ./dist published to GitHub Pages, never this server.

import { watch } from 'node:fs'

const PORT = Number(Bun.env.PORT ?? 8080)
const DIST = `${import.meta.dir}/dist`
const WATCH_DIRS = ['src', 'assets']
const WATCH_FILES = ['index.html', 'build.ts', 'sync-fonts.ts']

const build = async (): Promise<void> => {
  const proc = Bun.spawn(['bun', 'run', 'build.ts'], {
    cwd: import.meta.dir,
    stdout: 'inherit',
    stderr: 'inherit'
  })
  await proc.exited
}

await build()

// Debounced rebuild so a burst of editor saves triggers a single build.
let pending: ReturnType<typeof setTimeout> | undefined
const scheduleBuild = (): void => {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    console.log('↻ change detected — rebuilding…')
    void build()
  }, 120)
}

for (const dir of WATCH_DIRS) {
  watch(`${import.meta.dir}/${dir}`, { recursive: true }, scheduleBuild)
}
for (const file of WATCH_FILES) {
  watch(`${import.meta.dir}/${file}`, scheduleBuild)
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  svg: 'image/svg+xml'
}

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url)
    let path = decodeURIComponent(url.pathname)
    if (path === '/' || path.endsWith('/')) path += 'index.html'
    const file = Bun.file(DIST + path)
    if (await file.exists()) {
      const ext = path.split('.').pop() ?? ''
      const headers = MIME[ext] ? { 'Content-Type': MIME[ext] } : undefined
      return new Response(file, { headers })
    }
    return new Response('Not found', { status: 404 })
  }
})

console.log(`\nWorld Clock dev server`)
console.log(`  local:   http://localhost:${server.port}/`)
console.log(`  network: http://0.0.0.0:${server.port}/  (reachable on your LAN IP)`)
console.log(
  `Watching ${[...WATCH_DIRS, ...WATCH_FILES].join(', ')} — edits rebuild automatically.\n`
)
