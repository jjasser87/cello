import type { EnvBinding } from '../types'

export interface CompletionItem {
  label: string
  kind: string
}

export interface CompleteResult {
  items: CompletionItem[]
  prefix: string
  /** Set when the kernel could not answer; local fallback may still apply. */
  error?: string
  fromKernel: boolean
}

/** Common base-R / stats names for soft-fail when the kernel is unreachable. */
export const BASE_R_SYMBOLS: readonly string[] = [
  'c',
  'list',
  'data.frame',
  'matrix',
  'length',
  'names',
  'colnames',
  'rownames',
  'nrow',
  'ncol',
  'head',
  'tail',
  'str',
  'summary',
  'print',
  'cat',
  'paste',
  'paste0',
  'sprintf',
  'mean',
  'median',
  'sd',
  'var',
  'sum',
  'min',
  'max',
  'range',
  'abs',
  'sqrt',
  'log',
  'exp',
  'round',
  'floor',
  'ceiling',
  'as.numeric',
  'as.character',
  'as.logical',
  'as.data.frame',
  'is.na',
  'is.null',
  'is.numeric',
  'is.character',
  'is.data.frame',
  'NA',
  'NULL',
  'TRUE',
  'FALSE',
  'Inf',
  'seq',
  'seq_len',
  'seq_along',
  'rep',
  'rev',
  'sort',
  'order',
  'unique',
  'duplicated',
  'which',
  'which.min',
  'which.max',
  'ifelse',
  'lapply',
  'sapply',
  'vapply',
  'mapply',
  'Map',
  'Reduce',
  'Filter',
  'unlist',
  'cbind',
  'rbind',
  'merge',
  'subset',
  'transform',
  'with',
  'within',
  'attach',
  'detach',
  'library',
  'require',
  'source',
  'read.csv',
  'read.table',
  'write.csv',
  'write.table',
  'plot',
  'points',
  'lines',
  'abline',
  'hist',
  'boxplot',
  'barplot',
  'par',
  'lm',
  'glm',
  'predict',
  'resid',
  'coef',
  'anova',
  't.test',
  'cor',
  'cov',
  'table',
  'factor',
  'levels',
  'as.factor',
  'function',
  'return',
  'invisible',
  'stop',
  'warning',
  'message',
  'tryCatch',
  'browser',
  'debug',
  'class',
  'typeof',
  'mode',
  'attributes',
  'attr',
  'structure',
  'cello.plot',
  'cello.table',
  'console',
]

/** Mirror of server/normalizeRSource.ts — keep CRLF/BOM out of requests. */
function normalizeRSource(code: string): string {
  let text = String(code ?? '')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Token before `cursor` for local filtering.
 * Handles `pkg::`, `pkg:::`, and `obj$` by returning the fragment after the op.
 */
export function tokenBeforeCursor(code: string, cursor: number): {
  prefix: string
  trigger: 'ident' | 'dollar' | 'ns' | 'none'
} {
  const text = normalizeRSource(code)
  const pos = Math.max(0, Math.min(cursor, text.length))
  const before = text.slice(0, pos)
  const lineStart = before.lastIndexOf('\n') + 1
  const lineBefore = before.slice(lineStart)

  const ns = /([A-Za-z.][A-Za-z0-9.]*)(::{1,3})([A-Za-z.][A-Za-z0-9._]*)?$/.exec(lineBefore)
  if (ns) {
    return { prefix: ns[3] ?? '', trigger: 'ns' }
  }
  const dollar = /([A-Za-z.][A-Za-z0-9._]*)\$([A-Za-z.][A-Za-z0-9._]*)?$/.exec(lineBefore)
  if (dollar) {
    return { prefix: dollar[2] ?? '', trigger: 'dollar' }
  }
  const ident = /([A-Za-z.][A-Za-z0-9._]*)$/.exec(lineBefore)
  if (ident) {
    return { prefix: ident[1], trigger: 'ident' }
  }
  return { prefix: '', trigger: 'none' }
}

export function localCompletions(
  code: string,
  cursor: number,
  env: EnvBinding[] = [],
): CompleteResult {
  const { prefix, trigger } = tokenBeforeCursor(code, cursor)
  // Without the kernel we cannot cheaply resolve `$` / `::` members.
  if (trigger === 'dollar' || trigger === 'ns') {
    return { items: [], prefix, fromKernel: false }
  }
  if (trigger === 'none' && !prefix) {
    return { items: [], prefix: '', fromKernel: false }
  }

  const seen = new Set<string>()
  const items: CompletionItem[] = []

  const push = (label: string, kind: string) => {
    if (!label || seen.has(label)) return
    if (prefix && !label.startsWith(prefix)) return
    seen.add(label)
    items.push({ label, kind })
  }

  for (const binding of env) {
    push(binding.name, binding.kind === 'function' ? 'function' : 'binding')
  }
  for (const name of BASE_R_SYMBOLS) {
    push(name, 'symbol')
  }

  items.sort((a, b) => a.label.localeCompare(b.label))
  return {
    items: items.slice(0, 80),
    prefix,
    fromKernel: false,
  }
}

export async function completeOnRKernel(
  code: string,
  cursor: number,
  env: EnvBinding[] = [],
): Promise<CompleteResult> {
  const normalized = normalizeRSource(code)
  const pos = Math.max(0, Math.min(cursor, normalized.length))

  try {
    const res = await fetch('/api/kernel/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: normalized, cursor: pos }),
    })
    const raw = await res.text()
    let body: {
      items?: { label?: string; kind?: string }[] | string[]
      prefix?: string
      error?: string
      available?: boolean
    } = {}
    try {
      body = raw.trim() ? (JSON.parse(raw) as typeof body) : {}
    } catch {
      return {
        ...localCompletions(normalized, pos, env),
        error: 'R kernel returned non-JSON for complete',
      }
    }

    const items: CompletionItem[] = []
    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        if (typeof item === 'string' && item.trim()) {
          items.push({ label: item, kind: 'symbol' })
        } else if (item && typeof item === 'object' && typeof item.label === 'string') {
          const label = item.label.trim()
          if (!label) continue
          items.push({
            label,
            kind: typeof item.kind === 'string' && item.kind.trim() ? item.kind : 'symbol',
          })
        }
      }
    }

    const prefix = typeof body.prefix === 'string' ? body.prefix : ''
    const error = typeof body.error === 'string' && body.error.trim() ? body.error.trim() : undefined

    if (items.length === 0) {
      const fallback = localCompletions(normalized, pos, env)
      return {
        items: fallback.items,
        prefix: prefix || fallback.prefix,
        error,
        fromKernel: false,
      }
    }

    return { items: items.slice(0, 80), prefix, error, fromKernel: true }
  } catch (err) {
    return {
      ...localCompletions(normalized, pos, env),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
