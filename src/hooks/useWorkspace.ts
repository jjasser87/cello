import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  evalOnRKernel,
  fetchKernelStatus,
  resetRKernel,
  runAllOnRKernel,
} from '../lib/kernelClient'
import { createSharedBag, runCellCode, type RunArtifacts } from '../lib/runtime'
import {
  createId,
  cellsToScript,
  defaultScriptPath,
  scriptToCells,
  starterScript,
} from '../lib/script'
import { loadWorkspace, saveWorkspace } from '../lib/storage'
import type {
  Cell,
  HistoryEntry,
  KernelLanguage,
  PanelId,
  ProjectFile,
  WorkspaceState,
} from '../types'

const DEFAULT_FILES: ProjectFile[] = [
  {
    id: 'folder_root',
    name: 'project',
    kind: 'folder',
    children: [
      { id: 'file_analysis_r', name: 'analysis.R', kind: 'file' },
      { id: 'file_analysis_js', name: 'analysis.js', kind: 'file' },
      { id: 'file_readme', name: 'README.md', kind: 'file' },
      {
        id: 'folder_data',
        name: 'data',
        kind: 'folder',
        children: [
          { id: 'file_sales', name: 'sales.csv', kind: 'file' },
          { id: 'file_notes', name: 'notes.txt', kind: 'file' },
        ],
      },
    ],
  },
]

