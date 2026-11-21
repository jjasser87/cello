import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { highlightHtml, tokenize } from './highlight.ts'

describe('tokenize R', () => {
  it('colors comments, strings, keywords, builtins, and assignment', () => {
    const code = '# load\nx <- mean(c(1, 2))\nif (TRUE) "ok"'
    const kinds = tokenize(code, 'r').map((t) => `${t.kind}:${t.text}`)
    assert.ok(kinds.some((k) => k === 'comment:# load'))
    assert.ok(kinds.some((k) => k === 'operator:<-'))
    assert.ok(kinds.some((k) => k === 'function:mean'))
    assert.ok(kinds.some((k) => k === 'function:c'))
    assert.ok(kinds.some((k) => k === 'number:1'))
    assert.ok(kinds.some((k) => k === 'keyword:if'))
    assert.ok(kinds.some((k) => k === 'builtin:TRUE'))
    assert.ok(kinds.some((k) => k === 'string:"ok"'))
  })

  it('handles $ and :: operators', () => {
    const kinds = tokenize('sales$revenue; stats::sd(x)', 'r').map(
      (t) => `${t.kind}:${t.text}`,
    )
    assert.ok(kinds.includes('operator:$'))
    assert.ok(kinds.includes('operator:::'))
    assert.ok(kinds.includes('function:sd'))
  })

  it('treats # %% cell markers as comments', () => {
    const tokens = tokenize('# %% Load sample data', 'r')
    assert.equal(tokens[0]?.kind, 'comment')
    assert.equal(tokens[0]?.text, '# %% Load sample data')
  })
})

describe('tokenize JS', () => {
  it('colors line comments, keywords, strings, and functions', () => {
    const code = '// hi\nconst total = sum(values);\nreturn true'
    const kinds = tokenize(code, 'javascript').map((t) => `${t.kind}:${t.text}`)
    assert.ok(kinds.some((k) => k.startsWith('comment://')))
    assert.ok(kinds.includes('keyword:const'))
    assert.ok(kinds.includes('function:sum'))
    assert.ok(kinds.includes('keyword:return'))
    assert.ok(kinds.includes('builtin:true'))
  })
})

describe('highlightHtml', () => {
  it('escapes HTML and wraps token spans', () => {
    const html = highlightHtml('x <- "a<b"', 'r')
    assert.ok(html.includes('class="tok-operator"'))
    assert.ok(html.includes('class="tok-string"'))
    assert.ok(html.includes('&lt;'))
    assert.ok(!html.includes('<b'))
  })

  it('preserves a trailing newline for layout parity', () => {
    const html = highlightHtml('x\n', 'r')
    assert.ok(html.endsWith('\n'))
  })
})
