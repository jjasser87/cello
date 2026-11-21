import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { findRscript } from './findRscript.ts'
import { normalizeResult } from './normalizeKernelResult.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.join(ROOT, 'kernel', 'r', 'worker.R')
const LIB_DIR = path.join(ROOT, 'kernel', 'r', '.lib')

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function ensureJsonlite(rscript: string): Promise<void> {
  await mkdir(LIB_DIR, { recursive: true })
  if (await pathExists(path.join(LIB_DIR, 'jsonlite'))) return
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      rscript,
      [
        '-e',
        `install.packages("jsonlite", repos="https://cloud.r-project.org", lib=${JSON.stringify(LIB_DIR)})`,
      ],
      {
        env: { ...process.env, R_LIBS_USER: LIB_DIR },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let err = ''
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `jsonlite install failed (${code})`))
    })
  })
}

class WorkerClient {
  private child
  private pending = new Map<
    string,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >()
  private ready: Promise<void>

  constructor(rscript: string) {
    this.child = spawn(rscript, ['--vanilla', WORKER], {
      cwd: ROOT,
      env: { ...process.env, R_LIBS_USER: LIB_DIR, R_LIBS: LIB_DIR },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker ready timeout')), 20_000)
      const rl = createInterface({ input: this.child.stdout })
      rl.on('line', (line) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line) as Record<string, unknown>
        } catch {
          return
        }
        if (msg.type === 'ready') {
          clearTimeout(timer)
          resolve()
          return
        }
        const id = typeof msg.id === 'string' ? msg.id : null
        if (!id) return
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.resolve(msg)
      })
      this.child.on('error', reject)
      this.child.stderr.on('data', () => {})
    })
  }

  async eval(code: string, cellId = 'c1') {
    await this.ready
    const id = `t_${Math.random().toString(36).slice(2, 8)}`
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(
        Buffer.from(`${JSON.stringify({ op: 'eval', id, code, cellId })}\n`, 'utf8'),
      )
    })
    return normalizeResult(msg)
  }

  async reset() {
    await this.ready
    const id = `t_${Math.random().toString(36).slice(2, 8)}`
    await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(Buffer.from(`${JSON.stringify({ op: 'reset', id })}\n`, 'utf8'))
    })
  }

  stop() {
    this.child.kill()
  }
}

describe('native R table capture', () => {
  it('auto-captures assigned data.frame without cello.table', async (t) => {
    const rscript = await findRscript()
    if (!rscript) {
      t.skip('Rscript not available')
      return
    }
    await ensureJsonlite(rscript)
    const client = new WorkerClient(rscript)
    t.after(() => client.stop())

    await client.reset()
    const result = await client.eval(`
sales <- data.frame(
  month = c("Jan", "Feb"),
  revenue = c(42, 51),
  stringsAsFactors = FALSE
)
`)
    assert.equal(result.error, undefined)
    assert.ok(result.table, 'expected native table payload')
    assert.equal(result.table?.name, 'sales')
    assert.deepEqual(result.table?.columns, ['month', 'revenue'])
    assert.equal(result.table?.rows.length, 2)
    assert.equal(result.table?.rows[0]?.month, 'Jan')
    assert.equal(result.table?.rows[0]?.revenue, 42)
    assert.equal(result.table?.cellId, 'c1')
  })

  it('auto-captures matrix and prefers last assigned tabular binding', async (t) => {
    const rscript = await findRscript()
    if (!rscript) {
      t.skip('Rscript not available')
      return
    }
    await ensureJsonlite(rscript)
    const client = new WorkerClient(rscript)
    t.after(() => client.stop())

    await client.reset()
    const result = await client.eval(`
a <- data.frame(x = 1:2)
b <- matrix(1:4, nrow = 2, dimnames = list(NULL, c("c1", "c2")))
`)
    assert.equal(result.error, undefined)
    assert.ok(result.table)
    assert.equal(result.table?.name, 'b')
    assert.deepEqual(result.table?.columns, ['c1', 'c2'])
    assert.equal(result.table?.rows.length, 2)
  })

  it('auto-captures a visible tabular expression as result', async (t) => {
    const rscript = await findRscript()
    if (!rscript) {
      t.skip('Rscript not available')
      return
    }
    await ensureJsonlite(rscript)
    const client = new WorkerClient(rscript)
    t.after(() => client.stop())

    await client.reset()
    const result = await client.eval(`data.frame(id = 1:3, label = letters[1:3])`)
    assert.equal(result.error, undefined)
    assert.ok(result.table)
    assert.equal(result.table?.name, 'result')
    assert.deepEqual(result.table?.columns, ['id', 'label'])
    assert.equal(result.table?.rows.length, 3)
  })

  it('lets explicit cello.table win over native capture', async (t) => {
    const rscript = await findRscript()
    if (!rscript) {
      t.skip('Rscript not available')
      return
    }
    await ensureJsonlite(rscript)
    const client = new WorkerClient(rscript)
    t.after(() => client.stop())

    await client.reset()
    const result = await client.eval(`
sales <- data.frame(month = c("Jan"), revenue = c(1))
other <- data.frame(x = 9)
cello.table(sales, "explicit_sales")
`)
    assert.equal(result.error, undefined)
    assert.ok(result.table)
    assert.equal(result.table?.name, 'explicit_sales')
    assert.deepEqual(result.table?.columns, ['month', 'revenue'])
  })
})
