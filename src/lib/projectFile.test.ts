import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  addFileChild,
  defaultProjectFiles,
  deleteFileNode,
  parseProject,
  pathFromRoot,
  projectFileName,
  renameFileNode,
  serializeProject,
  stringifyProject,
} from './projectFile.ts'

describe('cello-project v1', () => {
  it('round-trips serialize → parse', () => {
    const files = defaultProjectFiles('demo', 'r')
    const doc = serializeProject({
      cells: [
        {
          id: 'cell_a',
          name: 'Load',
          code: 'x <- 1',
          status: 'idle',
          explanation: '## Purpose\n\nLoad\n',
          comments: [
            { id: 'c1', body: 'ok', createdAt: 1, author: 'user' },
          ],
        },
      ],
      activeCellId: 'cell_a',
      activePanel: 'files',
      language: 'r',
      scriptPath: 'analysis.R',
      files,
      meta: { name: 'demo', createdAt: 10, updatedAt: 10 },
    }, 99)

    assert.equal(doc.format, PROJECT_FORMAT)
    assert.equal(doc.version, PROJECT_VERSION)
    assert.equal(doc.meta.name, 'demo')
    assert.equal(doc.meta.updatedAt, 99)
    assert.equal(doc.cells[0].comments?.[0]?.body, 'ok')

    const parsed = parseProject(stringifyProject(doc))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.project.meta.name, 'demo')
    assert.equal(parsed.project.files[0]?.name, 'demo')
    assert.equal(parsed.project.cells[0].code, 'x <- 1')
    assert.equal(parsed.project.activePanel, 'files')
  })

  it('migrates legacy v0 localStorage payloads', () => {
    const legacy = {
      cells: [{ id: 'cell_1', name: 'A', code: '1 + 1' }],
      activeCellId: 'cell_1',
      activePanel: 'console',
      scriptPath: 'analysis.js',
      language: 'javascript',
    }
    const parsed = parseProject(JSON.stringify(legacy))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.project.format, PROJECT_FORMAT)
    assert.equal(parsed.project.language, 'javascript')
    assert.equal(parsed.project.files.length > 0, true)
    assert.equal(parsed.project.meta.name, 'project')
  })

  it('rejects unknown format / empty cells', () => {
    assert.equal(parseProject({ format: 'other', version: 1 }).ok, false)
    assert.equal(
      parseProject({
        format: PROJECT_FORMAT,
        version: 1,
        cells: [],
        files: [],
      }).ok,
      false,
    )
  })

  it('builds a safe download filename', () => {
    assert.equal(projectFileName('My Analysis!'), 'My-Analysis.cello')
    assert.equal(projectFileName('   '), 'project.cello')
  })
})

describe('file tree helpers', () => {
  it('renames, adds, deletes, and resolves paths', () => {
    let files = defaultProjectFiles('root', 'r')
    const rootId = files[0].id
    const firstFile = files[0].children?.[0]
    assert.ok(firstFile)

    files = renameFileNode(files, rootId, 'cello-app')
    assert.equal(files[0].name, 'cello-app')

    files = addFileChild(files, rootId, 'file', 'extra.R')
    assert.ok(files[0].children?.some((n) => n.name === 'extra.R'))

    const extra = files[0].children?.find((n) => n.name === 'extra.R')
    assert.ok(extra)
    assert.equal(pathFromRoot(files, extra.id), 'extra.R')
    assert.equal(pathFromRoot(files, rootId), '')

    const dataFolder = files[0].children?.find((n) => n.name === 'data')
    assert.ok(dataFolder)
    const sales = dataFolder.children?.find((n) => n.name === 'sales.csv')
    assert.ok(sales)
    assert.equal(pathFromRoot(files, sales.id), 'data/sales.csv')

    files = deleteFileNode(files, extra.id)
    assert.equal(
      files[0].children?.some((n) => n.name === 'extra.R'),
      false,
    )
  })
})
