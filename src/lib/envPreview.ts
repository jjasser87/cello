/**
 * Environment variable inline preview — selection state + detail shaping.
 *
 * Values come from the kernel env **snapshot** returned with each eval
 * (enriched `detail` on each binding), not a separate inspect round-trip.
 */

import type { EnvDetail } from '../types'

export type { EnvDetail }

export const ENV_PREVIEW_LIMITS = {
  vectorMax: 40,
  listMax: 30,
  tableRows: 20,
  tableCols: 12,
  stringMax: 2000,
  scalarMax: 500,
} as const

/** Toggle: click same name again closes; only one open at a time. */
export function toggleEnvPreview(
  current: string | null,
  name: string,
): string | null {
  return current === name ? null : name
}

/** Drop selection when the binding disappears from the env list. */
export function resolveEnvPreviewName(
  current: string | null,
  names: readonly string[],
): string | null {
  if (current === null) return null
  return names.includes(current) ? current : null
}

export function detailIsTooLarge(detail: EnvDetail | undefined): boolean {
  if (!detail) return false
  if (detail.form === 'summary') return detail.tooLarge
  if (detail.form === 'vector' || detail.form === 'list' || detail.form === 'table') {
    return detail.truncated
  }
  return false
}

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, Math.max(0, max - 1))}…`, truncated: true }
}

/** Build a client-side detail from a JS shared-bag value (JS kernel path). */
export function buildJsEnvDetail(value: unknown): EnvDetail {
  if (value === null) return { form: 'scalar', text: 'null' }
  if (value === undefined) return { form: 'scalar', text: 'undefined' }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { form: 'scalar', text: String(value) }
  }
  if (typeof value === 'string') {
    const { text, truncated } = truncateText(value, ENV_PREVIEW_LIMITS.stringMax)
    if (truncated) return { form: 'summary', text, tooLarge: true }
    return { form: 'scalar', text: JSON.stringify(text) }
  }
  if (typeof value === 'function') {
    const label = value.name ? `function ${value.name}()` : 'function()'
    return { form: 'function', text: label }
  }
  if (Array.isArray(value)) {
    const total = value.length
    const take = Math.min(total, ENV_PREVIEW_LIMITS.vectorMax)
    const values = value.slice(0, take).map((item) => summarizeJsItem(item))
    return {
      form: 'vector',
      values,
      truncated: total > take,
      total,
    }
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const total = entries.length
    const take = Math.min(total, ENV_PREVIEW_LIMITS.listMax)
    return {
      form: 'list',
      entries: entries.slice(0, take).map(([name, item]) => ({
        name,
        preview: summarizeJsItem(item),
      })),
      truncated: total > take,
      total,
    }
  }
  const raw = String(value)
  const { text, truncated } = truncateText(raw, ENV_PREVIEW_LIMITS.scalarMax)
  return truncated
    ? { form: 'summary', text, tooLarge: true }
    : { form: 'scalar', text }
}

function summarizeJsItem(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') {
    return truncateText(JSON.stringify(value), 80).text
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'function') return value.name ? `${value.name}()` : 'ƒ()'
  if (Array.isArray(value)) return `Array(${value.length})`
  if (typeof value === 'object') {
    try {
      return truncateText(JSON.stringify(value), 80).text
    } catch {
      return '{…}'
    }
  }
  return String(value)
}

/** Normalize a raw kernel/JSON detail payload into EnvDetail (or undefined). */
export function normalizeEnvDetail(raw: unknown): EnvDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const form = typeof obj.form === 'string' ? obj.form : ''

  switch (form) {
    case 'scalar': {
      const text = typeof obj.text === 'string' ? obj.text : String(obj.text ?? '')
      return { form: 'scalar', text }
    }
    case 'vector': {
      const values = Array.isArray(obj.values) ? obj.values.map((v) => String(v)) : []
      const total =
        typeof obj.total === 'number' && Number.isFinite(obj.total) ? obj.total : values.length
      return {
        form: 'vector',
        values,
        truncated: Boolean(obj.truncated) || total > values.length,
        total,
      }
    }
    case 'list': {
      const entries: { name: string; preview: string }[] = []
      if (Array.isArray(obj.entries)) {
        for (const item of obj.entries) {
          if (!item || typeof item !== 'object') continue
          const row = item as Record<string, unknown>
          const name = typeof row.name === 'string' ? row.name : ''
          if (!name) continue
          entries.push({
            name,
            preview: typeof row.preview === 'string' ? row.preview : String(row.preview ?? ''),
          })
        }
      }
      const total =
        typeof obj.total === 'number' && Number.isFinite(obj.total) ? obj.total : entries.length
      return {
        form: 'list',
        entries,
        truncated: Boolean(obj.truncated) || total > entries.length,
        total,
      }
    }
    case 'table': {
      const columns = Array.isArray(obj.columns) ? obj.columns.map(String) : []
      const rows = Array.isArray(obj.rows)
        ? (obj.rows as Record<string, unknown>[]).map((row) => {
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
                out[col] = String(value)
              }
            }
            return out
          })
        : []
      const totalRows =
        typeof obj.totalRows === 'number' && Number.isFinite(obj.totalRows)
          ? obj.totalRows
          : rows.length
      const totalCols =
        typeof obj.totalCols === 'number' && Number.isFinite(obj.totalCols)
          ? obj.totalCols
          : columns.length
      return {
        form: 'table',
        columns,
        rows,
        truncated: Boolean(obj.truncated) || totalRows > rows.length || totalCols > columns.length,
        totalRows,
        totalCols,
      }
    }
    case 'function': {
      const text = typeof obj.text === 'string' ? obj.text : 'function()'
      return { form: 'function', text }
    }
    case 'summary': {
      const text = typeof obj.text === 'string' ? obj.text : ''
      return { form: 'summary', text, tooLarge: Boolean(obj.tooLarge) }
    }
    default:
      return undefined
  }
}

/** Fallback detail when the kernel only sent the one-line preview. */
export function detailFromPreview(preview: string, kind: string): EnvDetail {
  if (kind === 'function') return { form: 'function', text: preview }
  return { form: 'scalar', text: preview }
}