function detectLanguage(saved?: {
  language?: KernelLanguage
  scriptPath?: string
  cells?: { code: string }[]
}): KernelLanguage {
  if (saved?.language === 'r' || saved?.language === 'javascript') return saved.language
  if (saved?.scriptPath?.toLowerCase().endsWith('.r')) return 'r'
  if (saved?.scriptPath?.toLowerCase().endsWith('.js')) return 'javascript'
  const sample = saved?.cells?.map((cell) => cell.code).join('\n') ?? ''
  if (/<-/.test(sample) || /\bdata\.frame\s*\(/.test(sample)) return 'r'
  // Existing localStorage workspaces without a language field were JS.
  if (saved?.cells?.length) return 'javascript'
  return 'r'
}

function buildInitial(): WorkspaceState {
  const saved = loadWorkspace()
  const language = detectLanguage(saved ?? undefined)
  const cells =
    saved?.cells?.length
      ? saved.cells.map((cell) => ({
          ...cell,
          status: 'idle' as const,
        }))
      : scriptToCells(starterScript(language))

  return {
    cells,
    activeCellId: saved?.activeCellId && cells.some((c) => c.id === saved.activeCellId)
      ? saved.activeCellId
      : cells[0].id,
    activePanel: saved?.activePanel ?? 'cells',
    sidePanelOpen: false,
    language,
    kernelStatus: {
      available: false,
      version: null,
      message: 'Checking R kernel…',
    },
    history: [],
    historyIndex: -1,
    plots: [],
    activePlotId: null,
    tables: [],
    activeTableId: null,
    env: [],
    consoleLines: ['Ready. Run a cell with ⌘/Ctrl+Enter.'],
    files: DEFAULT_FILES,
    scriptPath: saved?.scriptPath ?? defaultScriptPath(language),
  }
}

function applyRunToState(
  prev: WorkspaceState,
  args: {
    cellId: string
    cellName: string
    code: string
    previousCode: string
    result: RunArtifacts
  },
): WorkspaceState {
  const { cellId, cellName, code, previousCode, result } = args
  const historyEntry: HistoryEntry = {
    id: createId('hist'),
    cellId,
    cellName,
    code,
    previousCode,
    timestamp: Date.now(),
    status: result.error ? 'error' : 'ok',
    error: result.error,
    outputText: result.logs.join('\n'),
    plotId: result.plot?.id,
    dataId: result.table?.id,
  }

  const plots = result.plot ? [...prev.plots, result.plot] : prev.plots
  const tables = result.table ? [...prev.tables, result.table] : prev.tables
  const history = [...prev.history, historyEntry]
  let activePanel = prev.activePanel
  let sidePanelOpen = prev.sidePanelOpen
  if (result.plot) {
    activePanel = 'plot'
    sidePanelOpen = true
  } else if (result.table) {
    activePanel = 'data'
    sidePanelOpen = true
  } else if (result.error) {
    activePanel = 'history'
    sidePanelOpen = true
  }

  const cellConsoleChunk = result.logs.length
    ? result.logs
    : [result.error ? `Error: ${result.error}` : '(no output)']
  const cellPlotId =
    result.plot?.id ??
    [...plots].reverse().find((plot) => plot.cellId === cellId)?.id ??
    null
  const cellTableId =
    result.table?.id ??
    [...tables].reverse().find((table) => table.cellId === cellId)?.id ??
    null

  return {
    ...prev,
    cells: prev.cells.map((item) =>
      item.id === cellId
        ? {
            ...item,
            status: result.error ? 'error' : 'ok',
            error: result.error,
            lastRunAt: Date.now(),
            consoleLines: [...(item.consoleLines ?? []), ...cellConsoleChunk].slice(-200),
          }
        : item,
    ),
    history,
    historyIndex: history.length - 1,
    plots,
    activePlotId: cellPlotId,
    tables,
    activeTableId: cellTableId,
    env: result.env,
    consoleLines: [
      ...prev.consoleLines,
      `▸ ${cellName}`,
      ...cellConsoleChunk,
    ].slice(-200),
    activePanel,
    sidePanelOpen,
  }
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(buildInitial)
  const sharedRef = useRef(createSharedBag())
  const stateRef = useRef(state)
  stateRef.current = state
  const runLock = useRef(false)

  const persistable = useMemo(
    () => ({
      cells: state.cells,
      activeCellId: state.activeCellId,
      activePanel: state.activePanel,
      sidePanelOpen: false,
      language: state.language,
      kernelStatus: state.kernelStatus,
      scriptPath: state.scriptPath,
      history: [] as WorkspaceState['history'],
      historyIndex: -1,
      plots: [] as WorkspaceState['plots'],
      activePlotId: null,
      tables: [] as WorkspaceState['tables'],
      activeTableId: null,
      env: [] as WorkspaceState['env'],
      consoleLines: [] as string[],
      files: state.files,
    }),
    [
      state.cells,
      state.activeCellId,
      state.activePanel,
      state.language,
      state.kernelStatus,
      state.scriptPath,
      state.files,
    ],
  )

  const saveErrorRef = useRef<string | null>(null)

  useEffect(() => {
    const result = saveWorkspace(persistable)
    if (!result.ok) {
      saveErrorRef.current = result.error
      console.warn('Cello autosave failed:', result.error)
    } else {
      saveErrorRef.current = null
    }
  }, [persistable])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const status = await fetchKernelStatus()
      if (cancelled) return
      setState((prev) => ({
        ...prev,
        kernelStatus: {
          available: status.available,
          version: status.version,
          message: status.message ?? status.error ?? null,
        },
        consoleLines: [
          ...prev.consoleLines,
          status.available
            ? `R kernel ready${status.version ? ` (R ${status.version})` : ''}.`
            : `R kernel unavailable — ${status.message ?? status.error ?? 'unknown reason'}. JS kernel remains available.`,
        ].slice(-200),
      }))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const activeCell = useMemo(
    () => state.cells.find((cell) => cell.id === state.activeCellId) ?? state.cells[0],
    [state.cells, state.activeCellId],
  )

  const scriptText = useMemo(
    () => cellsToScript(state.cells, state.language),
    [state.cells, state.language],
  )

  const setPanel = useCallback((panel: PanelId) => {
    setState((prev) => ({ ...prev, activePanel: panel, sidePanelOpen: true }))
  }, [])

  const toggleSidePanel = useCallback((panel: PanelId) => {
    setState((prev) => {
      if (prev.sidePanelOpen && prev.activePanel === panel) {
        return { ...prev, sidePanelOpen: false }
      }
      return { ...prev, activePanel: panel, sidePanelOpen: true }
    })
  }, [])

  const collapseSidePanel = useCallback(() => {
    setState((prev) => ({ ...prev, sidePanelOpen: false }))
  }, [])

  const selectCell = useCallback((cellId: string, panel?: PanelId) => {
    setState((prev) => {
      const cellPlots = prev.plots.filter((plot) => plot.cellId === cellId)
      const cellTables = prev.tables.filter((table) => table.cellId === cellId)
      const cellHistory = prev.history.filter((entry) => entry.cellId === cellId)
      const latestHistory = cellHistory[cellHistory.length - 1]
      return {
        ...prev,
        activeCellId: cellId,
        activePanel: panel ?? prev.activePanel,
        sidePanelOpen: panel ? true : prev.sidePanelOpen,
        activePlotId: cellPlots[cellPlots.length - 1]?.id ?? null,
        activeTableId: cellTables[cellTables.length - 1]?.id ?? null,
        historyIndex: latestHistory
          ? prev.history.findIndex((entry) => entry.id === latestHistory.id)
          : -1,
      }
    })
  }, [])

  const updateActiveCode = useCallback((code: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === prev.activeCellId ? { ...cell, code, status: 'idle', error: undefined } : cell,
      ),
    }))
  }, [])

  const renameCell = useCallback((cellId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => (cell.id === cellId ? { ...cell, name } : cell)),
    }))
  }, [])

  const addCell = useCallback((afterId?: string) => {
    setState((prev) => {
      const cell: Cell = {
        id: createId('cell'),
        name: `Cell ${prev.cells.length + 1}`,
        code: '',
        status: 'idle',
      }
      const index = afterId
        ? prev.cells.findIndex((item) => item.id === afterId)
        : prev.cells.length - 1
      const next = [...prev.cells]
      next.splice(index + 1, 0, cell)
      return {
        ...prev,
        cells: next,
        activeCellId: cell.id,
        activePanel: 'cells',
        sidePanelOpen: true,
      }
    })
  }, [])

  const deleteCell = useCallback((cellId: string) => {
    setState((prev) => {
      const remaining = prev.cells.filter((cell) => cell.id !== cellId)
      const cells =
        remaining.length === 0
          ? [
              {
                id: createId('cell'),
                name: 'Untitled',
                code: '',
                status: 'idle' as const,
              },
            ]
          : remaining
      const deletedIndex = prev.cells.findIndex((c) => c.id === cellId)
      const activeCellId =
        prev.activeCellId === cellId
          ? remaining.length === 0
            ? cells[0].id
            : cells[Math.max(0, deletedIndex - 1)]?.id ?? cells[0].id
          : prev.activeCellId
      const history = prev.history.filter((entry) => entry.cellId !== cellId)
      const historyIndex =
        history.length === 0 ? -1 : Math.min(prev.historyIndex, history.length - 1)
      return { ...prev, cells, activeCellId, history, historyIndex }
    })
  }, [])

  const moveCell = useCallback((cellId: string, direction: -1 | 1) => {
    setState((prev) => {
      const index = prev.cells.findIndex((cell) => cell.id === cellId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.cells.length) return prev
      const cells = [...prev.cells]
      const [item] = cells.splice(index, 1)
      cells.splice(target, 0, item)
      return { ...prev, cells }
    })
  }, [])

  const setLanguage = useCallback((language: KernelLanguage) => {
    setState((prev) => {
      if (prev.language === language) return prev
      sharedRef.current = createSharedBag()
      const cells = scriptToCells(starterScript(language))
      return {
        ...prev,
        language,
        cells,
        activeCellId: cells[0].id,
        scriptPath: defaultScriptPath(language),
        history: [],
        historyIndex: -1,
        plots: [],
        tables: [],
        env: [],
        activePlotId: null,
        activeTableId: null,
        consoleLines: [
          ...prev.consoleLines,
          language === 'r'
            ? 'Switched to R kernel. Loaded the R starter script.'
            : 'Switched to in-browser JavaScript kernel. Loaded the JS starter script.',
        ].slice(-200),
        activePanel: 'cells',
        sidePanelOpen: false,
      }
    })
    if (language === 'r') {
      void resetRKernel().catch(() => {
        /* status banner already covers unavailability */
      })
    }
  }, [])

  const runCell = useCallback(async (cellId?: string) => {
    if (runLock.current) return
    const snapshot = stateRef.current
    const id = cellId ?? snapshot.activeCellId
    const cell = snapshot.cells.find((item) => item.id === id)
    if (!cell) return

    runLock.current = true
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((item) =>
        item.id === id ? { ...item, status: 'running', error: undefined } : item,
      ),
    }))

    const previousEntry = [...snapshot.history].reverse().find((entry) => entry.cellId === id)
    const previousCode = previousEntry?.code ?? ''

    try {
      let result: RunArtifacts
      if (snapshot.language === 'r') {
        result = await evalOnRKernel(cell.code, id)
      } else {
        result = runCellCode(cell.code, sharedRef.current, { cellId: id })
      }

      setState((prev) =>
        applyRunToState(prev, {
          cellId: id,
          cellName: cell.name,
          code: cell.code,
          previousCode,
          result,
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const result: RunArtifacts = {
        logs: [],
        plot: null,
        table: null,
        env: snapshot.env,
        error: message,
      }
      setState((prev) =>
        applyRunToState(prev, {
          cellId: id,
          cellName: cell.name,
          code: cell.code,
          previousCode,
          result,
        }),
      )
    } finally {
      runLock.current = false
    }
  }, [])

  const runAll = useCallback(async () => {
    if (runLock.current) return
    runLock.current = true
    const snapshot = stateRef.current
    const cells = snapshot.cells
    const priorHistory = snapshot.history

    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => ({ ...cell, status: 'running', error: undefined })),
    }))

    try {
      if (snapshot.language === 'r') {
        const { results, stopped } = await runAllOnRKernel(
          cells.map((cell) => ({ id: cell.id, code: cell.code })),
        )

        setState((prev) => {
          let historyCursor = [...priorHistory]
          const plots = [...prev.plots]
          const tables = [...prev.tables]
          const consoleExtra: string[] = []
          const statusById = new Map<
            string,
            { status: Cell['status']; error?: string; env: RunArtifacts['env'] }
          >()

          results.forEach((result, index) => {
            const cell = cells[index]
            if (!cell) return
            const previousEntry = [...historyCursor]
              .reverse()
              .find((entry) => entry.cellId === cell.id)
            const historyEntry: HistoryEntry = {
              id: createId('hist'),
              cellId: cell.id,
              cellName: cell.name,
              code: cell.code,
              previousCode: previousEntry?.code ?? '',
              timestamp: Date.now(),
              status: result.error ? 'error' : 'ok',
              error: result.error,
              outputText: result.logs.join('\n'),
              plotId: result.plot?.id,
              dataId: result.table?.id,
            }
            historyCursor = [...historyCursor, historyEntry]
            if (result.plot) plots.push(result.plot)
            if (result.table) tables.push(result.table)
            statusById.set(cell.id, {
              status: result.error ? 'error' : 'ok',
              error: result.error,
              env: result.env,
            })
            consoleExtra.push(
              `▸ ${cell.name}`,
              ...(result.logs.length
                ? result.logs
                : [result.error ? `Error: ${result.error}` : '(no output)']),
            )
          })

          const last = results[results.length - 1]
          let activePanel = prev.activePanel
          let sidePanelOpen = prev.sidePanelOpen
          if (last?.plot) {
            activePanel = 'plot'
            sidePanelOpen = true
          } else if (last?.table) {
            activePanel = 'data'
            sidePanelOpen = true
          } else if (last?.error) {
            activePanel = 'history'
            sidePanelOpen = true
          }

          const lastCellId = cells[results.length - 1]?.id
          const lastCellPlots = lastCellId
            ? plots.filter((plot) => plot.cellId === lastCellId)
            : []
          const lastCellTables = lastCellId
            ? tables.filter((table) => table.cellId === lastCellId)
            : []

          return {
            ...prev,
            env: last?.env ?? [],
            plots,
            tables,
            activePlotId: lastCellPlots[lastCellPlots.length - 1]?.id ?? null,
            activeTableId: lastCellTables[lastCellTables.length - 1]?.id ?? null,
            history: historyCursor,
            historyIndex: historyCursor.length - 1,
            consoleLines: [
              ...prev.consoleLines,
              stopped
                ? 'R kernel reset. Running all cells in order (stopped on error)…'
                : 'R kernel reset. Running all cells in order…',
              ...consoleExtra,
            ].slice(-200),
            activePanel,
            sidePanelOpen,
            cells: prev.cells.map((cell) => {
              const batch = statusById.get(cell.id)
              if (!batch) {
                return { ...cell, status: 'idle', error: undefined }
              }
              const result = results[cells.findIndex((item) => item.id === cell.id)]
              const chunk = result
                ? result.logs.length
                  ? result.logs
                  : [result.error ? `Error: ${result.error}` : '(no output)']
                : []
              return {
                ...cell,
                status: batch.status,
                error: batch.error,
                lastRunAt: Date.now(),
                consoleLines: [...(cell.consoleLines ?? []), ...chunk].slice(-200),
              }
            }),
          }
        })
      } else {
        sharedRef.current = createSharedBag()
        const shared = sharedRef.current

        type Batch = {
          cellId: string
          status: Cell['status']
          error?: string
          historyEntry: HistoryEntry
          plot?: NonNullable<RunArtifacts['plot']>
          table?: NonNullable<RunArtifacts['table']>
          env: RunArtifacts['env']
          logs: string[]
        }

        const batches: Batch[] = []
        let historyCursor = [...priorHistory]
        let stopped = false

        for (const cell of cells) {
          const previousEntry = [...historyCursor]
            .reverse()
            .find((entry) => entry.cellId === cell.id)
          const result = runCellCode(cell.code, shared, { cellId: cell.id })
          const historyEntry: HistoryEntry = {
            id: createId('hist'),
            cellId: cell.id,
            cellName: cell.name,
            code: cell.code,
            previousCode: previousEntry?.code ?? '',
            timestamp: Date.now(),
            status: result.error ? 'error' : 'ok',
            error: result.error,
            outputText: result.logs.join('\n'),
            plotId: result.plot?.id,
            dataId: result.table?.id,
          }
          historyCursor = [...historyCursor, historyEntry]
          batches.push({
            cellId: cell.id,
            status: result.error ? 'error' : 'ok',
            error: result.error,
            historyEntry,
            plot: result.plot ?? undefined,
            table: result.table ?? undefined,
            env: result.env,
            logs: result.logs,
          })
          if (result.error) {
            stopped = true
            break
          }
        }

        setState((prev) => {
          const history = [...prev.history, ...batches.map((batch) => batch.historyEntry)]
          const plots = [
            ...prev.plots,
            ...batches.flatMap((batch) => (batch.plot ? [batch.plot] : [])),
          ]
          const tables = [
            ...prev.tables,
            ...batches.flatMap((batch) => (batch.table ? [batch.table] : [])),
          ]
          const last = batches[batches.length - 1]
          let activePanel = prev.activePanel
          let sidePanelOpen = prev.sidePanelOpen
          if (last?.plot) {
            activePanel = 'plot'
            sidePanelOpen = true
          } else if (last?.table) {
            activePanel = 'data'
            sidePanelOpen = true
          } else if (last?.error) {
            activePanel = 'history'
            sidePanelOpen = true
          }

          const consoleLines = [
            ...prev.consoleLines,
            stopped
              ? 'Kernel reset. Running all cells in order (stopped on error)…'
              : 'Kernel reset. Running all cells in order…',
            ...batches.flatMap((batch) => {
              const cell = prev.cells.find((item) => item.id === batch.cellId)
              return [
                `▸ ${cell?.name ?? batch.cellId}`,
                ...(batch.logs.length
                  ? batch.logs
                  : [batch.error ? `Error: ${batch.error}` : '(no output)']),
              ]
            }),
          ].slice(-200)

          const statusById = new Map(batches.map((batch) => [batch.cellId, batch]))

          const lastCellId = last?.cellId
          const lastCellPlots = lastCellId
            ? plots.filter((plot) => plot.cellId === lastCellId)
            : []
          const lastCellTables = lastCellId
            ? tables.filter((table) => table.cellId === lastCellId)
            : []

          return {
            ...prev,
            env: last?.env ?? [],
            plots,
            tables,
            activePlotId: lastCellPlots[lastCellPlots.length - 1]?.id ?? null,
            activeTableId: lastCellTables[lastCellTables.length - 1]?.id ?? null,
            history,
            historyIndex: history.length - 1,
            consoleLines,
            activePanel,
            sidePanelOpen,
            cells: prev.cells.map((cell) => {
              const batch = statusById.get(cell.id)
              if (!batch) {
                return { ...cell, status: 'idle', error: undefined }
              }
              const chunk = batch.logs.length
                ? batch.logs
                : [batch.error ? `Error: ${batch.error}` : '(no output)']
              return {
                ...cell,
                status: batch.status,
                error: batch.error,
                lastRunAt: Date.now(),
                consoleLines: [...(cell.consoleLines ?? []), ...chunk].slice(-200),
              }
            }),
          }
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({
        ...prev,
        cells: prev.cells.map((cell) => ({
          ...cell,
          status: 'error',
          error: message,
        })),
        consoleLines: [...prev.consoleLines, `Error: ${message}`].slice(-200),
        activePanel: 'console',
        sidePanelOpen: true,
      }))
    } finally {
      runLock.current = false
    }
  }, [])

  const resetKernel = useCallback(async () => {
    sharedRef.current = createSharedBag()
    if (stateRef.current.language === 'r') {
      try {
        await resetRKernel()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setState((prev) => ({
          ...prev,
          consoleLines: [...prev.consoleLines, `R reset failed: ${message}`].slice(-200),
        }))
      }
    }
    setState((prev) => ({
      ...prev,
      env: [],
      plots: [],
      tables: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: ['Kernel cleared.'],
      cells: prev.cells.map((cell) => ({
        ...cell,
        status: 'idle',
        error: undefined,
        consoleLines: [],
      })),
    }))
  }, [])

  const setHistoryIndex = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.history.length) return prev
      const entry = prev.history[index]
      const cellExists = prev.cells.some((cell) => cell.id === entry.cellId)
      return {
        ...prev,
        historyIndex: index,
        activeCellId: cellExists ? entry.cellId : prev.activeCellId,
        activePlotId: entry.plotId ?? prev.activePlotId,
        activeTableId: entry.dataId ?? prev.activeTableId,
      }
    })
  }, [])

  const restoreHistoryCode = useCallback(() => {
    setState((prev) => {
      const entry = prev.history[prev.historyIndex]
      if (!entry) return prev
      const cellExists = prev.cells.some((cell) => cell.id === entry.cellId)
      if (!cellExists) {
        return {
          ...prev,
          consoleLines: [
            ...prev.consoleLines,
            `warn: cannot restore — cell "${entry.cellName}" no longer exists`,
          ].slice(-200),
        }
      }
      return {
        ...prev,
        cells: prev.cells.map((cell) =>
          cell.id === entry.cellId
            ? { ...cell, code: entry.code, status: 'idle', error: undefined }
            : cell,
        ),
        activeCellId: entry.cellId,
        activePanel: 'cells',
        sidePanelOpen: true,
      }
    })
  }, [])

  const exportScript = useCallback(() => scriptText, [scriptText])

  const importScript = useCallback((text: string) => {
    sharedRef.current = createSharedBag()
    const cells = scriptToCells(text)
    const language: KernelLanguage = /^\s*#\s*%%/m.test(text)
      ? 'r'
      : stateRef.current.language
    setState((prev) => ({
      ...prev,
      language,
      cells,
      activeCellId: cells[0].id,
      scriptPath: defaultScriptPath(language),
      history: [],
      historyIndex: -1,
      plots: [],
      tables: [],
      env: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: [
        `Imported script with ${language === 'r' ? '# %%' : '// %%'} cell markers.`,
      ],
      activePanel: 'cells',
      sidePanelOpen: false,
    }))
  }, [])

  return {
    state,
    activeCell,
    scriptText,
    setPanel,
    toggleSidePanel,
    collapseSidePanel,
    selectCell,
    updateActiveCode,
    renameCell,
    addCell,
    deleteCell,
    moveCell,
    setLanguage,
    runCell,
    runAll,
    resetKernel,
    setHistoryIndex,
    restoreHistoryCode,
    exportScript,
    importScript,
  }
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>
