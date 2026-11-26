import type { KernelLanguage } from '../types'
import { lintClassForRange, type RDiagnostic } from './rLint.ts'

/** Token kinds used by the cell editor highlight layer. */
export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'function'
  | 'operator'
  | 'punctuation'

export interface Token {
  kind: TokenKind
  text: string
}

const R_KEYWORDS = new Set([
  'if',
  'else',
  'repeat',
  'while',
  'function',
  'for',
  'in',
  'next',
  'break',
  'return',
])

const R_BUILTINS = new Set([
  'TRUE',
  'FALSE',
  'NULL',
  'NA',
  'NA_integer_',
  'NA_real_',
  'NA_complex_',
  'NA_character_',
  'Inf',
  'NaN',
  'T',
  'F',
])

const JS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const JS_BUILTINS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

function isIdentStart(ch: string, language: KernelLanguage): boolean {
  if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') return true
  // R allows `.` at the start of a name (e.g. `.GlobalEnv`, `...`).
  return language === 'r' && ch === '.'
}

function isIdentCont(ch: string, language: KernelLanguage): boolean {
  if (isIdentStart(ch, language)) return true
  if (ch >= '0' && ch <= '9') return true
  return language === 'r' && ch === '.'
}

function readIdent(code: string, start: number, language: KernelLanguage): string {
  let i = start + 1
  while (i < code.length && isIdentCont(code[i], language)) i += 1
  return code.slice(start, i)
}

function readLineComment(code: string, start: number): string {
  let i = start + 1
  while (i < code.length && code[i] !== '\n') i += 1
  return code.slice(start, i)
}

function readBlockComment(code: string, start: number): string {
  let i = start + 2
  while (i < code.length) {
    if (code[i] === '*' && code[i + 1] === '/') {
      i += 2
      break
    }
    i += 1
  }
  return code.slice(start, i)
}

function readString(code: string, start: number, quote: string): string {
  let i = start + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) {
      i += 1
      break
    }
    if (ch === '\n') break
    i += 1
  }
  return code.slice(start, i)
}

function readNumber(code: string, start: number): string {
  let i = start
  // Hex
  if (code[i] === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
    i += 2
    while (i < code.length && /[0-9a-fA-F]/.test(code[i])) i += 1
    return code.slice(start, i)
  }
  while (i < code.length && code[i] >= '0' && code[i] <= '9') i += 1
  if (code[i] === '.' && code[i + 1] >= '0' && code[i + 1] <= '9') {
    i += 1
    while (i < code.length && code[i] >= '0' && code[i] <= '9') i += 1
  }
  if (code[i] === 'e' || code[i] === 'E') {
    i += 1
    if (code[i] === '+' || code[i] === '-') i += 1
    while (i < code.length && code[i] >= '0' && code[i] <= '9') i += 1
  }
  // R integer / complex suffixes: 1L, 2i
  if (code[i] === 'L' || code[i] === 'i') i += 1
  return code.slice(start, i)
}

function readOperator(code: string, start: number, language: KernelLanguage): string {
  const rest = code.slice(start)
  if (language === 'r') {
    const rOps = [
      '%>%',
      '%<>%',
      '%T>%',
      '%$%',
      '<<-',
      '->>',
      '<-',
      '->',
      '==',
      '!=',
      '<=',
      '>=',
      '&&',
      '||',
      ':::',
      '::',
      '%%',
      '%/%',
      '%in%',
      '**',
    ]
    for (const op of rOps) {
      if (rest.startsWith(op)) return op
    }
    // Generic %…% operator
    if (rest[0] === '%') {
      const end = rest.indexOf('%', 1)
      if (end > 0) return rest.slice(0, end + 1)
    }
  } else {
    const jsOps = [
      '===',
      '!==',
      '>>>',
      '<<=',
      '>>=',
      '**=',
      '=>',
      '==',
      '!=',
      '<=',
      '>=',
      '&&',
      '||',
      '??',
      '**',
      '<<',
      '>>',
      '++',
      '--',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '&=',
      '|=',
      '^=',
      '?.',
      '...',
    ]
    for (const op of jsOps) {
      if (rest.startsWith(op)) return op
    }
  }
  return rest[0]
}

function classifyIdent(
  name: string,
  language: KernelLanguage,
  nextNonSpace: string,
): TokenKind {
  if (language === 'r') {
    if (R_KEYWORDS.has(name)) return 'keyword'
    if (R_BUILTINS.has(name)) return 'builtin'
  } else {
    if (JS_KEYWORDS.has(name)) return 'keyword'
    if (JS_BUILTINS.has(name)) return 'builtin'
  }
  if (nextNonSpace === '(') return 'function'
  return 'plain'
}

