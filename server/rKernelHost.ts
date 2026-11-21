import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { findRscript } from './findRscript.ts'
import {
  normalizeCompletions,
  normalizeResult,
  type KernelCompleteResult,
  type KernelCompletionItem,
  type KernelEnvBinding,
  type KernelPlotPayload,
  type KernelRunResult,
  type KernelTablePayload,
} from './normalizeKernelResult.ts'
import { normalizeRSource } from './normalizeRSource.ts'

export type KernelLanguage = 'r' | 'javascript'
export type {
  KernelCompleteResult,
  KernelCompletionItem,
  KernelEnvBinding,
  KernelPlotPayload,
  KernelRunResult,
  KernelTablePayload,
}
export { normalizeCompletions, normalizeResult }

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.join(ROOT, 'kernel', 'r', 'worker.R')
const LIB_DIR = path.join(ROOT, 'kernel', 'r', '.lib')
const REQUEST_TIMEOUT_MS = 60_000
const COMPLETE_TIMEOUT_MS = 5_000

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

async function resolveRscript(override: string | null): Promise<string | null> {
  // Node PATH walk — no bash/cmd/sh. Soft-null when R is absent (Windows-safe).
  // Explicit override / CELLO_RSCRIPT skip PATH fallback on miss.
  return findRscript({ override })
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
  private rscriptOverride: string | null = null
  private resolvedRscript: string | null = null
  /** When true, ignore exit reason from an intentional stop/reconfigure. */
  private suppressExitReason = false

  status() {
    return {
      available: Boolean(this.child) && !this.unavailableReason,
      language: 'r' as const,
      version: this.version,
      message: this.unavailableReason,
      lastError: this.lastError,
      rscriptPath: this.resolvedRscript,
      rscriptOverride: this.rscriptOverride,
    }
  }

  /**
   * Apply Settings R path override. Restarts the worker when the override changes.
   * Pass `null` / empty string to clear and fall back to auto-discovery.
   */
  async configure(rscriptPath: string | null): Promise<ReturnType<RKernelProcess['status']>> {
    const next =
      typeof rscriptPath === 'string' && rscriptPath.trim() ? rscriptPath.trim() : null
    if (next === this.rscriptOverride) {
      return this.status()
    }

    this.rscriptOverride = next
    this.stop()
    this.unavailableReason = null
    this.lastError = null
    this.version = null
    this.resolvedRscript = null

    try {
      await this.ensureStarted()
    } catch {
      /* status surfaces the reason */
    }
    return this.status()
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
    this.suppressExitReason = false
    const rscript = await resolveRscript(this.rscriptOverride)
    this.resolvedRscript = rscript
    if (!rscript) {
      this.unavailableReason = this.rscriptOverride
        ? `R path not found: ${this.rscriptOverride}. Check Settings → R path.`
        : 'R is not installed. Install R (r-base) and restart the app, or set Settings → R path.'
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
        if (!this.suppressExitReason) {
          this.lastError = detail
          if (!this.unavailableReason) {
            this.unavailableReason = detail
          }
        }
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error(detail))
        }
        this.pending.clear()
        const wasBooted = this.booted
        this.cleanupChild()
        if (!wasBooted && !this.suppressExitReason) reject(new Error(detail))
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

  private send(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (!this.child) {
      return Promise.reject(new Error('R kernel is not running'))
    }
    const id = String(payload.id ?? createId())
    payload.id = id

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('R kernel request timed out'))
      }, timeoutMs)
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

  async complete(code: string, cursor: number): Promise<KernelCompleteResult> {
    await this.ensureStarted()
    const msg = await this.send(
      {
        op: 'complete',
        id: createId(),
        code: normalizeRSource(code),
        cursor,
      },
      COMPLETE_TIMEOUT_MS,
    )
    return normalizeCompletions(msg)
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
      this.suppressExitReason = true
      this.child.kill('SIGTERM')
      this.cleanupChild()
      // suppressExitReason stays true until the next start() so async 'close'
      // from this kill does not overwrite a fresh configure() failure reason.
    }
  }
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

/**
 * Shared R kernel session for Vite middleware and the Electron main process.
 * Same `/api/kernel/*` JSON contracts in both hosts.
 */
export type KernelSession = {
  ensureStarted: () => Promise<void>
  stop: () => void
  status: () => ReturnType<RKernelProcess['status']>
  /**
   * Handle a `/api/kernel*` request. Returns true when handled
   * (caller must not call `next` / continue).
   */
  handleApi: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
}

export function createKernelSession(): KernelSession {
  const kernel = new RKernelProcess()

  return {
    ensureStarted: () => kernel.ensureStarted(),
    stop: () => kernel.stop(),
    status: () => kernel.status(),
    async handleApi(req, res) {
      const url = req.url?.split('?')[0] ?? ''
      if (!url.startsWith('/api/kernel')) return false

      try {
        if (req.method === 'GET' && url === '/api/kernel/status') {
          if (!kernel.status().available && !kernel.status().message) {
            try {
              await kernel.ensureStarted()
            } catch {
              /* reported below */
            }
          }
          sendJson(res, 200, kernel.status())
          return true
        }

        if (req.method === 'POST' && url === '/api/kernel/config') {
          const body = (await readJson(req)) as { rscriptPath?: string | null }
          const raw = body.rscriptPath
          const pathValue = raw === null || raw === undefined ? null : String(raw)
          const status = await kernel.configure(pathValue)
          sendJson(res, 200, status)
          return true
        }

        if (req.method === 'POST' && url === '/api/kernel/eval') {
          const body = (await readJson(req)) as { code?: string; cellId?: string }
          const result = await kernel.eval(String(body.code ?? ''), String(body.cellId ?? ''))
          sendJson(res, 200, result)
          return true
        }

        if (req.method === 'POST' && url === '/api/kernel/reset') {
          const result = await kernel.reset()
          sendJson(res, 200, result)
          return true
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
          return true
        }

        if (req.method === 'POST' && url === '/api/kernel/complete') {
          const body = (await readJson(req)) as { code?: string; cursor?: number }
          const code = String(body.code ?? '')
          const cursor =
            typeof body.cursor === 'number' && Number.isFinite(body.cursor)
              ? Math.max(0, Math.floor(body.cursor))
              : normalizeRSource(code).length
          try {
            const result = await kernel.complete(code, cursor)
            sendJson(res, 200, result)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            sendJson(res, 200, {
              items: [],
              prefix: '',
              error: message,
              ...kernel.status(),
            })
          }
          return true
        }

        sendJson(res, 404, { error: 'not found' })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sendJson(res, 503, { error: message, ...kernel.status() })
      }
      return true
    },
  }
}

export function rKernelPlugin(): Plugin {
  const session = createKernelSession()

  return {
    name: 'cello-r-kernel',
    configureServer(server) {
      // Probe availability in the background so the first Run is warm when R works.
      void session.ensureStarted().catch(() => {
        /* status endpoint surfaces the reason */
      })

      server.middlewares.use(async (req, res, next) => {
        const handled = await session.handleApi(req, res)
        if (!handled) next()
      })

      const exit = () => session.stop()
      process.once('exit', exit)
      process.once('SIGINT', exit)
      process.once('SIGTERM', exit)
    },
  }
}
