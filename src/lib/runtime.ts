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

/** Turn top-level const/let/var into assignments so bindings persist across cells. */
function persistableCode(code: string): string {
  return code.replace(/^(?:const|let|var)\s+/gm, '')
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
    plot: (spec: {
      title?: string
      kind?: 'bar' | 'line'
      labels: string[]
      values: number[]
    }) => {
      plot = {
        id: createId('plot'),
        cellId: meta.cellId,
        title: spec.title ?? 'Plot',
        kind: spec.kind ?? 'bar',
        labels: spec.labels,
        values: spec.values,
        createdAt: Date.now(),
      }
      return plot
    },
    table: (rows: Record<string, unknown>[] | unknown, name = 'data') => {
      const normalized = normalizeRows(rows)
      table = {
        id: createId('data'),
        cellId: meta.cellId,
        name,
        columns: normalized.columns,
        rows: normalized.rows,
        createdAt: Date.now(),
      }
      shared[name] = normalized.rows
      return table
    },
  }

  const scope = new Proxy(shared, {
    has(target, prop) {
      if (prop === Symbol.unscopables) return false
      if (prop in target) return true
      if (prop === 'console' || prop === 'cello') return true
      // Claim unknown identifiers so assignments stick on the shared env,
      // while still allowing real globals (Math, JSON, …) via the outer scope.
      return typeof prop === 'string' && !(prop in globalThis)
    },
    get(target, prop, receiver) {
      if (prop === Symbol.unscopables) return undefined
      if (prop === 'console') return consoleApi
      if (prop === 'cello') return celloApi
      if (prop === 'globalThis' || prop === 'window' || prop === 'self') return receiver
      if (prop in target) return Reflect.get(target, prop, receiver)
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
    const message = err instanceof Error ? err.message : String(err)
    return {
      logs,
      plot,
      table,
      env: snapshotEnv(shared),
      error: message,
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
