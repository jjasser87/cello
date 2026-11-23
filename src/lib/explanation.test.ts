import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_EXPLAIN_MODE,
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

describe('DEFAULT_EXPLAIN_MODE', () => {
  it('opens Explain in Preview (not Edit)', () => {
    assert.equal(DEFAULT_EXPLAIN_MODE, 'preview')
  })
})

describe('renderExplanationHtml', () => {
  it('escapes HTML and renders headings', () => {
    const html = renderExplanationHtml('## Purpose\n\nUse <script>alert(1)</script>\n')
    assert.match(html, /<h3 class="explain-h">Purpose<\/h3>/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>/)
  })

  it('renders headings that are immediately followed by body text', () => {
    const html = renderExplanationHtml('## Purpose\nLoad sales.\n\n## Inputs\n- a\n- b\n')
    assert.match(html, /<h3 class="explain-h">Purpose<\/h3>/)
    assert.match(html, /<p class="explain-p">Load sales\.<\/p>/)
    assert.match(html, /<h3 class="explain-h">Inputs<\/h3>/)
    assert.match(html, /<ul class="explain-ul">/)
    assert.doesNotMatch(html, /## Purpose/)
  })

  it('renders unordered lists and bold', () => {
    const html = renderExplanationHtml('- **a**\n- b\n')
    assert.match(html, /<ul class="explain-ul">/)
    assert.match(html, /<strong>a<\/strong>/)
  })

  it('renders sample Markdown with fences, links, and emphasis', () => {
    const sample = [
      '# Title',
      '',
      'See [docs](https://example.com) and `mean` plus *italic* and **bold**.',
      '',
      '```r',
      'mean(x)',
      '```',
      '',
      '- one',
      '- two',
    ].join('\n')
    const html = renderExplanationHtml(sample)
    assert.match(html, /<h2 class="explain-h">Title<\/h2>/)
    assert.match(html, /<a class="explain-a" href="https:\/\/example\.com"/)
    assert.match(html, /<code class="explain-inline-code">mean<\/code>/)
    assert.match(html, /<em>italic<\/em>/)
    assert.match(html, /<strong>bold<\/strong>/)
    assert.match(html, /<pre class="explain-pre" data-lang="r"><code class="explain-code">mean\(x\)<\/code><\/pre>/)
    assert.match(html, /<ul class="explain-ul"><li>one<\/li><li>two<\/li><\/ul>/)
    assert.doesNotMatch(html, /```/)
    assert.doesNotMatch(html, /\[docs\]/)
  })
})
