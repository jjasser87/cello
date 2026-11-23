import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ARTIFACTS_FILE,
  HISTORY_FILE,
  RUNS_DIR,
  UI_FILE,
  buildSidecarArtifacts,
  buildSidecarHistory,
  buildSidecarUi,
  mergeParsedSidecar,
  parseSidecarHistory,
  planSidecarWrites,
  stringifySidecarDoc,
} from './folderSidecar.ts'
import type { WorkspaceState } from '../types.ts'

function baseState(over: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    cells: [
      {
        id: 'cell_a',
        name: 'Load',
        code: 'x <- 1:3',
        status: 'ok',
        explanation: '## Purpose\n\nLoad\n',
        comments: [],
      },
    ],
    activeCellId: 'cell_a',
    activePanel: 'plot',
    sidePanelOpen: true,
    helperDock: 'right',
    language: 'r',
    kernelStatus: { available: true, version: '4.3', message: null },
    history: [
      {
        id: 'hist_1',
        cellId: 'cell_a',
        cellName: 'Load',
        code: 'x <- 1:3',
        previousCode: '',
        timestamp: 100,
        status: 'ok',
      },
    ],
    historyIndex: 0,
    plots: [
      {
        id: 'plot_1',
        cellId: 'cell_a',
        title: 'Plot',
        kind: 'bar',
        labels: ['a'],
        values: [1],
        createdAt: 100,
        sourceCode: 'x <- 1:3',
        historyId: 'hist_1',
      },
    ],
    activePlotId: 'plot_1',
    tables: [],
    activeTableId: null,
    consoleEntries: [
      {
        id: 'con_1',
        cellId: 'cell_a',
        text: '[1] 1 2 3',
        timestamp: 100,
        status: 'ok',
        sourceCode: 'x <- 1:3',
        historyId: 'hist_1',
      },
    ],
    activeConsoleId: 'con_1',
    env: [],
    consoleLines: [],
    files: [],
    meta: { name: 'demo', createdAt: 1, updatedAt: 1 },
    scriptPath: 'analysis.R',
    projectRoot: '/tmp/demo',
    filesSource: 'disk',
    saveOutputs: false,
    hideSidecar: true,
    ...over,
  }
}

describe('folder sidecar (structure B)', () => {
  it('always plans history.json + ui.json on save', () => {
    const plan = planSidecarWrites(baseState({ saveOutputs: false }))
    const paths = plan.files.map((f) => f.relativePath)
    assert.deepEqual(paths, [`.cello/${HISTORY_FILE}`, `.cello/${UI_FILE}`])
    const history = JSON.parse(plan.files[0].contents) as { entries: unknown[] }
    assert.equal(history.entries.length, 1)
    assert.equal((history.entries[0] as { code: string }).code, 'x <- 1:3')
  })

  it('includes runs/artifacts.json when saveOutputs is on', () => {
    const plan = planSidecarWrites(baseState({ saveOutputs: true }))
    const paths = plan.files.map((f) => f.relativePath)
    assert.equal(paths.includes(`.cello/${RUNS_DIR}/${ARTIFACTS_FILE}`), true)
    const arts = JSON.parse(plan.files[2].contents) as {
      plots: unknown[]
      consoleEntries: unknown[]
    }
    assert.equal(arts.plots.length, 1)
    assert.equal(arts.consoleEntries.length, 1)
  })

  it('round-trips history + artifacts through mergeParsedSidecar', () => {
    const state = baseState({ saveOutputs: true })
    const loaded = mergeParsedSidecar({
      historyText: stringifySidecarDoc(buildSidecarHistory(state)),
      uiText: stringifySidecarDoc(buildSidecarUi(state)),
      artifactsText: stringifySidecarDoc(buildSidecarArtifacts(state)),
    })
    assert.equal(loaded.history.length, 1)
    assert.equal(loaded.history[0].code, 'x <- 1:3')
    assert.equal(loaded.plots.length, 1)
    assert.equal(loaded.ui.saveOutputs, true)
    assert.equal(loaded.ui.activePanel, 'plot')
  })

  it('parseSidecarHistory skips corrupt rows', () => {
    const entries = parseSidecarHistory({
      version: 1,
      entries: [{ id: 'x' }, { id: 'h', cellId: 'c', code: '1', timestamp: 1 }],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].id, 'h')
  })
})
