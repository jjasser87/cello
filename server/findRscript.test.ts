import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findRscript } from './findRscript.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('findRscript', () => {
  it('never spawns a shell (source contract)', () => {
    const host = readFileSync(path.join(ROOT, 'server', 'rKernelHost.ts'), 'utf8')
    const finder = readFileSync(path.join(ROOT, 'server', 'findRscript.ts'), 'utf8')
    for (const src of [host, finder]) {
      assert.equal(/spawn\(\s*['"]bash['"]/.test(src), false)
      assert.equal(/spawn\(\s*['"]sh['"]/.test(src), false)
      assert.equal(/spawn\(\s*['"]cmd(?:\.exe)?['"]/.test(src), false)
      assert.equal(/command -v Rscript/.test(src), false)
    }
    assert.match(host, /findRscript/)
  })

  it('resolves Rscript from PATH on POSIX without a shell', async () => {
    const found = await findRscript({
      platform: 'linux',
      env: { PATH: '/opt/custom/bin:/usr/bin' },
      pathExists: async (target) => target === '/opt/custom/bin/Rscript',
    })
    assert.equal(found, '/opt/custom/bin/Rscript')
  })

  it('resolves Rscript.exe from Windows PATH without bash', async () => {
    const found = await findRscript({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32;C:\\Program Files\\R\\R-4.3.3\\bin',
        ProgramFiles: 'C:\\Program Files',
      },
      pathExists: async (target) =>
        target === 'C:\\Program Files\\R\\R-4.3.3\\bin\\Rscript.exe',
      listDir: async () => [],
    })
    assert.equal(found, 'C:\\Program Files\\R\\R-4.3.3\\bin\\Rscript.exe')
  })

  it('falls back to Program Files\\R\\*\\bin on Windows', async () => {
    const found = await findRscript({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32',
        ProgramFiles: 'C:\\Program Files',
      },
      pathExists: async (target) =>
        target === 'C:\\Program Files\\R\\R-4.4.1\\bin\\x64\\Rscript.exe',
      listDir: async (dir) => {
        if (dir === 'C:\\Program Files\\R') return ['R-4.3.3', 'R-4.4.1']
        return []
      },
    })
    assert.equal(found, 'C:\\Program Files\\R\\R-4.4.1\\bin\\x64\\Rscript.exe')
  })

  it('returns null when Rscript is missing (soft miss, no throw)', async () => {
    const found = await findRscript({
      platform: 'win32',
      env: { PATH: 'C:\\Windows\\System32', ProgramFiles: 'C:\\Program Files' },
      pathExists: async () => false,
      listDir: async () => [],
    })
    assert.equal(found, null)
  })

  it('honors explicit override and skips PATH on miss', async () => {
    const found = await findRscript({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      override: '/custom/bin/Rscript',
      pathExists: async (target) => target === '/custom/bin/Rscript',
    })
    assert.equal(found, '/custom/bin/Rscript')

    const missing = await findRscript({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      override: '/missing/Rscript',
      pathExists: async (target) => target === '/usr/bin/Rscript',
    })
    assert.equal(missing, null)
  })

  it('honors CELLO_RSCRIPT when override is empty', async () => {
    const found = await findRscript({
      platform: 'linux',
      env: { PATH: '/usr/bin', CELLO_RSCRIPT: '/opt/R/bin/Rscript' },
      pathExists: async (target) => target === '/opt/R/bin/Rscript',
    })
    assert.equal(found, '/opt/R/bin/Rscript')

    const ignored = await findRscript({
      platform: 'linux',
      env: { PATH: '/usr/bin', CELLO_RSCRIPT: '/opt/R/bin/Rscript' },
      honorEnv: false,
      pathExists: async (target) => target === '/usr/bin/Rscript',
    })
    assert.equal(ignored, '/usr/bin/Rscript')
  })

  it('simulates missing bash: lookup still succeeds via PATH walk', async () => {
    // Regression for spawn bash ENOENT — lookup must not need any shell binary.
    const shellBinaries = new Set([
      '/bin/bash',
      '/usr/bin/bash',
      'bash',
      'C:\\Windows\\System32\\bash.exe',
    ])
    const probed: string[] = []
    const found = await findRscript({
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      pathExists: async (target) => {
        probed.push(target)
        assert.equal(shellBinaries.has(target), false, `must not probe shell: ${target}`)
        return target === '/usr/local/bin/Rscript'
      },
    })
    assert.equal(found, '/usr/local/bin/Rscript')
    assert.ok(probed.includes('/usr/local/bin/Rscript'))
    assert.ok(!probed.some((p) => /bash|cmd\.exe|\bsh\b/.test(p)))
  })
})
