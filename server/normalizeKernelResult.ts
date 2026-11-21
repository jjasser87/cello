export interface KernelEnvBinding {
  name: string
  kind: string
  preview: string
}

export interface KernelPlotPayload {
  title: string
  kind: 'bar' | 'line' | 'image'
  labels: string[]
  values: number[]
  /** data:image/png;base64,… for native R graphics. */
  imageData?: string
  cellId?: string
}

export interface KernelTablePayload {
  name: string
  columns: string[]
  rows: Record<string, string | number | boolean | null>[]
  cellId?: string
}

export interface KernelRunResult {
  logs: string[]
  plot: KernelPlotPayload | null
  table: KernelTablePayload | null
  env: KernelEnvBinding[]
  error?: string
}

export interface KernelCompletionItem {
  label: string
  kind: string
}

export interface KernelCompleteResult {
  items: KernelCompletionItem[]
  prefix: string
  error?: string
}

/** Normalize an NDJSON worker completions payload. */
export function normalizeCompletions(msg: Record<string, unknown>): KernelCompleteResult {
  const prefix = typeof msg.prefix === 'string' ? msg.prefix : ''
  const rawItems = Array.isArray(msg.items) ? msg.items : []
  const items: KernelCompletionItem[] = []
  for (const item of rawItems) {
    if (typeof item === 'string' && item.trim()) {
      items.push({ label: item, kind: 'symbol' })
      continue
    }
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      const label = typeof row.label === 'string' ? row.label : ''
      if (!label.trim()) continue
      items.push({
        label,
        kind: typeof row.kind === 'string' && row.kind.trim() ? row.kind : 'symbol',
      })
    }
  }
  return {
    items,
    prefix,
    error: typeof msg.error === 'string' && msg.error.trim() ? msg.error.trim() : undefined,
  }
}

/** Normalize an NDJSON worker result into the host API shape. */
export function normalizeResult(msg: Record<string, unknown>): KernelRunResult {
  const logs = Array.isArray(msg.logs)
    ? msg.logs.map((line) => String(line))
    : []
  const env = Array.isArray(msg.env)
    ? (msg.env as KernelEnvBinding[]).map((item) => ({
        name: String(item.name),
        kind: String(item.kind),
        preview: String(item.preview),
      }))
    : []

  let plot: KernelPlotPayload | null = null
  if (msg.plot && typeof msg.plot === 'object') {
    const raw = msg.plot as Record<string, unknown>
    const title =
      typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Plot'
    const cellId = typeof raw.cellId === 'string' ? raw.cellId : undefined
    const imageData =
      typeof raw.imageData === 'string' && raw.imageData.startsWith('data:image/')
        ? raw.imageData
        : undefined

    if (raw.kind === 'image' && imageData) {
      plot = {
        title,
        kind: 'image',
        labels: [],
        values: [],
        imageData,
        cellId,
      }
    } else {
      const labels = Array.isArray(raw.labels) ? raw.labels.map((v) => String(v)) : []
      const values = Array.isArray(raw.values)
        ? raw.values.map((v) => {
            const n = typeof v === 'number' ? v : Number(v)
            return Number.isFinite(n) ? n : 0
          })
        : []
      if (labels.length === values.length && labels.length > 0) {
        plot = {
          title,
          kind: raw.kind === 'line' ? 'line' : 'bar',
          labels,
          values,
          cellId,
        }
      }
    }
  }

  let table: KernelTablePayload | null = null
  if (msg.table && typeof msg.table === 'object') {
    const raw = msg.table as Record<string, unknown>
    const columns = Array.isArray(raw.columns) ? raw.columns.map((c) => String(c)) : []
    const rows = Array.isArray(raw.rows)
      ? (raw.rows as Record<string, unknown>[]).map((row) => {
          const out: Record<string, string | number | boolean | null> = {}
          for (const col of columns) {
            const value = row?.[col]
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
      : []
    table = {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'data',
      columns,
      rows,
      cellId: typeof raw.cellId === 'string' ? raw.cellId : undefined,
    }
  }

  const error =
    typeof msg.error === 'string' && msg.error.trim() ? msg.error.trim() : undefined

  return { logs, plot, table, env, error }
}
