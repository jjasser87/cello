#!/usr/bin/env node
/**
 * Ensure Electron's downloaded binary exists before `npm run desktop`.
 *
 * Failure modes this guards against:
 * 1. npm 12+ `allowScripts` skipped electron's postinstall (no path.txt / dist).
 * 2. `ELECTRON_SKIP_BINARY_DOWNLOAD` — install.js exits 0 without fetching.
 * 3. Windows extract-zip bugs / AV interference — download+checksum OK but
 *    electron.exe never lands; path.txt may also be missing. Fallback: re-extract
 *    the cached zip with PowerShell Expand-Archive (or unzip/tar elsewhere).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const pathTxt = path.join(electronDir, 'path.txt')
const distDir = path.join(electronDir, 'dist')
const installJs = path.join(electronDir, 'install.js')
const pkgJson = path.join(electronDir, 'package.json')

function platformExecutableRel() {
  // Match electron/install.js path.txt values (forward slashes on macOS).
  const platform = process.env.npm_config_platform || process.platform
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`)
  }
}

function binaryPath() {
  return path.join(distDir, platformExecutableRel())
}

function electronReady() {
  if (!fs.existsSync(pathTxt)) return false
  const rel = fs.readFileSync(pathTxt, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!rel) return false
  // Accept either path.txt target or the canonical platform binary.
  if (fs.existsSync(path.join(distDir, ...rel.split(/[/\\]/)))) return true
  return fs.existsSync(binaryPath())
}

function diagnose() {
  const rel = fs.existsSync(pathTxt)
    ? fs.readFileSync(pathTxt, 'utf8').replace(/^\uFEFF/, '').trim()
    : '(missing)'
  const bin = binaryPath()
  const distEntries = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).slice(0, 12).join(', ')
    : '(no dist/)'
  return [
    `  path.txt: ${fs.existsSync(pathTxt) ? rel : '(missing)'}`,
    `  binary:   ${bin} ${fs.existsSync(bin) ? '(ok)' : '(missing)'}`,
    `  dist/:    ${distEntries}`,
    `  skip env: ${process.env.ELECTRON_SKIP_BINARY_DOWNLOAD ? 'ELECTRON_SKIP_BINARY_DOWNLOAD is set' : 'unset'}`,
  ].join('\n')
}

function electronCacheDir() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache
  if (process.env.npm_config_electron_config_cache) {
    return process.env.npm_config_electron_config_cache
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'electron',
      'Cache',
    )
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'electron')
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron')
}

function cachedElectronZip(version) {
  const platform = process.env.npm_config_platform || process.platform
  const arch = process.env.npm_config_arch || process.arch
  const want = `electron-v${version}-${platform}-${arch}.zip`
  const rootCache = electronCacheDir()
  let best = null
  try {
    for (const sub of fs.readdirSync(rootCache)) {
      const file = path.join(rootCache, sub, want)
      if (!fs.existsSync(file)) continue
      const mtime = fs.statSync(file).mtimeMs
      if (!best || mtime > best.mtime) best = { file, mtime }
    }
  } catch {
    return null
  }
  return best?.file ?? null
}

function wipeIncomplete() {
  fs.rmSync(distDir, { recursive: true, force: true })
  fs.rmSync(pathTxt, { force: true })
}

function writePathTxt() {
  // Electron's install.js writes with no trailing newline; match that.
  fs.writeFileSync(pathTxt, platformExecutableRel())
}

function expandArchiveWindows(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true })
  // Pass paths via env vars so apostrophes in user paths cannot break -Command.
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:CELLO_ELECTRON_ZIP -DestinationPath $env:CELLO_ELECTRON_DEST -Force',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        CELLO_ELECTRON_ZIP: zipPath,
        CELLO_ELECTRON_DEST: dest,
      },
    },
  )
  return result.status === 0
}

function expandArchiveUnix(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const unzip = spawnSync('unzip', ['-oq', zipPath, '-d', dest], { stdio: 'inherit' })
  if (unzip.status === 0) return true
  const tar = spawnSync('tar', ['-xf', zipPath, '-C', dest], { stdio: 'inherit' })
  return tar.status === 0
}

function extractZip(zipPath) {
  console.warn(`Extracting Electron zip → ${distDir}`)
  console.warn(`  zip: ${zipPath}`)
  wipeIncomplete()
  const ok =
    process.platform === 'win32'
      ? expandArchiveWindows(zipPath, distDir)
      : expandArchiveUnix(zipPath, distDir)
  if (!ok) return false
  writePathTxt()
  return electronReady()
}

function installEnv() {
  const env = { ...process.env }
  // install.js exits 0 immediately when this is set — that leaves path.txt missing.
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  return env
}

async function downloadZip(version) {
  const require = createRequire(pkgJson)
  const { downloadArtifact } = require('@electron/get')
  const platform = process.env.npm_config_platform || process.platform
  const arch = process.env.npm_config_arch || process.arch
  console.warn(`Downloading Electron ${version} (${platform}-${arch}) via @electron/get…`)
  return downloadArtifact({
    version,
    artifactName: 'electron',
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    platform,
    arch,
  })
}

function recoveryHelp() {
  return `
Electron binary is still missing after repair attempts:
${diagnose()}

PowerShell recovery (Windows):

  # Clear skip flag if present (common in corporate / CI shells)
  Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue

  # Re-approve install scripts (npm 12+) and reinstall the electron package
  npm install-scripts approve --no-allow-scripts-pin electron esbuild
  Remove-Item -Recurse -Force node_modules\\electron -ErrorAction SilentlyContinue
  npm install
  npm run desktop:install
  npm run desktop

  # If desktop:install still fails, extract the cached zip manually:
  #   $zip = Get-ChildItem -Recurse "$env:LOCALAPPDATA\\electron\\Cache\\electron-v*-win32-*.zip" |
  #     Sort-Object LastWriteTime -Descending | Select-Object -First 1
  #   New-Item -ItemType Directory -Force node_modules\\electron\\dist | Out-Null
  #   Expand-Archive -LiteralPath $zip.FullName -DestinationPath node_modules\\electron\\dist -Force
  #   Set-Content -Path node_modules\\electron\\path.txt -Value 'electron.exe' -NoNewline

Optional: set a mirror if GitHub releases are blocked:
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
`
}

async function main() {
  if (!fs.existsSync(pkgJson)) {
    console.error('electron is not installed. From the repo root run:\n  npm install')
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

  const { version } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))

  // Binary on disk but path.txt missing/stale — common after a partial extract.
  if (fs.existsSync(binaryPath())) {
    writePathTxt()
    if (electronReady()) {
      console.warn('Rewrote path.txt to point at the existing Electron binary.')
      process.exit(0)
    }
  }

  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    console.warn(
      'ELECTRON_SKIP_BINARY_DOWNLOAD is set; ignoring it for desktop:install so the binary can be fetched.',
    )
  }

  console.warn(
    'Electron binary missing (postinstall skipped, extract failed, or skip-download set). Repairing…',
  )

  wipeIncomplete()

  const result = spawnSync(process.execPath, [installJs], {
    cwd: electronDir,
    stdio: 'inherit',
    env: installEnv(),
  })

  if (result.error) {
    console.error(result.error)
  }

  if (electronReady()) {
    process.exit(0)
  }

  if (result.status !== 0) {
    console.warn(
      `electron/install.js exited with status ${result.status ?? 'null'}; trying cache / download fallback…`,
    )
  } else {
    console.warn(
      'electron/install.js exited 0 but path.txt / binary are still missing (known Windows extract-zip / AV issue). Trying cache re-extract…',
    )
  }

  let zip = cachedElectronZip(version)
  if (!zip) {
    try {
      zip = await downloadZip(version)
    } catch (err) {
      console.error(err?.stack || err)
      console.error(recoveryHelp())
      process.exit(1)
    }
  } else {
    console.warn(`Found cached Electron zip:\n  ${zip}`)
  }

  if (!extractZip(zip) || !electronReady()) {
    console.error(recoveryHelp())
    process.exit(1)
  }

  console.warn('Electron binary restored.')
}

main().catch((err) => {
  console.error(err?.stack || err)
  console.error(recoveryHelp())
  process.exit(1)
})
