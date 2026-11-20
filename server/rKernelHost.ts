import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { findRscript } from './findRscript.ts'
import { normalizeRSource } from './normalizeRSource.ts'

export type KernelLanguage = 'r' | 'javascript'

export interface KernelEnvBinding {
  name: string
  kind: string
  preview: string
}

export interface KernelPlotPayload {
  title: string
  kind: 'bar' | 'line'
  labels: string[]
  values: number[]
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

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.join(ROOT, 'kernel', 'r', 'worker.R')
const LIB_DIR = path.join(ROOT, 'kernel', 'r', '.lib')
const REQUEST_TIMEOUT_MS = 60_000

function createId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function whichRscript(): Promise<string | null> {
  // Node PATH walk — no bash/cmd/sh. Soft-null when R is absent (Windows-safe).
  return findRscript()
}

async function ensureJsonlite(rscript: string): Promise<void> {
  await mkdir(LIB_DIR, { recursive: true })
  const marker = path.join(LIB_DIR, 'jsonlite')
  if (await pathExists(marker)) return

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      rscript,
      [
        '-e',
        `install.packages("jsonlite", repos="https://cloud.r-project.org", lib=${JSON.stringify(LIB_DIR)})`,
      ],
      {
        env: {
          ...process.env,
          R_LIBS_USER: LIB_DIR,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let err = ''
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Failed to install jsonlite: ${err.trim() || `exit ${code}`}`))
    })
  })
}

class RKernelProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private ready: Promise<void> | null = null
  private booted = false
  private version: string | null = null
  private lastError: string | null = null
  private unavailableReason: string | null = null

  status() {
    return {
      available: Boolean(this.child) && !this.unavailableReason,
      language: 'r' as const,
      version: this.version,
      message: this.unavailableReason,
      lastError: this.lastError,
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.unavailableReason) {
      throw new Error(this.unavailableReason)
    }
    if (this.child && this.ready) {
      await this.ready
      return
    }
    await this.start()
  }

  private async start(): Promise<void> {
    const rscript = await whichRscript()
    if (!rscript) {
      this.unavailableReason =
        'R is not installed. Install R (r-base) and restart `npm run dev`.'
      throw new Error(this.unavailableReason)
    }

    try {
      await ensureJsonlite(rscript)
    } catch (err) {
      this.unavailableReason =
        err instanceof Error
          ? err.message
          : 'Could not install the jsonlite R package required by the kernel.'
      throw new Error(this.unavailableReason)
    }

    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(rscript, ['--vanilla', WORKER], {
        cwd: ROOT,
        env: {
          ...process.env,
          R_LIBS_USER: LIB_DIR,
          R_LIBS: LIB_DIR,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child

      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => this.onLine(line))

      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (stderr.length > 4000) stderr = stderr.slice(-4000)
      })

      const bootTimer = setTimeout(() => {
        this.unavailableReason = 'R kernel did not become ready in time.'
        reject(new Error(this.unavailableReason))
        this.stop()
      }, 20_000)

      const onReady = (msg: Record<string, unknown>) => {
        if (msg.type === 'ready') {
          clearTimeout(bootTimer)
          this.booted = true
          this.version = typeof msg.version === 'string' ? msg.version : null
          this.unavailableReason = null
          resolve()
        }
      }
      this.bootHandler = onReady

      child.on('error', (err) => {
        clearTimeout(bootTimer)
        this.unavailableReason = err.message
        this.lastError = err.message
        if (!this.booted) reject(err)
        this.cleanupChild()
      })

      child.on('close', (code) => {
        clearTimeout(bootTimer)
        const detail = stderr.trim() || `R worker exited (${code ?? '?'})`
        this.lastError = detail
        if (!this.unavailableReason) {
          this.unavailableReason = detail
        }
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error(detail))
        }
        this.pending.clear()
        const wasBooted = this.booted
        this.cleanupChild()
        if (!wasBooted) reject(new Error(detail))
      })
    })

    await this.ready
  }

  private bootHandler: ((msg: Record<string, unknown>) => void) | null = null

  private cleanupChild() {
    this.child = null
    this.ready = null
    this.booted = false
    this.bootHandler = null
  }

  private onLine(line: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    if (msg.type === 'ready' || msg.type === 'fatal') {
      this.bootHandler?.(msg)
      if (msg.type === 'fatal' && typeof msg.error === 'string') {
        this.unavailableReason = msg.error
      }
      return
    }

    const id = typeof msg.id === 'string' ? msg.id : null
    if (!id) return
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(msg)
  }

  private send(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.child) {
      return Promise.reject(new Error('R kernel is not running'))
    }
    const id = String(payload.id ?? createId())
    payload.id = id

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('R kernel request timed out'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      // UTF-8 bytes only — avoid locale-dependent stdin encoding on Windows.
      const line = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
      this.child!.stdin.write(line)
    })
  }

  async eval(code: string, cellId: string): Promise<KernelRunResult> {
    await this.ensureStarted()
    const msg = await this.send({
      op: 'eval',
      id: createId(),
      code: normalizeRSource(code),
      cellId,
    })
    return normalizeResult(msg)
  }

  async reset(): Promise<KernelRunResult> {
    await this.ensureStarted()
    const msg = await this.send({ op: 'reset', id: createId() })
    return normalizeResult(msg)
  }

  async runAll(
    cells: { id: string; code: string }[],
  ): Promise<{ results: KernelRunResult[]; stopped: boolean }> {
    await this.ensureStarted()
    await this.reset()
    const results: KernelRunResult[] = []
    let stopped = false
    for (const cell of cells) {
      const result = await this.eval(cell.code, cell.id)
      results.push(result)
      if (result.error) {
        stopped = true
        break
      }
    }
    return { results, stopped }
  }

  stop() {
    if (this.child) {
      this.child.kill('SIGTERM')
      this.cleanupChild()
    }
  }
}

function normalizeResult(msg: Record<string, unknown>): KernelRunResult {
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
    const labels = Array.isArray(raw.labels) ? raw.labels.map((v) => String(v)) : []
    const values = Array.isArray(raw.values)
      ? raw.values.map((v) => {
          const n = typeof v === 'number' ? v : Number(v)
          return Number.isFinite(n) ? n : 0
        })
      : []
    if (labels.length === values.length && labels.length > 0) {
      plot = {
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Plot',
        kind: raw.kind === 'line' ? 'line' : 'bar',
        labels,
        values,
        cellId: typeof raw.cellId === 'string' ? raw.cellId : undefined,
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

export function rKernelPlugin(): Plugin {
  const kernel = new RKernelProcess()

  return {
    name: 'cello-r-kernel',
    configureServer(server) {
      // Probe availability in the background so the first Run is warm when R works.
      void kernel.ensureStarted().catch(() => {
        /* status endpoint surfaces the reason */
      })

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/api/kernel')) {
          next()
          return
        }

        try {
          if (req.method === 'GET' && url === '/api/kernel/status') {
            // Attempt a soft start so the UI learns availability without a separate action.
            if (!kernel.status().available && !kernel.status().message) {
              try {
                await kernel.ensureStarted()
              } catch {
                /* reported below */
              }
            }
            sendJson(res, 200, kernel.status())
            return
          }

          if (req.method === 'POST' && url === '/api/kernel/eval') {
            const body = (await readJson(req)) as { code?: string; cellId?: string }
            const result = await kernel.eval(String(body.code ?? ''), String(body.cellId ?? ''))
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && url === '/api/kernel/reset') {
            const result = await kernel.reset()
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && url === '/api/kernel/run-all') {
            const body = (await readJson(req)) as {
              cells?: { id: string; code: string }[]
            }
            const cells = Array.isArray(body.cells) ? body.cells : []
            const result = await kernel.runAll(
              cells.map((cell) => ({
                id: String(cell.id),
                code: normalizeRSource(String(cell.code ?? '')),
              })),
            )
            sendJson(res, 200, result)
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          sendJson(res, 503, { error: message, ...kernel.status() })
        }
      })

      const exit = () => kernel.stop()
      process.once('exit', exit)
      process.once('SIGINT', exit)
      process.once('SIGTERM', exit)
    },
  }
}
