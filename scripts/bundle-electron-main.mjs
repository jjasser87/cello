#!/usr/bin/env node
/**
 * Bundle Electron main + shared kernel host into a single ESM file for
 * electron-builder packages. Packaged apps must not depend on tsx or raw .ts.
 */
import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = path.join(root, 'electron', 'main-bundle.mjs')

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'electron', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Electron provides its own module; do not bundle it.
  external: ['electron'],
  // Keep Node built-ins external (esbuild default for platform:node).
  sourcemap: true,
  logLevel: 'info',
  // Vite is type-only in the kernel host; never ship it in the desktop bundle.
  packages: 'bundle',
})

console.log(`[bundle-electron-main] wrote ${path.relative(root, outfile)}`)
