// Regenerate patches/vue@3.6.0-beta.17.patch with the pnpm patch workflow and
// wire it via pnpm.patchedDependencies, applying the two edits from patch.mjs to
// the vue prod browser build. Run after a vue bump (then re-point the snippets in
// patch.mjs at the new codegen):  node make-patch.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFix1, applyFix1b, toUnpatched } from './patch.mjs'

const EDIT_DIR = join(process.env.CLAUDE_JOB_DIR || '/tmp', 'vue-patch-edit')
const run = (...args) => {
  const r = spawnSync('pnpm', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

run('patch', 'vue@3.6.0-beta.17', '--edit-dir', EDIT_DIR)
const file = join(EDIT_DIR, 'dist/vue.runtime-with-vapor.esm-browser.prod.js')
writeFileSync(file, applyFix1b(applyFix1(toUnpatched(readFileSync(file, 'utf8')))))
run('patch-commit', EDIT_DIR)
console.log('Wrote patches/vue@3.6.0-beta.17.patch and wired pnpm.patchedDependencies.')