function nextNonSpaceChar(code: string, from: number): string {
  let i = from
  while (i < code.length) {
    const ch = code[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1
      continue
    }
    return ch
  }
  return ''
}

/**
 * Lightweight left-to-right tokenizer for the cell writing surface.
 * Intentionally small — not a full language grammar.
 */
export function tokenize(code: string, language: KernelLanguage): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      let j = i + 1
      while (j < code.length && ' \t\r\n'.includes(code[j])) j += 1
      tokens.push({ kind: 'plain', text: code.slice(i, j) })
      i = j
      continue
    }

    if (language === 'r' && ch === '#') {
      const text = readLineComment(code, i)
      tokens.push({ kind: 'comment', text })
      i += text.length
      continue
    }

    if (language === 'javascript' && ch === '/' && next === '/') {
      const text = readLineComment(code, i)
      tokens.push({ kind: 'comment', text })
      i += text.length
      continue
    }

    if (language === 'javascript' && ch === '/' && next === '*') {
      const text = readBlockComment(code, i)
      tokens.push({ kind: 'comment', text })
      i += text.length
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      // R backticks = non-syntactic names; JS backticks = template literals.
      const text = readString(code, i, ch)
      tokens.push({ kind: 'string', text })
      i += text.length
      continue
    }

    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && next >= '0' && next <= '9')
    ) {
      const text = readNumber(code, i)
      tokens.push({ kind: 'number', text })
      i += text.length
      continue
    }

    if (isIdentStart(ch, language)) {
      const text = readIdent(code, i, language)
      const after = i + text.length
      const kind = classifyIdent(text, language, nextNonSpaceChar(code, after))
      tokens.push({ kind, text })
      i = after
      continue
    }

    if ('()[]{},;'.includes(ch)) {
      tokens.push({ kind: 'punctuation', text: ch })
      i += 1
      continue
    }

    const op = readOperator(code, i, language)
    tokens.push({
      kind: op.length === 1 && '.$?'.includes(op) && language === 'javascript'
        ? 'punctuation'
        : 'operator',
      text: op,
    })
    i += op.length
  }

  return tokens
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Emit one token, optionally wrapping sub-ranges that overlap lint diagnostics.
 * Keeps syntax `tok-*` classes and adds `tok-lint-error` / `tok-lint-warning`.
 */
function emitTokenHtml(
  token: Token,
  offset: number,
  diagnostics: readonly RDiagnostic[] | undefined,
): string {
  const text = token.text
  if (!diagnostics || diagnostics.length === 0 || text.length === 0) {
    const escaped = escapeHtml(text)
    return token.kind === 'plain' ? escaped : `<span class="tok-${token.kind}">${escaped}</span>`
  }

  // Split at every diagnostic edge that falls inside this token.
  const end = offset + text.length
  const cuts = new Set<number>([0, text.length])
  for (const d of diagnostics) {
    if (d.to <= offset || d.from >= end) continue
    cuts.add(Math.max(0, d.from - offset))
    cuts.add(Math.min(text.length, d.to - offset))
  }
  const points = [...cuts].sort((a, b) => a - b)

  let html = ''
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    if (a === b) continue
    const slice = text.slice(a, b)
    const escaped = escapeHtml(slice)
    const lint = lintClassForRange(diagnostics, offset + a, offset + b)
    const classes: string[] = []
    if (token.kind !== 'plain') classes.push(`tok-${token.kind}`)
    if (lint) classes.push(`tok-${lint}`)
    if (classes.length === 0) {
      html += escaped
    } else {
      html += `<span class="${classes.join(' ')}">${escaped}</span>`
    }
  }
  return html
}

/** Render highlighted HTML for the overlay layer (escaped text + span tokens). */
export function highlightHtml(
  code: string,
  language: KernelLanguage,
  diagnostics?: readonly RDiagnostic[],
): string {
  const tokens = tokenize(code, language)
  let html = ''
  let offset = 0
  for (const token of tokens) {
    html += emitTokenHtml(token, offset, diagnostics)
    offset += token.text.length
  }
  // Preserve a trailing newline so the <pre> height matches the textarea
  // (browsers collapse a final bare newline inside <pre>).
  if (code.endsWith('\n')) html += '\n'
  // Keep at least a zero-width space so an empty cell still paints the layer.
  if (html.length === 0) return '\u200b'
  return html
}
