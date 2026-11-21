import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveKernelPaths } from './rKernelHost.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('resolveKernelPaths', () => {
  it('defaults to repo kernel/r paths', () => {
    const paths = resolveKernelPaths()
    assert.equal(paths.root, ROOT)
    assert.equal(paths.worker, path.join(ROOT, 'kernel', 'r', 'worker.R'))
    assert.equal(paths.libDir, path.join(ROOT, 'kernel', 'r', '.lib'))
  })

  it('accepts packaged-style overrides (resources worker + userData lib)', () => {
    const root = path.join(ROOT, 'packaged-app')
    const worker = path.join(ROOT, 'resources', 'kernel', 'r', 'worker.R')
    const libDir = path.join(ROOT, 'user-data', 'r-lib')
    const paths = resolveKernelPaths({ root, workerPath: worker, libDir })
    assert.equal(paths.root, root)
    assert.equal(paths.worker, worker)
    assert.equal(paths.libDir, libDir)
  })
})
