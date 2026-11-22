import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Lightweight contract tests for desktop fit helpers.
 * DOM measurement runs in the browser/Electron; here we only guard exports.
 */
describe('desktop module contract', () => {
  it('exports measure and detection helpers', async () => {
    // Dynamic import keeps this file free of jsdom in node:test.
    const mod = await import('./desktop.ts')
    assert.equal(typeof mod.getDesktopApi, 'function')
    assert.equal(typeof mod.isDesktopShell, 'function')
    assert.equal(typeof mod.markDesktopDocument, 'function')
    assert.equal(typeof mod.measureDesktopFitSize, 'function')
  })

  it('reports no desktop API outside Electron', async () => {
    const mod = await import('./desktop.ts')
    assert.equal(mod.getDesktopApi(), null)
    assert.equal(mod.isDesktopShell(), false)
  })
})
