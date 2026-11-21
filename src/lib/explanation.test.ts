import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emptyExplanationTemplate,
  ensureExplanation,
  isBlankExplanation,
  renderExplanationHtml,
  EXPLANATION_SECTIONS,
} from './explanation.ts'

describe('explanation template', () => {
  it('includes every focus-audit section as a Markdown heading', () => {
    const md = emptyExplanationTemplate()
    for (const section of EXPLANATION_SECTIONS) {
      assert.match(md, new RegExp(`^## ${section}$`, 'm'))
    }
  })

  it('treats empty and template-only docs as blank', () => {
    assert.equal(isBlankExplanation(''), true)
    assert.equal(isBlankExplanation(null), true)
    assert.equal(isBlankExplanation(emptyExplanationTemplate()), true)
    assert.equal(isBlankExplanation('## Purpose\n\nLoad sales.\n'), false)
  })

  it('ensureExplanation seeds blanks and keeps filled docs', () => {
    const seeded = ensureExplanation('')
    assert.match(seeded, /## Purpose/)
    const kept = ensureExplanation('## Purpose\n\nHello\n')
    assert.equal(kept, '## Purpose\n\nHello\n')
  })
})

describe('renderExplanationHtml', () => {
  it('escapes HTML and renders headings', () => {
    const html = renderExplanationHtml('## Purpose\n\nUse <script>alert(1)</script>\n')
    assert.match(html, /<h3 class="explain-h">Purpose<\/h3>/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>/)
  })

  it('renders unordered lists and bold', () => {
    const html = renderExplanationHtml('- **a**\n- b\n')
    assert.match(html, /<ul class="explain-ul">/)
    assert.match(html, /<strong>a<\/strong>/)
  })
})
