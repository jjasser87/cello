import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  configureKernelRscript,
  evalOnRKernel,
  fetchKernelStatus,
  resetRKernel,
  runAllOnRKernel,
} from '../lib/kernelClient'
import { loadSettings, saveSettings, type HelperDock } from '../lib/settings'
import { createSharedBag, runCellCode, type RunArtifacts } from '../lib/runtime'
import { createComment, emptyExplanationTemplate } from '../lib/explanation'
import {
  addFileChild,
  defaultProjectFiles,
  defaultProjectName,
  deleteFileNode,
  hydratePersistedCell,
  parseProject,
  pathFromRoot,
  renameFileNode,
  type CelloProjectV1,
} from '../lib/projectFile'
import {
  createId,
  cellsToScript,
  defaultScriptPath,
  scriptToCells,
  starterScript,
} from '../lib/script'
import { packageRunOutputs } from '../lib/runArtifacts'
import {
  restoreCellCode,
  sourceCodeForConsole,
  sourceCodeForPlot,
  sourceCodeForTable,
} from '../lib/panelRestore'
import { loadWorkspace, saveWorkspace } from '../lib/storage'
import type {
  Cell,
  HistoryEntry,
  KernelLanguage,
  PanelId,
  WorkspaceState,
} from '../types'

function buildFromProject(
  project: CelloProjectV1,
  extras?: Partial<Pick<WorkspaceState, 'kernelStatus' | 'consoleLines' | 'sidePanelOpen'>>,
): WorkspaceState {
  const cells = project.cells.map((cell) => hydratePersistedCell(cell))
  return {
    cells,
    activeCellId: cells.some((c) => c.id === project.activeCellId)
      ? project.activeCellId
      : cells[0].id,
    activePanel: project.activePanel,
    sidePanelOpen: extras?.sidePanelOpen ?? false,
    helperDock: loadSettings().helperDock,
    language: project.language,
    kernelStatus: extras?.kernelStatus ?? {
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
    consoleEntries: [],
    activeConsoleId: null,
    env: [],
    consoleLines: extras?.consoleLines ?? ['Ready. Run a cell with ⌘/Ctrl+Enter.'],
    files: project.files,
    meta: project.meta,
    scriptPath: project.scriptPath,
  }
}

function buildFresh(language: KernelLanguage = 'r', name = defaultProjectName()): WorkspaceState {
  const cells = scriptToCells(starterScript(language))
  const now = Date.now()
  return {
    cells,
    activeCellId: cells[0].id,
    activePanel: 'cells',
    sidePanelOpen: false,
    helperDock: loadSettings().helperDock,
    language,
    kernelStatus: {
      available: false,
      version: null,
      message: 'Checking R kernel…',
      rscriptPath: null,
      rscriptOverride: loadSettings().rscriptPath,
    },
    history: [],
    historyIndex: -1,
    plots: [],
    activePlotId: null,
    tables: [],
    activeTableId: null,
    consoleEntries: [],
    activeConsoleId: null,
    env: [],
    consoleLines: ['Ready. Run a cell with ⌘/Ctrl+Enter.'],
    files: defaultProjectFiles(name, language),
    meta: { name, createdAt: now, updatedAt: now },
    scriptPath: defaultScriptPath(language),
  }
}

function buildInitial(): WorkspaceState {
  const saved = loadWorkspace()
  if (saved) return buildFromProject(saved)
  return buildFresh('r')
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
  const packaged = packageRunOutputs({ cellId, cellName, code, previousCode, result })

  const plots = packaged.plot ? [...prev.plots, packaged.plot] : prev.plots
  const tables = packaged.table ? [...prev.tables, packaged.table] : prev.tables
  const consoleEntries = [...prev.consoleEntries, packaged.consoleEntry]
  const history = [...prev.history, packaged.historyEntry]
  let activePanel = prev.activePanel
  let sidePanelOpen = prev.sidePanelOpen
  if (packaged.plot) {
    activePanel = 'plot'
    sidePanelOpen = true
  } else if (packaged.table) {
    activePanel = 'data'
    sidePanelOpen = true
  } else if (result.error) {
    activePanel = 'history'
    sidePanelOpen = true
  }

  const cellConsoleChunk = packaged.consoleEntry.text.split('\n')
  const cellPlotId =
    packaged.plot?.id ??
    [...plots].reverse().find((plot) => plot.cellId === cellId)?.id ??
    null
  const cellTableId =
    packaged.table?.id ??
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
    consoleEntries,
    activeConsoleId: packaged.consoleEntry.id,
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
      // App setting (also in localStorage settings); included so the object
      // satisfies WorkspaceState for saveWorkspace typing.
      helperDock: state.helperDock,
      language: state.language,
      kernelStatus: state.kernelStatus,
      scriptPath: state.scriptPath,
      history: [] as WorkspaceState['history'],
      historyIndex: -1,
      plots: [] as WorkspaceState['plots'],
      activePlotId: null,
      tables: [] as WorkspaceState['tables'],
      activeTableId: null,
      consoleEntries: [] as WorkspaceState['consoleEntries'],
      activeConsoleId: null,
      env: [] as WorkspaceState['env'],
      consoleLines: [] as string[],
      files: state.files,
      meta: state.meta,
    }),
    [
      state.cells,
      state.activeCellId,
      state.activePanel,
      state.helperDock,
      state.language,
      state.kernelStatus,
      state.scriptPath,
      state.files,
      state.meta,
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
      const savedPath = loadSettings().rscriptPath
      let status =
        savedPath != null
          ? await configureKernelRscript(savedPath).catch(async () => fetchKernelStatus())
          : await fetchKernelStatus()
      if (cancelled) return
      // If configure soft-failed at the network layer, still refresh status.
      if (savedPath != null && status.rscriptOverride === undefined) {
        status = await fetchKernelStatus()
      }
      if (cancelled) return
      setState((prev) => ({
        ...prev,
        kernelStatus: {
          available: status.available,
          version: status.version,
          message: status.message ?? status.error ?? null,
          rscriptPath: status.rscriptPath ?? null,
          rscriptOverride: status.rscriptOverride ?? savedPath,
        },
        consoleLines: [
          ...prev.consoleLines,
          status.available
            ? `R kernel ready${status.version ? ` (R ${status.version})` : ''}${
                status.rscriptPath ? ` · ${status.rscriptPath}` : ''
              }.`
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
      const cellConsole = prev.consoleEntries.filter((entry) => entry.cellId === cellId)
      const cellHistory = prev.history.filter((entry) => entry.cellId === cellId)
      const latestHistory = cellHistory[cellHistory.length - 1]
      return {
        ...prev,
        activeCellId: cellId,
        activePanel: panel ?? prev.activePanel,
        sidePanelOpen: panel ? true : prev.sidePanelOpen,
        activePlotId: cellPlots[cellPlots.length - 1]?.id ?? null,
        activeTableId: cellTables[cellTables.length - 1]?.id ?? null,
        activeConsoleId: cellConsole[cellConsole.length - 1]?.id ?? null,
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

  const updateExplanation = useCallback((cellId: string, explanation: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => (cell.id === cellId ? { ...cell, explanation } : cell)),
    }))
  }, [])

  const addExplanationComment = useCallback((cellId: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const comment = createComment(trimmed, 'user')
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === cellId ? { ...cell, comments: [...(cell.comments ?? []), comment] } : cell,
      ),
    }))
  }, [])

  const addCell = useCallback((afterId?: string) => {
    setState((prev) => {
      const cell: Cell = {
        id: createId('cell'),
        name: `Cell ${prev.cells.length + 1}`,
        code: '',
        status: 'idle',
        explanation: emptyExplanationTemplate(),
        comments: [],
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
                explanation: emptyExplanationTemplate(),
                comments: [],
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
      const plots = prev.plots.filter((plot) => plot.cellId !== cellId)
      const tables = prev.tables.filter((table) => table.cellId !== cellId)
      const consoleEntries = prev.consoleEntries.filter((entry) => entry.cellId !== cellId)
      return {
        ...prev,
        cells,
        activeCellId,
        history,
        historyIndex,
        plots,
        tables,
        consoleEntries,
        activePlotId: plots.find((plot) => plot.cellId === activeCellId)?.id
          ?? plots[plots.length - 1]?.id
          ?? null,
        activeTableId: tables.find((table) => table.cellId === activeCellId)?.id
          ?? tables[tables.length - 1]?.id
          ?? null,
        activeConsoleId: consoleEntries.find((entry) => entry.cellId === activeCellId)?.id
          ?? consoleEntries[consoleEntries.length - 1]?.id
          ?? null,
      }
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
      const scriptPath = defaultScriptPath(language)
      return {
        ...prev,
        language,
        cells,
        activeCellId: cells[0].id,
        scriptPath,
        history: [],
        historyIndex: -1,
        plots: [],
        tables: [],
        consoleEntries: [],
        env: [],
        activePlotId: null,
        activeTableId: null,
        activeConsoleId: null,
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

  const newProject = useCallback((language?: KernelLanguage) => {
    sharedRef.current = createSharedBag()
    const lang = language ?? stateRef.current.language
    setState((prev) => {
      // Distinct name so the Files panel clearly shows a fresh project.
      const fresh = buildFresh(lang, 'untitled')
      return {
        ...fresh,
        kernelStatus: prev.kernelStatus,
        consoleLines: [
          `New project “${fresh.meta.name}” (${lang === 'r' ? 'R' : 'JS'}).`,
        ],
        activePanel: 'files',
        sidePanelOpen: true,
      }
    })
    if (lang === 'r') {
      void resetRKernel().catch(() => {
        /* status banner already covers unavailability */
      })
    }
  }, [])

  const openProjectJson = useCallback((raw: string): { ok: true } | { ok: false; error: string } => {
    const parsed = parseProject(raw)
    if (!parsed.ok) return parsed
    sharedRef.current = createSharedBag()
    setState((prev) => {
      const next = buildFromProject(parsed.project, {
        kernelStatus: prev.kernelStatus,
        consoleLines: [
          `Opened project “${parsed.project.meta.name}” (${parsed.project.cells.length} cells).`,
        ],
        sidePanelOpen: true,
      })
      return { ...next, activePanel: 'files', sidePanelOpen: true }
    })
    if (parsed.project.language === 'r') {
      void resetRKernel().catch(() => {
        /* ignore */
      })
    }
    return { ok: true }
  }, [])

  const renameProject = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setState((prev) => {
      const files =
        prev.files[0]?.kind === 'folder'
          ? [{ ...prev.files[0], name: trimmed }, ...prev.files.slice(1)]
          : prev.files
      return {
        ...prev,
        files,
        meta: { ...prev.meta, name: trimmed, updatedAt: Date.now() },
      }
    })
  }, [])

  const renameProjectFile = useCallback((id: string, name: string) => {
    setState((prev) => {
      const files = renameFileNode(prev.files, id, name)
      const root = files[0]
      const meta =
        root?.kind === 'folder' && root.id === id
          ? { ...prev.meta, name: root.name, updatedAt: Date.now() }
          : { ...prev.meta, updatedAt: Date.now() }
      // Keep scriptPath in sync when the active file is renamed.
      const path = pathFromRoot(files, id)
      let scriptPath = prev.scriptPath
      if (path && prev.scriptPath) {
        const oldPath = pathFromRoot(prev.files, id)
        if (oldPath && oldPath === prev.scriptPath) scriptPath = path
      }
      return { ...prev, files, meta, scriptPath }
    })
  }, [])

  const addProjectFile = useCallback(
    (parentId: string, kind: 'file' | 'folder', name: string) => {
      setState((prev) => ({
        ...prev,
        files: addFileChild(prev.files, parentId, kind, name),
        meta: { ...prev.meta, updatedAt: Date.now() },
      }))
    },
    [],
  )

  const deleteProjectFile = useCallback((id: string) => {
    setState((prev) => {
      // Never delete the project root.
      if (prev.files[0]?.id === id) return prev
      return {
        ...prev,
        files: deleteFileNode(prev.files, id),
        meta: { ...prev.meta, updatedAt: Date.now() },
      }
    })
  }, [])

  const selectProjectFile = useCallback((id: string) => {
    setState((prev) => {
      const path = pathFromRoot(prev.files, id)
      if (path === null || path === '') return prev
      return {
        ...prev,
        scriptPath: path,
        activePanel: 'files',
        sidePanelOpen: true,
      }
    })
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
          const consoleEntries = [...prev.consoleEntries]
          const consoleExtra: string[] = []
          const statusById = new Map<
            string,
            { status: Cell['status']; error?: string; env: RunArtifacts['env'] }
          >()
          let lastConsoleId: string | null = null

          results.forEach((result, index) => {
            const cell = cells[index]
            if (!cell) return
            const previousEntry = [...historyCursor]
              .reverse()
              .find((entry) => entry.cellId === cell.id)
            const packaged = packageRunOutputs({
              cellId: cell.id,
              cellName: cell.name,
              code: cell.code,
              previousCode: previousEntry?.code ?? '',
              result,
            })
            historyCursor = [...historyCursor, packaged.historyEntry]
            if (packaged.plot) plots.push(packaged.plot)
            if (packaged.table) tables.push(packaged.table)
            consoleEntries.push(packaged.consoleEntry)
            lastConsoleId = packaged.consoleEntry.id
            statusById.set(cell.id, {
              status: result.error ? 'error' : 'ok',
              error: result.error,
              env: result.env,
            })
            consoleExtra.push(`▸ ${cell.name}`, packaged.consoleEntry.text)
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
          const lastCellConsole = lastCellId
            ? consoleEntries.filter((entry) => entry.cellId === lastCellId)
            : []

          return {
            ...prev,
            env: last?.env ?? [],
            plots,
            tables,
            consoleEntries,
            activePlotId: lastCellPlots[lastCellPlots.length - 1]?.id ?? null,
            activeTableId: lastCellTables[lastCellTables.length - 1]?.id ?? null,
            activeConsoleId: lastCellConsole[lastCellConsole.length - 1]?.id ?? lastConsoleId,
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
          consoleEntry: ReturnType<typeof packageRunOutputs>['consoleEntry']
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
          const packaged = packageRunOutputs({
            cellId: cell.id,
            cellName: cell.name,
            code: cell.code,
            previousCode: previousEntry?.code ?? '',
            result,
          })
          historyCursor = [...historyCursor, packaged.historyEntry]
          batches.push({
            cellId: cell.id,
            status: result.error ? 'error' : 'ok',
            error: result.error,
            historyEntry: packaged.historyEntry,
            plot: packaged.plot ?? undefined,
            table: packaged.table ?? undefined,
            consoleEntry: packaged.consoleEntry,
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
          const consoleEntries = [
            ...prev.consoleEntries,
            ...batches.map((batch) => batch.consoleEntry),
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
              return [`▸ ${cell?.name ?? batch.cellId}`, batch.consoleEntry.text]
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
          const lastCellConsole = lastCellId
            ? consoleEntries.filter((entry) => entry.cellId === lastCellId)
            : []

          return {
            ...prev,
            env: last?.env ?? [],
            plots,
            tables,
            consoleEntries,
            activePlotId: lastCellPlots[lastCellPlots.length - 1]?.id ?? null,
            activeTableId: lastCellTables[lastCellTables.length - 1]?.id ?? null,
            activeConsoleId: lastCellConsole[lastCellConsole.length - 1]?.id ?? null,
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
      consoleEntries: [],
      activePlotId: null,
      activeTableId: null,
      activeConsoleId: null,
      consoleLines: ['Kernel cleared.'],
      cells: prev.cells.map((cell) => ({
        ...cell,
        status: 'idle',
        error: undefined,
        consoleLines: [],
      })),
    }))
  }, [])

  /** Browse code history — restores the cell source for that run. */
  const setHistoryIndex = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.history.length) return prev
      const entry = prev.history[index]
      const cellExists = prev.cells.some((cell) => cell.id === entry.cellId)
      if (!cellExists) {
        return {
          ...prev,
          historyIndex: index,
          consoleLines: [
            ...prev.consoleLines,
            `warn: cannot restore — cell "${entry.cellName}" no longer exists`,
          ].slice(-200),
        }
      }
      return {
        ...prev,
        historyIndex: index,
        activeCellId: entry.cellId,
        cells: restoreCellCode(prev.cells, entry.cellId, entry.code),
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
        cells: restoreCellCode(prev.cells, entry.cellId, entry.code),
        activeCellId: entry.cellId,
      }
    })
  }, [])

  /** Browse prior plots — restores the cell source that produced the plot. */
  const setActivePlotId = useCallback((plotId: string) => {
    setState((prev) => {
      const plot = prev.plots.find((item) => item.id === plotId)
      if (!plot) return prev
      const source = sourceCodeForPlot(plot, prev.history)
      const historyIndex = plot.historyId
        ? prev.history.findIndex((entry) => entry.id === plot.historyId)
        : prev.history.findIndex((entry) => entry.plotId === plot.id)
      return {
        ...prev,
        activePlotId: plotId,
        activeCellId: plot.cellId,
        cells: source ? restoreCellCode(prev.cells, plot.cellId, source) : prev.cells,
        historyIndex: historyIndex >= 0 ? historyIndex : prev.historyIndex,
      }
    })
  }, [])

  /** Browse prior tables — restores the cell source that produced the table. */
  const setActiveTableId = useCallback((tableId: string) => {
    setState((prev) => {
      const table = prev.tables.find((item) => item.id === tableId)
      if (!table) return prev
      const source = sourceCodeForTable(table, prev.history)
      const historyIndex = table.historyId
        ? prev.history.findIndex((entry) => entry.id === table.historyId)
        : prev.history.findIndex((entry) => entry.dataId === table.id)
      return {
        ...prev,
        activeTableId: tableId,
        activeCellId: table.cellId,
        cells: source ? restoreCellCode(prev.cells, table.cellId, source) : prev.cells,
        historyIndex: historyIndex >= 0 ? historyIndex : prev.historyIndex,
      }
    })
  }, [])

  /** Browse prior console runs — restores the cell source for that run. */
  const setActiveConsoleId = useCallback((consoleId: string) => {
    setState((prev) => {
      const entry = prev.consoleEntries.find((item) => item.id === consoleId)
      if (!entry) return prev
      const source = sourceCodeForConsole(entry, prev.history)
      const historyIndex = entry.historyId
        ? prev.history.findIndex((item) => item.id === entry.historyId)
        : -1
      return {
        ...prev,
        activeConsoleId: consoleId,
        activeCellId: entry.cellId,
        cells: source ? restoreCellCode(prev.cells, entry.cellId, source) : prev.cells,
        historyIndex: historyIndex >= 0 ? historyIndex : prev.historyIndex,
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
      consoleEntries: [],
      env: [],
      activePlotId: null,
      activeTableId: null,
      activeConsoleId: null,
      consoleLines: [
        `Imported script with ${language === 'r' ? '# %%' : '// %%'} cell markers.`,
      ],
      activePanel: 'cells',
      sidePanelOpen: false,
      meta: { ...prev.meta, updatedAt: Date.now() },
    }))
  }, [])

  const setRscriptPath = useCallback(async (rscriptPath: string | null) => {
    const saved = saveSettings({ rscriptPath })
    try {
      const status = await configureKernelRscript(saved.rscriptPath)
      setState((prev) => ({
        ...prev,
        kernelStatus: {
          available: status.available,
          version: status.version,
          message: status.message ?? status.error ?? null,
          rscriptPath: status.rscriptPath ?? null,
          rscriptOverride: status.rscriptOverride ?? saved.rscriptPath,
        },
        consoleLines: [
          ...prev.consoleLines,
          saved.rscriptPath
            ? status.available
              ? `R path set to ${status.rscriptPath ?? saved.rscriptPath}.`
              : `R path set to ${saved.rscriptPath}, but kernel failed: ${status.message ?? status.error ?? 'unknown'}.`
            : status.available
              ? `R path cleared — using ${status.rscriptPath ?? 'auto-discovery'}.`
              : `R path cleared — ${status.message ?? status.error ?? 'R still unavailable'}.`,
        ].slice(-200),
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({
        ...prev,
        kernelStatus: {
          ...prev.kernelStatus,
          available: false,
          message,
          rscriptOverride: saved.rscriptPath,
        },
        consoleLines: [...prev.consoleLines, `Could not apply R path: ${message}`].slice(-200),
      }))
    }
  }, [])

  const setHelperDock = useCallback((helperDock: HelperDock) => {
    const saved = saveSettings({ helperDock })
    setState((prev) => ({ ...prev, helperDock: saved.helperDock }))
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
    updateExplanation,
    addExplanationComment,
    addCell,
    deleteCell,
    moveCell,
    setLanguage,
    setRscriptPath,
    setHelperDock,
    newProject,
    openProjectJson,
    renameProject,
    renameProjectFile,
    addProjectFile,
    deleteProjectFile,
    selectProjectFile,
    runCell,
    runAll,
    resetKernel,
    setHistoryIndex,
    restoreHistoryCode,
    setActivePlotId,
    setActiveTableId,
    setActiveConsoleId,
    exportScript,
    importScript,
  }
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>
