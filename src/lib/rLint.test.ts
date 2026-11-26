import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  diagnosticAt,
  lintClassForRange,
  lintR,
  matchDelimiterAt,
} from './rLint.ts'

describe('lintR delimiters', () => {
  it('accepts balanced parentheses, brackets, and braces', () => {
    const code = 'f <- function(x) {\n  mean(c(1, 2))\n}\n'
    assert.deepEqual(
      lintR(code).filter((d) => d.severity === 'error'),
      [],
    )
  })

  it('flags unmatched open paren', () => {
    const diags = lintR('mean(c(1, 2)')
    const open = diags.find((d) => d.kind === 'unmatched-open')
    assert.ok(open)
    assert.equal(open?.severity, 'error')
    assert.match(open?.message ?? '', /Unmatched '\('/)
  })

  it('flags unexpected close paren', () => {
    const diags = lintR('x <- 1)')
    const close = diags.find((d) => d.kind === 'unmatched-close')
    assert.ok(close)
    assert.equal(close?.message, "Unexpected ')'")
  })

  it('flags mismatched delimiters', () => {
    const diags = lintR('f(x]')
    const mismatch = diags.find((d) => d.kind === 'mismatch')
    assert.ok(mismatch)
    assert.match(mismatch?.message ?? '', /Expected '\)'/)
  })

  it('ignores delimiters inside strings and comments', () => {
    const code = 'x <- "(unclosed in string"\n# (also ignored\ny <- 1\n'
    const delim = lintR(code).filter(
      (d) =>
        d.kind === 'unmatched-open' ||
        d.kind === 'unmatched-close' ||
        d.kind === 'mismatch',
    )
    assert.deepEqual(delim, [])
  })

  it('flags unclosed strings', () => {
    const diags = lintR('x <- "hello')
    const str = diags.find((d) => d.kind === 'unclosed-string')
    assert.ok(str)
    assert.equal(str?.severity, 'error')
  })
})

describe('lintR indentation', () => {
  it('accepts tidyverse-style 2-space indent inside braces', () => {
    const code = [
      'f <- function(x) {',
      '  if (x > 0) {',
      '    x + 1',
      '  }',
      '}',
      '',
    ].join('\n')
    const indents = lintR(code).filter((d) => d.kind === 'indent')
    assert.deepEqual(indents, [])
  })

  it('flags missing indent inside a brace block', () => {
    const code = 'f <- function(x) {\nx + 1\n}\n'
    const indent = lintR(code).find((d) => d.kind === 'indent')
    assert.ok(indent)
    assert.equal(indent?.severity, 'warning')
    assert.equal(indent?.line, 2)
    assert.match(indent?.message ?? '', /expected 2 spaces/)
  })

  it('flags over-indent at top level', () => {
    const diags = lintR('  x <- 1\n')
    const indent = diags.find((d) => d.kind === 'indent')
    assert.ok(indent)
    assert.match(indent?.message ?? '', /expected no indent/)
  })

  it('expects continuation indent for multi-line calls', () => {
    const good = 'mean(\n  x,\n  na.rm = TRUE\n)\n'
    assert.deepEqual(
      lintR(good).filter((d) => d.kind === 'indent'),
      [],
    )
    const bad = 'mean(\nx,\n)\n'
    const indent = lintR(bad).find((d) => d.kind === 'indent' && d.line === 2)
    assert.ok(indent)
  })

  it('warns on tab indentation', () => {
    const diags = lintR('f <- function(x) {\n\tx\n}\n')
    const tab = diags.find((d) => d.kind === 'mixed-indent')
    assert.ok(tab)
    assert.equal(tab?.severity, 'warning')
  })

  it('does not require indent on comment-only lines', () => {
    const code = 'f <- function(x) {\n# note\n  x\n}\n'
    const indents = lintR(code).filter((d) => d.kind === 'indent')
    assert.deepEqual(indents, [])
  })
})

describe('lintClassForRange', () => {
  it('prefers error over warning for overlapping ranges', () => {
    const diags = lintR('mean(c(1')
    assert.equal(lintClassForRange(diags, 0, 1), null)
    const open = diags.find((d) => d.kind === 'unmatched-open')
    assert.ok(open)
    assert.equal(lintClassForRange(diags, open!.from, open!.to), 'lint-error')
  })
})

describe('lintR soft mode', () => {
  it('skips unmatched opens, unclosed strings, and indent while soft', () => {
    const code = 'f <- function(x) {\nx + 1\n' // missing close, bad indent, unfinished
    const soft = lintR(code, { soft: true })
    assert.equal(
      soft.some((d) => d.kind === 'unmatched-open' || d.kind === 'indent' || d.kind === 'unclosed-string'),
      false,
    )
    const full = lintR(code)
    assert.ok(full.some((d) => d.kind === 'unmatched-open'))
    assert.ok(full.some((d) => d.kind === 'indent'))
  })

  it('still flags mismatched and unexpected closers while soft', () => {
    const mismatch = lintR('f(x]', { soft: true }).find((d) => d.kind === 'mismatch')
    assert.ok(mismatch)
    const unexpected = lintR('x <- 1)', { soft: true }).find((d) => d.kind === 'unmatched-close')
    assert.ok(unexpected)
  })
})

describe('matchDelimiterAt', () => {
  it('matches balanced parentheses from opener or closer', () => {
    const code = 'mean(c(1, 2))'
    // caret on first '('
    const fromOpen = matchDelimiterAt(code, code.indexOf('('))
    assert.ok(fromOpen)
    assert.equal(code.slice(fromOpen!.from, fromOpen!.to), '(')
    assert.equal(code.slice(fromOpen!.matchFrom, fromOpen!.matchTo), ')')
    // caret just after final ')'
    const fromClose = matchDelimiterAt(code, code.length)
    assert.ok(fromClose)
    assert.equal(code.slice(fromClose!.from, fromClose!.to), ')')
  })

  it('returns null for unmatched open', () => {
    assert.equal(matchDelimiterAt('mean(1', 4), null)
  })
})

describe('diagnosticAt', () => {
  it('returns the diagnostic covering an offset', () => {
    const diags = lintR('x <- 1)')
    const close = diags.find((d) => d.kind === 'unmatched-close')
    assert.ok(close)
    const hit = diagnosticAt(diags, close!.from)
    assert.equal(hit?.message, "Unexpected ')'")
    assert.equal(diagnosticAt(diags, 0), null)
  })
})
