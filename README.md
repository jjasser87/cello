# Cello

**One cell. Full focus.**

Cello is a minimalist, cell-based development environment. The main window stays on a single active cell; everything else — history, plots, files, environment, data, script flow, console, and an agent — lives behind a thin side ribbon you expand when you need it.

## v0.1

- Dark / charcoal shell with warm cello-wood accents
- No top header chrome — the active cell owns the viewport
- Side ribbon collapsed by default; click a mode to expand (click again / Collapse to return)
- Plain-text scripts with `# %%` (R) or `// %%` (JS) cell markers
- Focused cell editor with rename / reorder / run
- Panels: Cells, Explain, History, Plot, Files, Env, Data, Flow (auto Mermaid-style cell graph), Console, Agent — fixed size, no nested scrollbar chrome (Flow grows with the cell / page scroll)
- **Explain** — per-cell Markdown purpose doc (Purpose / Inputs / Outputs / …) plus feedback comments for focus auditing
- **R kernel** (local process via Vite dev middleware) plus in-browser JavaScript fallback
- `cello.plot` / `cello.table` helpers in both languages
- Native R graphics capture: base `plot()` / printed `ggplot()` appear in Plot (PNG via the R worker)
- Plot + data panels auto-expand when a cell produces them
- Command palette / settings entry via ⌘/Ctrl+Shift+P (panels, Explain cell, run, language, prefs stub)
- Compact cell nav under the editor: prev/next + Alt+↑/↓ (palette Navigate commands too)
- Local persistence of the working script (code + explanations + comments in `localStorage`)

## Develop (with R)

1. Install R (`r-base` / R.app / etc.) so `Rscript` is on your `PATH` (or set a custom path under **Settings…** in the command palette, or export `CELLO_RSCRIPT`).
2. From the repo:

```bash
npm install
npm run dev
```

On first start the Vite plugin spawns a long-lived R worker and installs `jsonlite` into `kernel/r/.lib/` (gitignored) if needed. Open the app URL Vite prints, leave **Lang** on **R**, and use **Run** / **Run all**.

Kernel helpers in R:

```r
cello.table(sales, "sales")
cello.plot(list(
  title = "Monthly revenue",
  kind = "bar",
  labels = sales$month,
  values = sales$revenue
))
console$log("hello")
```

Native graphics (no helper required) also fill Plot for that cell:

```r
plot(1:10, main = "base plot")

# optional — install ggplot2 yourself if you want ggplot
# install.packages("ggplot2")
library(ggplot2)
ggplot(data.frame(x = 1:5, y = c(2, 4, 3, 5, 4)), aes(x, y)) + geom_line()
```

If R was built without PNG (or the PNG device cannot open), the cell still runs and Console notes that native plot capture is unavailable. Structured `cello.plot` keeps working either way. Explicit `cello.plot(...)` in a cell wins over a native image from the same cell.

API used by the UI (dev server only):

- `GET /api/kernel/status` (includes `rscriptPath` / `rscriptOverride` when known)
- `POST /api/kernel/config` `{ "rscriptPath": "/path/to/Rscript" | null }` — Settings override; restarts the worker
- `POST /api/kernel/eval` `{ "code", "cellId" }`
- `POST /api/kernel/reset`
- `POST /api/kernel/run-all` `{ "cells": [{ "id", "code" }] }`
- `POST /api/kernel/complete` `{ "code", "cursor" }`

## Develop (JS-only fallback)

If R is not installed, switch **Lang** to **JS**. The in-browser kernel still runs `console`, `cello.plot`, and `cello.table`. Console will note that the R kernel is unavailable. Vite itself does not require bash or R to start — `Rscript` is found via a Node PATH walk (Windows-safe).

```bash
npm install
npm run test:server
npm run dev
npm run build
```

Cell source is normalized (CRLF → LF, strip BOM) before R `parse()`, so Windows line endings in the editor do not break eval.

## Explanations & persistence

Each code cell carries a Markdown **explanation** (seeded with focus-audit headings when empty) and a list of **comments** (`id`, `body`, `createdAt`, `author`). Both persist in `localStorage` under `cello.workspace.v0` on each cell object.

Plain-text script export (`⇩`) remains code-only with `# %%` / `// %%` markers — explanations are **not** embedded in `.R` / `.js` files. Restoring from a full workspace payload keeps docs and comments; importing a bare script reseeds empty explanation templates.

Open **Explain** from the ribbon (`Ex`), the ¶ toolbar icon, or the command palette (“Explain cell” / “Go to Explain”).


## Architecture (short)

- Browser UI talks to `/api/kernel/*` when language is R.
- `server/rKernelHost.ts` (Vite plugin) owns one `Rscript` child running `kernel/r/worker.R`.
- The worker keeps a shared `.GlobalEnv`, streams printed output into Console, and returns Env / Plot / Data payloads as JSON.
- During each eval the worker opens a temporary PNG device (cairo when available) and, if `plot.new` / `grid.newpage` fire, returns `kind: "image"` with a `data:image/png;base64,…` payload for the Plot panel.

See the project note at `docs/r-kernel-v1.md` in the Cello agent store for the v1 plan and deferred items.
