// Prove the bug in a real browser. For each runtime state, patch the vue prod
// browser build on disk, `astro build` the site, serve dist/, and drive headless
// Chromium against the hydrated island:
//
//   unpatched            prod runtime, stock        → DEAD   (bug #1)
//   #1 only              prod runtime, handleSetupResult fixed → alive, ref null (bug #1b)
//   #1 + #1b (full)      prod runtime, both fixed    → alive, ref ok
//   dev runtime (control) dev runtime, same codegen  → alive, ref ok
//
// The state is toggled with the transforms in patch.mjs (the same edits the
// shipped patch applies), so this proves the exact thing pnpm installs. The vue
// build is backed up and restored. Run after `pnpm install`:  pnpm verify
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'
import { applyFix1, applyFix1b, toUnpatched, VUE_PROD_BROWSER_BUILD } from './patch.mjs'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const require = createRequire(import.meta.url)
const VUE_FILE = require.resolve(VUE_PROD_BROWSER_BUILD)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

function serve(root) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0])
    const f = normalize(join(root, p === '/' ? '/index.html' : p))
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' })
    res.end(readFileSync(f))
  })
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => r({ port: server.address().port, close: () => server.close() })),
  )
}

function buildAstro(env) {
  rmSync(DIST, { recursive: true, force: true })
  rmSync(join(ROOT, '.astro'), { recursive: true, force: true })
  const r = spawnSync('pnpm', ['exec', 'astro', 'build'], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`astro build failed:\n${r.stdout}\n${r.stderr}`)
}

// Drive the built site: read the counter, click it, read the template-ref probe.
async function probe() {
  const srv = await serve(DIST)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle' })
    // Wait for the integration's post-mount signal (set even when the island
    // hydrates dead), with a short fallback so a hard crash can't hang.
    await page.waitForSelector('[data-vapor-hydrated]', { timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(150)
    const btn = page.locator('button')
    if ((await btn.count()) === 0) return { before: null, after: null, evtclick: null, ref: null, error: errors[0] || 'no button' }
    const before = (await btn.textContent())?.trim()
    const evtclick = await btn.evaluate((el) => typeof el.$evtclick)
    await btn.click()
    await page.waitForTimeout(120)
    const after = (await btn.textContent())?.trim()
    const ref = (await page.locator('[data-ref-probe]').textContent())?.trim()
    return { before, after, evtclick, ref, error: errors[0] || null }
  } finally {
    await browser.close()
    srv.close()
  }
}

// An island is alive when the click handler landed and the click was reactive.
const alive = (r) => r.evtclick === 'function' && r.before !== r.after && !r.error
const refOk = (r) => /ref-ok$/.test(r.ref || '')

const base = toUnpatched(readFileSync(VUE_FILE, 'utf8'))
const states = [
  { label: 'unpatched            prod runtime, stock', src: base, env: {}, ok: (r) => !alive(r) && r.evtclick === 'undefined' && !refOk(r) },
  { label: '#1 only              prod runtime, handleSetupResult fixed', src: applyFix1(base), env: {}, ok: (r) => alive(r) && /ref-null$/.test(r.ref || '') },
  { label: '#1 + #1b (full)      prod runtime, both fixed', src: applyFix1b(applyFix1(base)), env: {}, ok: (r) => alive(r) && refOk(r) },
  { label: 'dev runtime          control, same codegen', src: base, env: { VAPOR_FORCE_DEV_RUNTIME: '1' }, ok: (r) => alive(r) && refOk(r) },
]

const original = readFileSync(VUE_FILE)
let ok = true
try {
  for (const s of states) {
    writeFileSync(VUE_FILE, s.src)
    buildAstro(s.env)
    const r = await probe()
    const pass = s.ok(r)
    ok &&= pass
    const tail = r.error ? `  error=${r.error.split('\n')[0]}` : ''
    console.log(`${pass ? '✓' : '✗'} ${s.label}`)
    console.log(`    "${r.before}" -> "${r.after}"  $evtclick=${r.evtclick}  ${r.ref}${tail}`)
  }
} finally {
  writeFileSync(VUE_FILE, original)
}

console.log(
  ok
    ? '\nReproduced: under the production runtime the non-inline Vapor island Astro emits hydrates dead (bug #1); the handleSetupResult fix revives it but the template ref stays null (bug #1b); both fixes give a live island with a resolved ref. The dev runtime runs the same codegen fine.'
    : '\nUnexpected result.',
)
process.exit(ok ? 0 : 1)
