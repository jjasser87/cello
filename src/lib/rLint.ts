/**
 * Client-side R structural lint for the cell editor.
 * Instant feedback for unmatched delimiters and indentation — no lintr / kernel required.
 * Diagnostics never block Run.
 */

export type LintSeverity = 'error' | 'warning'

export type LintKind =
  | 'unmatched-open'
  | 'unmatched-close'
  | 'mismatch'
  | 'indent'
  | 'mixed-indent'
  | 'unclosed-string'

export interface RDiagnostic {
  /** Inclusive start offset in the source string. */
  from: number
  /** Exclusive end offset. */
  to: number
  /** 1-based line. */
  line: number
  /** 1-based column. */
  col: number
  severity: LintSeverity
  kind: LintKind
  message: string
}

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])

/** RStudio / tidyverse default: two spaces. */
export const R_INDENT_WIDTH = 2

interface OpenFrame {
  ch: string
  from: number
  line: number // 0-based
  col: number // 1-based
}

/**
 * Walk code outside strings/comments, invoking onCode for each code char
 * (and reporting unclosed strings).
 */
function walkCode(
  code: string,
  onCode: (ch: string, index: number, line0: number, col1: number) => void,
): RDiagnostic[] {
  const diagnostics: RDiagnostic[] = []
  let i = 0
  let line0 = 0
  let col1 = 1

  while (i < code.length) {
    const ch = code[i]

    if (ch === '\n') {
      onCode(ch, i, line0, col1)
      i += 1
      line0 += 1
      col1 = 1
      continue
    }

    if (ch === '#') {
      while (i < code.length && code[i] !== '\n') {
        i += 1
        col1 += 1
      }
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i
      const startLine = line0
      const startCol = col1
      i += 1
      col1 += 1
      let closed = false
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2
          col1 += 2
          continue
        }
        if (code[i] === ch) {
          closed = true
          i += 1
          col1 += 1
          break
        }
        // Treat a raw newline as an unclosed string (common while typing).
        if (code[i] === '\n') break
        i += 1
        col1 += 1
      }
      if (!closed) {
        diagnostics.push({
          from: start,
          to: start + 1,
          line: startLine + 1,
          col: startCol,
          severity: 'error',
          kind: 'unclosed-string',
          message: `Unclosed string starting with ${ch}`,
        })
      }
      continue
    }

    onCode(ch, i, line0, col1)
    i += 1
    col1 += 1
  }

  return diagnostics
}

/**
 * Indent units contributed by the open stack for the *next* line.
 * `{` always counts. `(`/`[` count only when still open past their open line
 * (i.e. multi-line groups).
 */
function indentUnits(stack: OpenFrame[], forLine0: number): number {
  let units = 0
  for (const frame of stack) {
    if (frame.ch === '{') {
      units += 1
    } else if (frame.line < forLine0) {
      // Opened on a prior line and still open → continuation indent.
      units += 1
    }
  }
  return units
}

