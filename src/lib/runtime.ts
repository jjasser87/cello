import type { DataTable, EnvBinding, PlotSpec } from '../types'
import { createId } from './script'

export interface RunArtifacts {
  logs: string[]
  plot: PlotSpec | null
  table: DataTable | null
  env: EnvBinding[]
  error?: string
}

type SharedBag = Record<string, unknown>

const HIDDEN = new Set(['console', 'cello', 'globalThis', 'window', 'self'])

function previewValue(value: unknown): { kind: EnvBinding['kind']; preview: string } {
  if (value === null) return { kind: 'null', preview: 'null' }
  if (value === undefined) return { kind: 'undefined', preview: 'undefined' }
  if (typeof value === 'number') return { kind: 'number', preview: String(value) }
  if (typeof value === 'string') return { kind: 'string', preview: JSON.stringify(value) }
  if (typeof value === 'boolean') return { kind: 'boolean', preview: String(value) }
  if (typeof value === 'function') {
    return { kind: 'function', preview: value.name ? `${value.name}()` : 'ƒ()' }
  }
  if (Array.isArray(value)) {
    return { kind: 'array', preview: `Array(${value.length})` }
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    return {
      kind: 'object',
      preview: `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`,
    }
  }
  return { kind: 'string', preview: String(value) }
}

export function createSharedBag(): SharedBag {
  return Object.create(null) as SharedBag
}

/**
 * Persist simple top-level bindings: `const|let|var name = …` → `name = …`.
 * Leaves destructuring and other patterns alone so we don't invent syntax errors.
 */
function persistableCode(code: string): string {
  return code.replace(
    /^([ \t]*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm,
    '$1$2 =',
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.trim() || err.name || 'Error'
  }
  const text = String(err).trim()
  return text || 'Error'
}

function normalizePlotSpec(
  spec: unknown,
  cellId: string,
): { plot?: PlotSpec; error?: string } {
  if (!spec || typeof spec !== 'object') {
    return { error: 'cello.plot() expects an object with labels and values arrays' }
  }
  const input = spec as {
    title?: unknown
    kind?: unknown
    labels?: unknown
    values?: unknown
  }
  if (!Array.isArray(input.labels) || !Array.isArray(input.values)) {
    return { error: 'cello.plot() requires labels and values arrays' }
  }
  if (input.labels.length !== input.values.length) {
    return { error: 'cello.plot() labels and values must be the same length' }
  }
  const labels = input.labels.map((label) => String(label))
  const values = input.values.map((value) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : 0
  })
  const kind = input.kind === 'line' ? 'line' : 'bar'
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title
      : 'Plot'

  return {
    plot: {
      id: createId('plot'),
      cellId,
      title,
      kind,
      labels: [...labels],
      values: [...values],
      createdAt: Date.now(),
    },
  }
}

export function runCellCode(
  code: string,
  shared: SharedBag,
  meta: { cellId: string },
): RunArtifacts {
  const logs: string[] = []
  let plot: PlotSpec | null = null
  let table: DataTable | null = null

  const consoleApi = {
    log: (...args: unknown[]) => {
      logs.push(args.map(stringify).join(' '))
    },
    warn: (...args: unknown[]) => {
      logs.push(`warn: ${args.map(stringify).join(' ')}`)
    },
    error: (...args: unknown[]) => {
      logs.push(`error: ${args.map(stringify).join(' ')}`)
    },
  }

  const celloApi = {
    plot: (spec: unknown) => {
      const result = normalizePlotSpec(spec, meta.cellId)
      if (result.error) throw new Error(result.error)
      plot = result.plot!
      return plot
    },
    table: (rows: unknown, name = 'data') => {
      const tableName = typeof name === 'string' && name.trim() ? name : 'data'
      // Keep the caller's value in the shared env; normalize only for display.
      shared[tableName] = rows
      const normalized = normalizeRows(rows)
      table = {
        id: createId('data'),
        cellId: meta.cellId,
        name: tableName,
        columns: normalized.columns,
        rows: normalized.rows,
        createdAt: Date.now(),
      }
      return table
    },
  }

  const scope = new Proxy(shared, {
    has(_target, prop) {
      if (prop === Symbol.unscopables) return false
      // Claim all identifiers so assignments stay in the kernel bag,
      // including names that also exist on globalThis (Math, etc.).
      return typeof prop === 'string' || typeof prop === 'symbol'
    },
    get(target, prop, receiver) {
      if (prop === Symbol.unscopables) return undefined
      if (prop === 'console') return consoleApi
      if (prop === 'cello') return celloApi
      if (prop === 'globalThis') return globalThis
      if (prop === 'window' || prop === 'self') return globalThis
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string' && prop in globalThis) {
        return (globalThis as Record<string, unknown>)[prop]
      }
      return undefined
    },
    set(target, prop, value) {
      if (typeof prop === 'string') {
        target[prop] = value
        return true
      }
      return false
    },
  })

  try {
    const runner = new Function(
      '__scope',
      `with (__scope) {\n${persistableCode(code)}\n}`,
    )
    runner(scope)
  } catch (err) {
    return {
      logs,
      plot,
      table,
      env: snapshotEnv(shared),
      error: errorMessage(err),
    }
  }

  return {
    logs,
    plot,
    table,
    env: snapshotEnv(shared),
  }
}

function snapshotEnv(shared: SharedBag): EnvBinding[] {
  return Object.keys(shared)
    .filter((key) => !HIDDEN.has(key) && !key.startsWith('__'))
    .sort()
    .map((name) => {
      const value = shared[name]
      const { kind, preview } = previewValue(value)
      return { name, kind, preview }
    })
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeRows(input: unknown): {
  columns: string[]
  rows: Record<string, string | number | boolean | null>[]
} {
  if (!Array.isArray(input) || input.length === 0) {
    return { columns: [], rows: [] }
  }

  if (typeof input[0] !== 'object' || input[0] === null) {
    return {
      columns: ['value'],
      rows: input.map((value) => ({
        value: (value as string | number | boolean | null) ?? null,
      })),
    }
  }

  const columns = Array.from(
    new Set(
      input.flatMap((row) =>
        row && typeof row === 'object' ? Object.keys(row as object) : [],
      ),
    ),
  )

  const rows = input.map((row) => {
    const out: Record<string, string | number | boolean | null> = {}
    for (const col of columns) {
      const value = (row as Record<string, unknown>)?.[col]
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        out[col] = value
      } else if (value === undefined) {
        out[col] = null
      } else {
        out[col] = JSON.stringify(value)
      }
    }
    return out
  })

  return { columns, rows }
}
