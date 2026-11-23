import type { Cell, CellStatus, KernelLanguage } from '../types'

export type FlowEdgeKind = 'order' | 'depends'

export interface FlowNode {
  id: string
  label: string
  index: number
  status: CellStatus
}

export interface FlowEdge {
  from: string
  to: string
  kind: FlowEdgeKind
  /** Symbols that justify a depends edge. */
  symbols?: string[]
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Mermaid flowchart source — regenerated whenever cells change. */
  mermaid: string
}

const RESERVED = new Set([
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
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'await',
  'async',
  'of',
  'from',
  'as',
  'typeof',
  // R-ish
  'function',
  'TRUE',
  'FALSE',
  'NULL',
  'NA',
  'Inf',
  'NaN',
  'else',
  'repeat',
  'next',
  'library',
  'require',
  'c',
  'list',
  'data',
  'frame',
  'T',
  'F',
  // shared helpers
  'console',
  'cello',
  'log',
  'print',
  'length',
  'map',
  'filter',
  'reduce',
  'sum',
  'mean',
  'subset',
  'paste',
  'round',
  'nrow',
  'collapse',
])

/** Strip strings and comments so symbol scans stay conservative. */
export function stripNoise(code: string, language: KernelLanguage): string {
  let text = code.replace(/\r\n/g, '\n')
  if (language === 'r') {
    text = text.replace(/#.*$/gm, ' ')
  } else {
    text = text.replace(/\/\/.*$/gm, ' ')
    text = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  }
  text = text.replace(/`(?:\\.|[^`\\])*`/g, ' ')
  text = text.replace(/'(?:\\.|[^'\\])*'/g, ' ')
  text = text.replace(/"(?:\\.|[^"\\])*"/g, ' ')
  return text
}

/**
 * Mask dataframe / list column accessors so the column name is not a free use.
 * Keeps the object on the left (`df` in `df$salaries`) but blanks the column.
 *
 * Handles: `obj$col`, `obj[[col]]` / `obj[["col"]]`, and column slots after a
 * comma in `[` (`df[, col]`, `df[rows, col]`). Row-index names before a comma
 * stay (e.g. `df[emp_ids, ]` still uses `emp_ids`).
 */
export function maskColumnAccess(code: string, language: KernelLanguage): string {
  let text = code

  if (language === 'r') {
    // df$col  /  env$binding — column / member after `$` is not a free variable.
    text = text.replace(/\$\s*[A-Za-z.][A-Za-z0-9._]*/g, '$ ')
    // df[[col]] / df[["col"]] (strings already stripped → df[[ ]])
    text = text.replace(/\[\[[\s\S]*?\]\]/g, '[[ ]]')
    // Column position in [row, col, ...] — blank identifiers after each comma.
    text = text.replace(/\[([^\[\]]*)\]/g, (_full, inner: string) => {
      const blanked = String(inner).replace(
        /(,\s*)([A-Za-z.][A-Za-z0-9._]*)/g,
        '$1 ',
      )
      return `[${blanked}]`
    })
  } else {
    // obj.col / obj?.col — property reads are not free vars of that name.
    text = text.replace(/\?\.\s*[A-Za-z_$][\w$]*/g, '?. ')
    text = text.replace(/\.([A-Za-z_$][\w$]*)/g, '. ')
    text = text.replace(/\[[\s\S]*?\]/g, '[ ]')
  }

  return text
}

const R_NSE_CALLS = [
  'aes',
  'mutate',
  'transmute',
  'filter',
  'select',
  'rename',
  'summarise',
  'summarize',
  'group_by',
  'arrange',
  'distinct',
  'slice',
] as const

/**
 * Blank bodies of common R tidy-eval helpers (`aes(...)`, …) where bare
 * symbols are column names, not workspace objects (ggplot2 / dplyr NSE).
 */
export function maskNseCalls(code: string): string {
  const pattern = new RegExp(`\\b(${R_NSE_CALLS.join('|')})\\s*\\(`, 'g')
  let text = code
  const hits: { start: number; open: number; name: string }[] = []
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    hits.push({ start, open: start + match[0].length - 1, name: match[1] })
  }
  // Rewrite from the end so earlier offsets stay valid.
  for (let h = hits.length - 1; h >= 0; h--) {
    const { start, open, name } = hits[h]
    let depth = 0
    let close = open
    for (let j = open; j < text.length; j++) {
      if (text[j] === '(') depth += 1
      else if (text[j] === ')') {
        depth -= 1
        if (depth === 0) {
          close = j
          break
        }
      }
    }
    if (depth !== 0) continue
    const blanked = `${name}(${' '.repeat(Math.max(0, close - open - 1))})`
    text = text.slice(0, start) + blanked + text.slice(close + 1)
  }
  return text
}

export function extractDefs(code: string, language: KernelLanguage): Set<string> {
  const clean = stripNoise(code, language)
  const defs = new Set<string>()

  if (language === 'r') {
    // Prefer `<-` only: bare `=` is usually a named argument (data.frame, list, …).
    for (const match of clean.matchAll(/\b([A-Za-z.][A-Za-z0-9._]*)\s*<-/g)) {
      const name = match[1]
      if (!RESERVED.has(name) && !name.includes('::')) defs.add(name)
    }
  } else {
    for (const match of clean.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)|\bfunction\s+([A-Za-z_$][\w$]*)/g,
    )) {
      const name = match[1] ?? match[2]
      if (name && !RESERVED.has(name)) defs.add(name)
    }
  }

  return defs
}

export function extractUses(code: string, language: KernelLanguage): Set<string> {
  let clean = stripNoise(code, language)
  clean = maskColumnAccess(clean, language)
  if (language === 'r') {
    clean = maskNseCalls(clean)
  }
  const uses = new Set<string>()
  const pattern =
    language === 'r'
      ? /\b([A-Za-z.][A-Za-z0-9._]*)\b/g
      : /\b([A-Za-z_$][\w$]*)\b/g

  for (const match of clean.matchAll(pattern)) {
    const name = match[1]
    if (!name || RESERVED.has(name) || /^\d/.test(name)) continue
    // Skip package::symbol prefixes in R by taking only bare names.
    if (language === 'r' && name.includes('::')) continue
    uses.add(name)
  }

  return uses
}

function nodeKey(id: string): string {
  // Mermaid node ids must be alphanumeric-ish; keep a stable prefix.
  return `n_${id.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[[\]]/g, ' ')
}

/**
 * Build an auto Flow graph from cell order + lightweight symbol links.
 * Order edges always connect consecutive cells; depends edges appear when a
 * later cell uses a name defined in an earlier cell.
 */
export function buildFlowGraph(cells: Cell[], language: KernelLanguage): FlowGraph {
  const nodes: FlowNode[] = cells.map((cell, index) => ({
    id: cell.id,
    label: `${index + 1}. ${cell.name || `Cell ${index + 1}`}`,
    index,
    status: cell.status,
  }))

  const edges: FlowEdge[] = []
  const edgeKey = new Set<string>()

  const addEdge = (edge: FlowEdge) => {
    const key = `${edge.kind}:${edge.from}->${edge.to}:${(edge.symbols ?? []).join(',')}`
    if (edgeKey.has(key)) return
    edgeKey.add(key)
    edges.push(edge)
  }

  for (let i = 0; i < cells.length - 1; i++) {
    addEdge({ from: cells[i].id, to: cells[i + 1].id, kind: 'order' })
  }

  const defsByCell = cells.map((cell) => extractDefs(cell.code, language))
  const usesByCell = cells.map((cell) => extractUses(cell.code, language))

  // Map symbol → earliest defining cell index.
  const definedAt = new Map<string, number>()
  defsByCell.forEach((defs, index) => {
    for (const name of defs) {
      if (!definedAt.has(name)) definedAt.set(name, index)
    }
  })

  for (let i = 0; i < cells.length; i++) {
    const used = usesByCell[i]
    const links = new Map<number, string[]>()
    for (const name of used) {
      const fromIndex = definedAt.get(name)
      if (fromIndex === undefined || fromIndex >= i) continue
      // Skip if this cell also redefines it as a fresh local (still a use of prior).
      const bucket = links.get(fromIndex) ?? []
      if (!bucket.includes(name)) bucket.push(name)
      links.set(fromIndex, bucket)
    }
    for (const [fromIndex, symbols] of links) {
      addEdge({
        from: cells[fromIndex].id,
        to: cells[i].id,
        kind: 'depends',
        symbols: symbols.slice(0, 4),
      })
    }
  }

  return { nodes, edges, mermaid: toMermaid(nodes, edges) }
}

export function toMermaid(nodes: FlowNode[], edges: FlowEdge[], activeCellId?: string): string {
  const lines = ['flowchart TD']

  for (const node of nodes) {
    const id = nodeKey(node.id)
    lines.push(`  ${id}["${escapeMermaidLabel(node.label)}"]`)
  }

  for (const edge of edges) {
    const from = nodeKey(edge.from)
    const to = nodeKey(edge.to)
    if (edge.kind === 'order') {
      lines.push(`  ${from} --> ${to}`)
    } else {
      const label = (edge.symbols ?? []).slice(0, 2).join(', ')
      if (label) {
        lines.push(`  ${from} -.->|${escapeMermaidLabel(label)}| ${to}`)
      } else {
        lines.push(`  ${from} -.-> ${to}`)
      }
    }
  }

  if (activeCellId && nodes.some((n) => n.id === activeCellId)) {
    lines.push(`  classDef current stroke:#c48a3a,stroke-width:2px`)
    lines.push(`  class ${nodeKey(activeCellId)} current`)
  }

  return `${lines.join('\n')}\n`
}
