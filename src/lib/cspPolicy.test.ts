import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CELLO_CONTENT_SECURITY_POLICY, cspAllowsInlineStyles } from './cspPolicy.ts'

describe('CELLO_CONTENT_SECURITY_POLICY', () => {
  it('allows Mermaid SVG inline styles under style-src', () => {
    assert.equal(cspAllowsInlineStyles(), true)
    assert.match(CELLO_CONTENT_SECURITY_POLICY, /style-src[^;]*'unsafe-inline'/)
  })

  it('keeps scripts locked to self (no loose Mermaid click scripts)', () => {
    assert.match(CELLO_CONTENT_SECURITY_POLICY, /script-src 'self'/)
    assert.equal(/script-src[^;]*'unsafe-inline'/.test(CELLO_CONTENT_SECURITY_POLICY), false)
  })
})
