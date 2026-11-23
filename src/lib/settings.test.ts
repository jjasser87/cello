import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'

/**
 * Node doesn't have localStorage; stub a minimal in-memory store for settings.
 */
function installMemoryStorage() {
  const map = new Map<string, string>()
  const storage = {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
    removeItem(key: string) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
  return storage
}

describe('app settings', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  afterEach(() => {
    // @ts-expect-error cleanup stub
    delete globalThis.localStorage
  })

  it('defaults helperDock to right and rscriptPath to null', async () => {
    const { loadSettings } = await import('./settings.ts')
    assert.deepEqual(loadSettings(), { rscriptPath: null, helperDock: 'right' })
  })

  it('persists and restores helperDock', async () => {
    const { loadSettings, saveSettings } = await import('./settings.ts')
    const saved = saveSettings({ helperDock: 'bottom' })
    assert.equal(saved.helperDock, 'bottom')
    assert.equal(loadSettings().helperDock, 'bottom')
    saveSettings({ helperDock: 'top' })
    assert.equal(loadSettings().helperDock, 'top')
    saveSettings({ helperDock: 'left' })
    assert.equal(loadSettings().helperDock, 'left')
  })

  it('rejects unknown dock values', async () => {
    const { loadSettings, isHelperDock } = await import('./settings.ts')
    assert.equal(isHelperDock('sideways'), false)
    localStorage.setItem('cello.settings.v0', JSON.stringify({ helperDock: 'nope' }))
    assert.equal(loadSettings().helperDock, 'right')
  })

  it('keeps rscriptPath when updating dock', async () => {
    const { loadSettings, saveSettings } = await import('./settings.ts')
    saveSettings({ rscriptPath: '/opt/R/bin/Rscript' })
    saveSettings({ helperDock: 'left' })
    assert.deepEqual(loadSettings(), {
      rscriptPath: '/opt/R/bin/Rscript',
      helperDock: 'left',
    })
  })
})
