import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeWorkerExit } from './rKernelHost.ts'

describe('describeWorkerExit', () => {
  it('prefers stderr when present', () => {
    assert.equal(describeWorkerExit(1, '  boom  '), 'boom')
  })

  it('maps Windows STATUS_APPLICATION_HANG (unsigned)', () => {
    const msg = describeWorkerExit(3489660927, '')
    assert.match(msg, /STATUS_APPLICATION_HANG/)
    assert.match(msg, /Rscript\.exe/)
  })

  it('maps Windows STATUS_APPLICATION_HANG (signed)', () => {
    const msg = describeWorkerExit(-805306369, '')
    assert.match(msg, /STATUS_APPLICATION_HANG/)
  })

  it('falls back to numeric exit for other codes', () => {
    assert.equal(describeWorkerExit(2, ''), 'R worker exited (2)')
    assert.equal(describeWorkerExit(null, ''), 'R worker exited')
  })
})
