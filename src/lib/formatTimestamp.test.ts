import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatPanelTimestamp } from './formatTimestamp.ts'

describe('formatPanelTimestamp', () => {
  const ms = Date.UTC(2026, 10, 23, 20, 42, 0) // Nov 23, 2026 20:42 UTC

  it('includes both date and time', () => {
    const text = formatPanelTimestamp(ms, 'en-US')
    assert.match(text, /Nov/)
    assert.match(text, /23/)
    assert.match(text, /2026/)
    assert.match(text, /42/)
    // Must not be time-only (no bare hour:minute without a date).
    assert.notEqual(text, new Date(ms).toLocaleTimeString('en-US'))
  })

  it('accepts a Date instance', () => {
    const text = formatPanelTimestamp(new Date(ms), 'en-US')
    assert.match(text, /2026/)
    assert.match(text, /Nov/)
  })

  it('stays dense for the panel', () => {
    const text = formatPanelTimestamp(ms, 'en-US')
    // No weekday or seconds — keep the muted meta line short.
    assert.doesNotMatch(text, /Monday|Sunday|seconds|\d{2}:\d{2}:\d{2}/i)
  })
})
