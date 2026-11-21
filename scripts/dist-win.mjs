#!/usr/bin/env node
/**
 * Build Windows desktop artifacts via electron-builder.
 *
 * electron-builder rewrites package.json while packaging (extraMetadata).
 * If the build aborts mid-flight (e.g. Wine missing for NSIS on Linux), that
 * rewrite can be left behind — so we snapshot + restore package.json here.
 *
 * Usage: node scripts/dist-win.mjs [--dir] [extra electron-builder args…]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')
const snapshot = fs.readFileSync(pkgPath)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
    },
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

let status = 1
try {
  status = run('npm', ['run', 'desktop:dist:prepare'])
  if (status !== 0) process.exit(status)

  const extra = process.argv.slice(2)
  const builderArgs = ['electron-builder', '--win', '--x64', ...extra]
  status = run('npx', builderArgs)
} finally {
  fs.writeFileSync(pkgPath, snapshot)
  // Confirm restore landed (helps catch future electron-builder races).
  if (fs.readFileSync(pkgPath).equals(snapshot) === false) {
    console.error('[dist-win] failed to restore package.json')
    process.exit(1)
  }
}

process.exit(status)
