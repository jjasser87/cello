#!/usr/bin/env node
/**
 * Ensure Electron's downloaded binary exists before `npm run desktop`.
 *
 * npm 12+ blocks dependency install scripts unless listed in package.json
 * `allowScripts`. If electron's postinstall was skipped, `path.txt` / `dist/`
 * are missing and `electron .` throws "Electron failed to install correctly".
 *
 * This script re-runs electron's own install.js (not via npm lifecycle), so it
 * still repairs a broken tree even when the user has not yet approved scripts —
 * as long as the electron package itself is present under node_modules.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const pathTxt = path.join(electronDir, 'path.txt')
const installJs = path.join(electronDir, 'install.js')

function electronReady() {
  if (!fs.existsSync(pathTxt)) return false
  const rel = fs.readFileSync(pathTxt, 'utf8').trim()
  if (!rel) return false
  return fs.existsSync(path.join(electronDir, 'dist', rel))
}

if (!fs.existsSync(path.join(electronDir, 'package.json'))) {
  console.error(
    'electron is not installed. From the repo root run:\n  npm install',
  )
  process.exit(1)
}

if (electronReady()) {
  process.exit(0)
}

if (!fs.existsSync(installJs)) {
  console.error(
    'node_modules/electron/install.js is missing. Reinstall dependencies:\n  npm install',
  )
  process.exit(1)
}

console.warn(
  'Electron binary missing (postinstall likely skipped). Running electron/install.js…',
)

const result = spawnSync(process.execPath, [installJs], {
  cwd: electronDir,
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0) {
  console.error(`
Electron binary install failed.

On npm 12+, approve install scripts once (committed allowScripts should already
cover this after you pull), then rebuild:

  npm install-scripts approve --no-allow-scripts-pin electron esbuild
  Remove-Item -Recurse -Force node_modules\\electron   # PowerShell
  # rm -rf node_modules/electron                      # bash / zsh
  npm install
`)
  process.exit(result.status ?? 1)
}

if (!electronReady()) {
  console.error(
    'Electron install finished but path.txt / dist binary are still missing.',
  )
  process.exit(1)
}
