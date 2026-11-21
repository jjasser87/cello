import { access, constants, readdir } from 'node:fs/promises'
import path from 'node:path'

export type FindRscriptOptions = {
  /** Override PATH / Path env vars. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /** Override platform. Defaults to process.platform. */
  platform?: NodeJS.Platform
  /**
   * Explicit path to an Rscript binary. When set (non-empty), only this path
   * is considered — no PATH / Program Files fallback on miss.
   */
  override?: string | null
  /**
   * When true (default), honor `CELLO_RSCRIPT` from `env` if `override` is empty.
   * Same no-fallback rule as `override` when the env value is set.
   */
  honorEnv?: boolean
  /**
   * Injected existence check for tests. Defaults to fs.access with execute
   * bit on POSIX and existence on Windows.
   */
  pathExists?: (target: string) => Promise<boolean>
  /**
   * Injected directory listing for Windows Program Files scans (tests).
   */
  listDir?: (dir: string) => Promise<string[]>
}

const POSIX_FALLBACK_DIRS = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

function rscriptBasenames(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['Rscript.exe', 'Rscript.cmd', 'Rscript.bat', 'Rscript']
  }
  return ['Rscript']
}

async function defaultPathExists(target: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (platform === 'win32') {
      await access(target, constants.F_OK)
    } else {
      await access(target, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

async function defaultListDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const raw = env.PATH ?? env.Path ?? ''
  const splitOn = pathApi(platform).delimiter
  return raw
    .split(splitOn)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

function windowsProgramFilesRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = new Set<string>()
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'PROGRAMFILES', 'PROGRAMFILES(X86)']) {
    const value = env[key]
    if (value) roots.add(value)
  }
  // Sensible defaults when env is sparse (e.g. unit tests / odd shells).
  roots.add('C:\\Program Files')
  roots.add('C:\\Program Files (x86)')
  return [...roots]
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * Locate an Rscript binary without spawning a shell.
 * Order: explicit `override` → `CELLO_RSCRIPT` (unless honorEnv=false) → PATH
 * (and a few well-known locations). Never invokes bash/cmd/sh.
 */
export async function findRscript(options: FindRscriptOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathExists =
    options.pathExists ?? ((target: string) => defaultPathExists(target, platform))
  const listDir = options.listDir ?? defaultListDir
  const names = rscriptBasenames(platform)
  const paths = pathApi(platform)

  const explicit =
    (typeof options.override === 'string' ? options.override.trim() : '') ||
    (options.honorEnv === false ? '' : String(env.CELLO_RSCRIPT ?? '').trim())
  if (explicit) {
    return (await pathExists(explicit)) ? explicit : null
  }

  const dirs = pathEntries(env, platform)
  if (platform !== 'win32') {
    for (const fallback of POSIX_FALLBACK_DIRS) {
      if (!dirs.includes(fallback)) dirs.push(fallback)
    }
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = paths.join(dir, name)
      if (await pathExists(candidate)) return candidate
    }
  }

  if (platform === 'win32') {
    for (const root of windowsProgramFilesRoots(env)) {
      const rRoot = paths.join(root, 'R')
      const versions = await listDir(rRoot)
      // Prefer newest-looking version dirs last-first (lexical often works for R-4.x.y).
      const ordered = [...versions].sort().reverse()
      for (const version of ordered) {
        for (const binRel of ['bin', paths.join('bin', 'x64'), paths.join('bin', 'i386')]) {
          for (const name of names) {
            const candidate = paths.join(rRoot, version, binRel, name)
            if (await pathExists(candidate)) return candidate
          }
        }
      }
    }
  }

  return null
}
