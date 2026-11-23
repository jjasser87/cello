import type { Mermaid } from 'mermaid'

/** Cello-wood palette mapped onto Mermaid `theme: 'base'` variables. */
export const CELLO_MERMAID_THEME_VARIABLES = {
  darkMode: true,
  background: '#0e0e0e',
  primaryColor: '#121212',
  primaryTextColor: '#f2ebe3',
  primaryBorderColor: '#c48a3a',
  secondaryColor: '#161616',
  secondaryTextColor: '#c4b8a8',
  secondaryBorderColor: '#8b5a2b',
  tertiaryColor: '#0a0a0a',
  tertiaryTextColor: '#8a8074',
  tertiaryBorderColor: '#2e2a24',
  lineColor: '#c48a3a',
  textColor: '#f2ebe3',
  mainBkg: '#121212',
  nodeBorder: '#c48a3a',
  clusterBkg: '#0a0a0a',
  clusterBorder: '#8b5a2b',
  titleColor: '#e0a84a',
  edgeLabelBackground: '#121212',
  nodeTextColor: '#f2ebe3',
  fontFamily: 'IBM Plex Sans, sans-serif',
} as const

let mermaidPromise: Promise<Mermaid> | null = null
let initialized = false

/** Lazy-load Mermaid so the main bundle stays light until Flow opens. */
export function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default)
  }
  return mermaidPromise
}

export async function ensureMermaidInitialized(): Promise<Mermaid> {
  const mermaid = await loadMermaid()
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      // AI / user charts are untrusted in Electron. Strict blocks scripts & click
      // directives; <br/> in quoted labels still line-breaks via Mermaid's own parser.
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: { ...CELLO_MERMAID_THEME_VARIABLES },
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
      },
    })
    initialized = true
  }
  return mermaid
}

export type MermaidParseOk = { ok: true }
export type MermaidParseErr = { ok: false; error: string }
export type MermaidParseResult = MermaidParseOk | MermaidParseErr

/** Validate Mermaid source before render. Never throws. */
export async function parseMermaidSource(source: string): Promise<MermaidParseResult> {
  const text = source.replace(/\r\n/g, '\n').trim()
  if (!text) return { ok: false, error: 'Empty Mermaid source.' }
  try {
    const mermaid = await ensureMermaidInitialized()
    await mermaid.parse(text)
    return { ok: true }
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'str' in err && typeof (err as { str: unknown }).str === 'string'
        ? (err as { str: string }).str
        : err instanceof Error
          ? err.message
          : 'Invalid Mermaid source.'
    return { ok: false, error: message.split('\n')[0]?.trim() || 'Invalid Mermaid source.' }
  }
}

export type MermaidRenderOk = { ok: true; svg: string; bindFunctions?: (element: Element) => void }
export type MermaidRenderErr = { ok: false; error: string }
export type MermaidRenderResult = MermaidRenderOk | MermaidRenderErr

/** Parse-then-render. Callers should prefer `parseMermaidSource` for fallback UX. */
export async function renderMermaidSvg(
  id: string,
  source: string,
): Promise<MermaidRenderResult> {
  const parsed = await parseMermaidSource(source)
  if (!parsed.ok) return parsed
  try {
    const mermaid = await ensureMermaidInitialized()
    const { svg, bindFunctions } = await mermaid.render(id, source.trim())
    return { ok: true, svg, bindFunctions }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mermaid render failed.'
    return { ok: false, error: message.split('\n')[0]?.trim() || 'Mermaid render failed.' }
  }
}

/**
 * Mermaid flowchart node DOM ids look like `flowchart-n_cell_abc-0`, or with the
 * render id prefixed: `cello-flow-xyz-flowchart-n_cell_abc-0`.
 * Returns the Mermaid node id (`n_cell_abc`) or null.
 */
export function mermaidNodeIdFromDomId(domId: string): string | null {
  const match = domId.match(/flowchart-(n_[A-Za-z0-9_]+)-\d+$/)
  return match?.[1] ?? null
}

/** Map Mermaid node id `n_cell_xxx` → cell id `cell_xxx`. */
export function cellIdFromMermaidNodeId(mermaidId: string): string | null {
  if (mermaidId.startsWith('n_')) return mermaidId.slice(2)
  return null
}

/**
 * After SVG inject: tag flowchart nodes with cell ids and current highlight.
 * Click handling stays delegated in FlowGraph (no Mermaid `click` directive).
 */
export function syncFlowNodeFocusMarks(
  root: ParentNode,
  activeCellId?: string | null,
): void {
  const nodes = root.querySelectorAll<SVGGElement>('g.node[id*="flowchart-n_"]')
  for (const node of nodes) {
    const mermaidId = mermaidNodeIdFromDomId(node.id)
    if (!mermaidId) continue
    const cellId = cellIdFromMermaidNodeId(mermaidId)
    if (!cellId) continue

    node.classList.add('flow-mermaid-node')
    node.style.cursor = 'pointer'
    node.dataset.cellId = cellId
    node.setAttribute('role', 'button')
    node.setAttribute('tabindex', '0')
    node.setAttribute('aria-label', `Focus cell ${cellId}`)
    node.classList.toggle('is-flow-current', Boolean(activeCellId && cellId === activeCellId))
  }
}

/** Resolve a click/keydown target inside a Mermaid SVG to a cell id. */
export function cellIdFromFlowEventTarget(
  root: ParentNode,
  target: EventTarget | null,
): string | null {
  if (!(target instanceof Element)) return null
  const node = target.closest<SVGGElement>('g.node[data-cell-id]')
  if (!node || !root.contains(node)) return null
  return node.dataset.cellId ?? null
}

/** Test / reset helper — not used in production UI. */
export function resetMermaidRuntimeForTests(): void {
  mermaidPromise = null
  initialized = false
}
