import type { DataTable, EnvBinding, PlotSpec } from '../types'
import { normalizeEnvDetail } from './envPreview'
import { createId } from './script'
import type { RunArtifacts } from './runtime'

export type KernelLanguage = 'r' | 'javascript'

export interface KernelStatus {
  available: boolean
  language: 'r'
  version: string | null
  message?: string | null
  lastError?: string | null
  error?: string
  /** Resolved Rscript path the host is using (or last attempted). */
  rscriptPath?: string | null
  /** Settings override currently applied on the host (`null` = auto-discover). */
  rscriptOverride?: string | null
}

interface ApiRunResult {
  logs?: string[]
  plot?: {
    title?: string
    kind?: string
    labels?: string[]
    values?: number[]
    imageData?: string
    cellId?: string
  } | null
  table?: {
    name?: string
    columns?: string[]
    rows?: Record<string, string | number | boolean | null>[]
    cellId?: string
  } | null
  env?: { name: string; kind: string; preview: string; detail?: unknown }[]
  error?: string
}

function toArtifacts(raw: ApiRunResult, cellId: string): RunArtifacts {
  let plot: PlotSpec | null = null
  if (raw.plot) {
    const title = raw.plot.title?.trim() || 'Plot'
    const imageData =
      typeof raw.plot.imageData === 'string' && raw.plot.imageData.startsWith('data:image/')
        ? raw.plot.imageData
        : undefined

    if (raw.plot.kind === 'image' && imageData) {
      plot = {
        id: createId('plot'),
        cellId,
        title,
        kind: 'image',
        labels: [],
        values: [],
        imageData,
        createdAt: Date.now(),
      }
    } else if (Array.isArray(raw.plot.labels) && Array.isArray(raw.plot.values)) {
      plot = {
        id: createId('plot'),
        cellId,
        title,
        kind: raw.plot.kind === 'line' ? 'line' : 'bar',
        labels: raw.plot.labels.map(String),
        values: raw.plot.values.map((value) => {
          const n = typeof value === 'number' ? value : Number(value)
          return Number.isFinite(n) ? n : 0
        }),
        createdAt: Date.now(),
      }
    }
  }

  let table: DataTable | null = null
  if (raw.table) {
    table = {
      id: createId('data'),
      cellId,
      name: raw.table.name?.trim() || 'data',
      columns: Array.isArray(raw.table.columns) ? raw.table.columns.map(String) : [],
      rows: Array.isArray(raw.table.rows) ? raw.table.rows : [],
      createdAt: Date.now(),
    }
  }

  const env: EnvBinding[] = Array.isArray(raw.env)
    ? raw.env.map((item) => {
        const detail = normalizeEnvDetail(item.detail)
        return {
          name: String(item.name),
          kind: normalizeKind(item.kind),
          preview: String(item.preview),
          ...(detail ? { detail } : {}),
        }
      })
    : []

  return {
    logs: Array.isArray(raw.logs) ? raw.logs.map(String) : [],
    plot,
    table,
    env,
    error: raw.error?.trim() || undefined,
  }
}

function normalizeKind(kind: string): EnvBinding['kind'] {
  switch (kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'array':
    case 'object':
    case 'function':
    case 'null':
    case 'undefined':
      return kind
    default:
      return 'object'
  }
}

/** Mirror of server/normalizeRSource.ts — keep CRLF/BOM out of R parse(text=). */
function normalizeRSource(code: string): string {
  let text = String(code ?? '')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

async function parseResponse(res: Response): Promise<ApiRunResult & KernelStatus> {
  const raw = await res.text()
  let body: ApiRunResult & KernelStatus
  try {
    body = (raw.trim() ? JSON.parse(raw) : {}) as ApiRunResult & KernelStatus
  } catch {
    const preview = raw.slice(0, 120).replace(/\s+/g, ' ')
    throw new Error(
      `R kernel returned non-JSON (${res.status}${res.headers.get('content-type') ? ` ${res.headers.get('content-type')}` : ''}): ${preview || '(empty)'}`,
    )
  }
  if (!res.ok) {
    const message = body.error || body.message || `Kernel request failed (${res.status})`
    throw new Error(message)
  }
  return body
}

export async function fetchKernelStatus(): Promise<KernelStatus> {
  try {
    const res = await fetch('/api/kernel/status')
    return await parseResponse(res)
  } catch (err) {
    return {
      available: false,
      language: 'r',
      version: null,
      message:
        err instanceof Error
          ? err.message
          : 'R kernel API unreachable. Is `npm run dev` running?',
      rscriptPath: null,
      rscriptOverride: null,
    }
  }
}

/** Apply or clear the Settings R path override on the Vite kernel host. */
export async function configureKernelRscript(
  rscriptPath: string | null,
): Promise<KernelStatus> {
  const res = await fetch('/api/kernel/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rscriptPath }),
  })
  return parseResponse(res)
}

export async function evalOnRKernel(code: string, cellId: string): Promise<RunArtifacts> {
  const res = await fetch('/api/kernel/eval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: normalizeRSource(code), cellId }),
  })
  const body = await parseResponse(res)
  return toArtifacts(body, cellId)
}

export async function resetRKernel(): Promise<RunArtifacts> {
  const res = await fetch('/api/kernel/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const body = await parseResponse(res)
  return toArtifacts(body, '')
}

export async function runAllOnRKernel(
  cells: { id: string; code: string }[],
): Promise<{ results: RunArtifacts[]; stopped: boolean }> {
  const res = await fetch('/api/kernel/run-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cells: cells.map((cell) => ({
        id: cell.id,
        code: normalizeRSource(cell.code),
      })),
    }),
  })
  const body = (await parseResponse(res)) as {
    results?: ApiRunResult[]
    stopped?: boolean
    error?: string
  }
  const results = Array.isArray(body.results)
    ? body.results.map((item, index) => toArtifacts(item, cells[index]?.id ?? ''))
    : []
  return { results, stopped: Boolean(body.stopped) }
}
