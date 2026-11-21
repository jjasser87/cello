# Cello

**One cell. Full focus.**

Cello is a minimalist, cell-based development environment. The main window stays on a single active cell; everything else — history, plots, files, environment, data, script flow, console, and an agent — lives behind a thin side ribbon you expand when you need it.

## v0.1

- Dark / charcoal shell with warm cello-wood accents
- No top header chrome — the active cell owns the viewport
- Side ribbon collapsed by default; click a mode to expand (click again / Collapse to return)
- Plain-text scripts with `# %%` (R) or `// %%` (JS) cell markers
- Focused cell editor with rename / reorder / run
- Panels: Cells, History, Plot, Files, Env, Data, Flow (auto Mermaid-style cell graph), Console, Agent — fixed size, no nested scrollbar chrome (Flow grows with the cell / page scroll)
- **R kernel** (local process via Vite dev middleware) plus in-browser JavaScript fallback
- `cello.plot` / `cello.table` helpers in both languages
- Native R graphics capture: base `plot()` / printed `ggplot()` appear in Plot (PNG via the R worker)
- Plot + data panels auto-expand when a cell produces them
- Command palette / settings entry via ⌘/Ctrl+Shift+P (panels, run, language, prefs stub)
- Compact cell nav under the editor: prev/next + Alt+↑/↓ (palette Navigate commands too)
- Local persistence of the working script

## Develop (with R)

1. Install R (`r-base` / R.app / etc.) so `Rscript` is on your `PATH`.
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

- `GET /api/kernel/status`
- `POST /api/kernel/eval` `{ "code", "cellId" }`
- `POST /api/kernel/reset`
- `POST /api/kernel/run-all` `{ "cells": [{ "id", "code" }] }`

## Develop (JS-only fallback)

If R is not installed, switch **Lang** to **JS**. The in-browser kernel still runs `console`, `cello.plot`, and `cello.table`. Console will note that the R kernel is unavailable. Vite itself does not require bash or R to start — `Rscript` is found via a Node PATH walk (Windows-safe).

```bash
npm install
npm run test:server
npm run dev
npm run build
```

Cell source is normalized (CRLF → LF, strip BOM) before R `parse()`, so Windows line endings in the editor do not break eval.


## Architecture (short)

- Browser UI talks to `/api/kernel/*` when language is R.
- `server/rKernelHost.ts` (Vite plugin) owns one `Rscript` child running `kernel/r/worker.R`.
- The worker keeps a shared `.GlobalEnv`, streams printed output into Console, and returns Env / Plot / Data payloads as JSON.
- During each eval the worker opens a temporary PNG device (cairo when available) and, if `plot.new` / `grid.newpage` fire, returns `kind: "image"` with a `data:image/png;base64,…` payload for the Plot panel.

See the project note at `docs/r-kernel-v1.md` in the Cello agent store for the v1 plan and deferred items.
