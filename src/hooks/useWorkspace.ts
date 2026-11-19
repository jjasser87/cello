import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSharedBag, runCellCode } from '../lib/runtime'
import { STARTER_SCRIPT, cellsToScript, createId, scriptToCells } from '../lib/script'
import { loadWorkspace, saveWorkspace } from '../lib/storage'
import type {
  Cell,
  HistoryEntry,
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
      { id: 'file_analysis', name: 'analysis.js', kind: 'file' },
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

function buildInitial(): WorkspaceState {
  const saved = loadWorkspace()
  const cells =
    saved?.cells?.length
      ? saved.cells.map((cell) => ({
          ...cell,
          status: 'idle' as const,
        }))
      : scriptToCells(STARTER_SCRIPT)

  return {
    cells,
    activeCellId: saved?.activeCellId && cells.some((c) => c.id === saved.activeCellId)
      ? saved.activeCellId
      : cells[0].id,
    activePanel: saved?.activePanel ?? 'cells',
    history: [],
    historyIndex: -1,
    plots: [],
    activePlotId: null,
    tables: [],
    activeTableId: null,
    env: [],
    consoleLines: ['Ready. Run a cell with ⌘/Ctrl+Enter.'],
    files: DEFAULT_FILES,
    scriptPath: saved?.scriptPath ?? 'analysis.js',
  }
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(buildInitial)
  const sharedRef = useRef(createSharedBag())

  const persistable = useMemo(
    () => ({
      cells: state.cells,
      activeCellId: state.activeCellId,
      activePanel: state.activePanel,
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
    [state.cells, state.activeCellId, state.activePanel, state.scriptPath, state.files],
  )

  useEffect(() => {
    saveWorkspace(persistable)
  }, [persistable])

  const activeCell = useMemo(
    () => state.cells.find((cell) => cell.id === state.activeCellId) ?? state.cells[0],
    [state.cells, state.activeCellId],
  )

  const scriptText = useMemo(() => cellsToScript(state.cells), [state.cells])

  const setPanel = useCallback((panel: PanelId) => {
    setState((prev) => ({ ...prev, activePanel: panel }))
  }, [])

  const selectCell = useCallback((cellId: string, panel?: PanelId) => {
    setState((prev) => ({
      ...prev,
      activeCellId: cellId,
      activePanel: panel ?? prev.activePanel,
    }))
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
      return { ...prev, cells: next, activeCellId: cell.id, activePanel: 'cells' }
    })
  }, [])

  const deleteCell = useCallback((cellId: string) => {
    setState((prev) => {
      if (prev.cells.length <= 1) return prev
      const cells = prev.cells.filter((cell) => cell.id !== cellId)
      const activeCellId =
        prev.activeCellId === cellId
          ? cells[Math.max(0, prev.cells.findIndex((c) => c.id === cellId) - 1)]?.id ??
            cells[0].id
          : prev.activeCellId
      return { ...prev, cells, activeCellId }
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

  const runCell = useCallback(
    (cellId?: string) => {
      const id = cellId ?? state.activeCellId
      const cell = state.cells.find((item) => item.id === id)
      if (!cell) return

      setState((prev) => ({
        ...prev,
        cells: prev.cells.map((item) =>
          item.id === id ? { ...item, status: 'running', error: undefined } : item,
        ),
      }))

      const previousEntry = [...state.history].reverse().find((entry) => entry.cellId === id)
      const previousCode = previousEntry?.code ?? ''
      const result = runCellCode(cell.code, sharedRef.current, { cellId: id })

      const historyEntry: HistoryEntry = {
        id: createId('hist'),
        cellId: id,
        cellName: cell.name,
        code: cell.code,
        previousCode,
        timestamp: Date.now(),
        status: result.error ? 'error' : 'ok',
        error: result.error,
        outputText: result.logs.join('\n'),
        plotId: result.plot?.id,
        dataId: result.table?.id,
      }

      setState((prev) => {
        const plots = result.plot ? [...prev.plots, result.plot] : prev.plots
        const tables = result.table ? [...prev.tables, result.table] : prev.tables
        const history = [...prev.history, historyEntry]
        let activePanel = prev.activePanel
        if (result.plot) activePanel = 'plot'
        else if (result.table) activePanel = 'data'
        else if (result.error) activePanel = 'history'

        return {
          ...prev,
          cells: prev.cells.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: result.error ? 'error' : 'ok',
                  error: result.error,
                  lastRunAt: Date.now(),
                }
              : item,
          ),
          history,
          historyIndex: history.length - 1,
          plots,
          activePlotId: result.plot?.id ?? prev.activePlotId,
          tables,
          activeTableId: result.table?.id ?? prev.activeTableId,
          env: result.env,
          consoleLines: [
            ...prev.consoleLines,
            `▸ ${cell.name}`,
            ...(result.logs.length ? result.logs : [result.error ? `Error: ${result.error}` : '(no output)']),
          ].slice(-200),
          activePanel,
        }
      })
    },
    [state.activeCellId, state.cells, state.history],
  )

  const runAll = useCallback(() => {
    sharedRef.current = createSharedBag()
    setState((prev) => ({
      ...prev,
      env: [],
      plots: [],
      tables: [],
      activePlotId: null,
      activeTableId: null,
      history: [],
      historyIndex: -1,
      consoleLines: ['Kernel reset. Running all cells in order…'],
      cells: prev.cells.map((cell) => ({ ...cell, status: 'idle', error: undefined })),
    }))

    // Sequential run against fresh shared env
    queueMicrotask(() => {
      const shared = sharedRef.current
      setState((prev) => {
        let working = { ...prev }
        for (const cell of prev.cells) {
          const previousEntry = [...working.history]
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
          working = {
            ...working,
            cells: working.cells.map((item) =>
              item.id === cell.id
                ? {
                    ...item,
                    status: result.error ? 'error' : 'ok',
                    error: result.error,
                    lastRunAt: Date.now(),
                  }
                : item,
            ),
            history: [...working.history, historyEntry],
            historyIndex: working.history.length,
            plots: result.plot ? [...working.plots, result.plot] : working.plots,
            tables: result.table ? [...working.tables, result.table] : working.tables,
            activePlotId: result.plot?.id ?? working.activePlotId,
            activeTableId: result.table?.id ?? working.activeTableId,
            env: result.env,
            consoleLines: [
              ...working.consoleLines,
              `▸ ${cell.name}`,
              ...(result.logs.length
                ? result.logs
                : [result.error ? `Error: ${result.error}` : '(no output)']),
            ],
            activePanel: result.plot
              ? 'plot'
              : result.table
                ? 'data'
                : working.activePanel,
          }
          if (result.error) break
        }
        return working
      })
    })
  }, [])

  const resetKernel = useCallback(() => {
    sharedRef.current = createSharedBag()
    setState((prev) => ({
      ...prev,
      env: [],
      plots: [],
      tables: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: ['Kernel cleared.'],
      cells: prev.cells.map((cell) => ({ ...cell, status: 'idle', error: undefined })),
    }))
  }, [])

  const setHistoryIndex = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.history.length) return prev
      const entry = prev.history[index]
      return {
        ...prev,
        historyIndex: index,
        activeCellId: entry.cellId,
        activePlotId: entry.plotId ?? prev.activePlotId,
        activeTableId: entry.dataId ?? prev.activeTableId,
      }
    })
  }, [])

  const restoreHistoryCode = useCallback(() => {
    setState((prev) => {
      const entry = prev.history[prev.historyIndex]
      if (!entry) return prev
      return {
        ...prev,
        cells: prev.cells.map((cell) =>
          cell.id === entry.cellId
            ? { ...cell, code: entry.code, status: 'idle', error: undefined }
            : cell,
        ),
        activeCellId: entry.cellId,
        activePanel: 'cells',
      }
    })
  }, [])

  const exportScript = useCallback(() => scriptText, [scriptText])

  const importScript = useCallback((text: string) => {
    sharedRef.current = createSharedBag()
    const cells = scriptToCells(text)
    setState((prev) => ({
      ...prev,
      cells,
      activeCellId: cells[0].id,
      history: [],
      historyIndex: -1,
      plots: [],
      tables: [],
      env: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: ['Imported script with # %% cell markers.'],
      activePanel: 'cells',
    }))
  }, [])

  return {
    state,
    activeCell,
    scriptText,
    setPanel,
    selectCell,
    updateActiveCode,
    renameCell,
    addCell,
    deleteCell,
    moveCell,
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