/** Lint R source for delimiter and indentation issues. */
export function lintR(code: string): RDiagnostic[] {
  if (!code) return []

  const lines = code.split('\n')
  const lineStarts: number[] = [0]
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '\n') lineStarts.push(i + 1)
  }

  const stack: OpenFrame[] = []
  const delimiterDiagnostics: RDiagnostic[] = []
  /** Expected indent (spaces) at the start of each line, before processing that line. */
  const expectedIndent = new Array<number>(lines.length).fill(0)
  /** First non-space code character index per line (−1 if none / only comment). */
  const firstCodeCol = new Array<number>(lines.length).fill(-1)

  expectedIndent[0] = 0

  const stringDiagnostics = walkCode(code, (ch, index, line0, col1) => {
    if (ch === '\n') {
      const next = line0 + 1
      if (next < lines.length) {
        expectedIndent[next] = indentUnits(stack, next) * R_INDENT_WIDTH
      }
      return
    }

    // Skip leading whitespace — firstCodeCol must be the first non-space token.
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      return
    }

    if (firstCodeCol[line0] < 0) {
      firstCodeCol[line0] = col1
    }

    if (OPENERS.has(ch)) {
      stack.push({ ch, from: index, line: line0, col: col1 })
      return
    }

    if (CLOSERS.has(ch)) {
      const top = stack[stack.length - 1]
      if (!top) {
        delimiterDiagnostics.push({
          from: index,
          to: index + 1,
          line: line0 + 1,
          col: col1,
          severity: 'error',
          kind: 'unmatched-close',
          message: `Unexpected '${ch}'`,
        })
        return
      }
      const want = PAIRS[top.ch]
      if (want !== ch) {
        delimiterDiagnostics.push({
          from: index,
          to: index + 1,
          line: line0 + 1,
          col: col1,
          severity: 'error',
          kind: 'mismatch',
          message: `Expected '${want}' to match '${top.ch}' on line ${top.line + 1}, found '${ch}'`,
        })
        stack.pop()
        return
      }
      stack.pop()
      // If this closer is the first code on the line, expected indent should
      // match the opener's level (one unit less than content inside).
      if (firstCodeCol[line0] === col1) {
        expectedIndent[line0] = indentUnits(stack, line0) * R_INDENT_WIDTH
      }
    }
  })

  for (const frame of stack) {
    delimiterDiagnostics.push({
      from: frame.from,
      to: frame.from + 1,
      line: frame.line + 1,
      col: frame.col,
      severity: 'error',
      kind: 'unmatched-open',
      message: `Unmatched '${frame.ch}' — missing '${PAIRS[frame.ch]}'`,
    })
  }

  const indentDiagnostics: RDiagnostic[] = []
  for (let li = 0; li < lines.length; li += 1) {
    const text = lines[li]
    if (text.length === 0) continue
    const nonSpace = text.search(/\S/)
    if (nonSpace < 0) continue

    const leading = text.slice(0, nonSpace)
    const from = lineStarts[li] ?? 0

    if (leading.includes('\t') && leading.includes(' ')) {
      indentDiagnostics.push({
        from,
        to: from + nonSpace,
        line: li + 1,
        col: 1,
        severity: 'warning',
        kind: 'mixed-indent',
        message: 'Mixed tabs and spaces in indentation',
      })
    } else if (leading.includes('\t')) {
      indentDiagnostics.push({
        from,
        to: from + nonSpace,
        line: li + 1,
        col: 1,
        severity: 'warning',
        kind: 'mixed-indent',
        message: 'Use spaces for indentation (2 spaces), not tabs',
      })
    }

    // Comment-only lines: skip indent level checks (RStudio is lenient).
    if (text[nonSpace] === '#') continue

    const actual = leading.length
    const expected = expectedIndent[li] ?? 0
    if (actual !== expected) {
      indentDiagnostics.push({
        from,
        to: from + Math.max(nonSpace, 1),
        line: li + 1,
        col: 1,
        severity: 'warning',
        kind: 'indent',
        message:
          expected === 0
            ? `Incorrect indentation — expected no indent, found ${actual}`
            : `Incorrect indentation — expected ${expected} spaces, found ${actual}`,
      })
    }
  }

  const all = [...stringDiagnostics, ...delimiterDiagnostics, ...indentDiagnostics]
  all.sort((a, b) => a.from - b.from || a.to - b.to)
  return all
}

/**
 * Highest-severity class for a character range overlapping diagnostics.
 * Prefer error over warning.
 */
export function lintClassForRange(
  diagnostics: readonly RDiagnostic[],
  from: number,
  to: number,
): 'lint-error' | 'lint-warning' | null {
  let sawWarning = false
  for (const d of diagnostics) {
    if (d.from < to && d.to > from) {
      if (d.severity === 'error') return 'lint-error'
      sawWarning = true
    }
  }
  return sawWarning ? 'lint-warning' : null
}
