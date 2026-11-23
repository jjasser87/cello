import type { Cell, KernelLanguage } from '../types.ts'
import { emptyExplanationTemplate } from './explanation.ts'

/** Accept both `// %%` (valid JS) and `# %%` (R / Python-style) markers. */
const CELL_RE = /^(?:\/\/|#)\s*%%\s*(.*)$/

export function cellMarker(language: KernelLanguage, name = ''): string {
  const label = name.trim()
  if (language === 'r') {
    return label ? `# %% ${label}` : '# %%'
  }
  return label ? `// %% ${label}` : '// %%'
}

export function cellsToScript(
  cells: { name: string; code: string }[],
  language: KernelLanguage = 'javascript',
): string {
  return cells
    .map((cell) => {
      const header = cellMarker(language, cell.name)
      return `${header}\n${cell.code.replace(/\s+$/, '')}`
    })
    .join('\n\n')
    .concat('\n')
}

export function scriptToCells(script: string, existing?: Cell[]): Cell[] {
  const lines = script.replace(/\r\n/g, '\n').split('\n')
  const blocks: { name: string; code: string[] }[] = []
  let current: { name: string; code: string[] } | null = null

  for (const line of lines) {
    const match = line.match(CELL_RE)
    if (match) {
      if (current) blocks.push(current)
      current = { name: match[1]?.trim() || `Cell ${blocks.length + 1}`, code: [] }
      continue
    }
    if (!current) {
      current = { name: 'Cell 1', code: [] }
    }
    current.code.push(line)
  }
  if (current) blocks.push(current)

  if (blocks.length === 0) {
    blocks.push({ name: 'Cell 1', code: [''] })
  }

  return blocks.map((block, index) => {
    const prev = existing?.[index]
    const code = block.code.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
    return {
      id: prev?.id ?? createId('cell'),
      name: block.name || `Cell ${index + 1}`,
      code,
      status: prev?.status ?? 'idle',
      error: prev?.error,
      lastRunAt: prev?.lastRunAt,
      // Keep docs/comments when re-parsing the same script order; else seed template.
      explanation: prev?.explanation ?? emptyExplanationTemplate(),
      comments: prev?.comments ?? [],
      consoleLines: prev?.consoleLines,
    }
  })
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export const STARTER_SCRIPT_JS = `// %% Load sample data
const sales = [
  { month: "Jan", revenue: 42, region: "North" },
  { month: "Feb", revenue: 51, region: "North" },
  { month: "Mar", revenue: 47, region: "South" },
  { month: "Apr", revenue: 63, region: "South" },
  { month: "May", revenue: 58, region: "North" },
  { month: "Jun", revenue: 71, region: "South" },
];

cello.table(sales, "sales");
console.log("Loaded", sales.length, "rows");

// %% Summarize by month
const byMonth = sales.map((row) => row.revenue);
const total = byMonth.reduce((sum, value) => sum + value, 0);
const average = total / byMonth.length;

console.log("Total revenue:", total);
console.log("Average:", average.toFixed(1));

// %% Plot revenue
cello.plot({
  title: "Monthly revenue",
  kind: "bar",
  labels: sales.map((row) => row.month),
  values: byMonth,
});

// %% Spotlight a region
const south = sales.filter((row) => row.region === "South");
cello.table(south, "south_sales");
console.log("South months:", south.map((row) => row.month).join(", "));
`

export const STARTER_SCRIPT_R = `# %% Load sample data
sales <- data.frame(
  month = c("Jan", "Feb", "Mar", "Apr", "May", "Jun"),
  revenue = c(42, 51, 47, 63, 58, 71),
  region = c("North", "North", "South", "South", "North", "South"),
  stringsAsFactors = FALSE
)

console$log("Loaded", nrow(sales), "rows")

# %% Summarize by month
total <- sum(sales$revenue)
average <- mean(sales$revenue)

console$log("Total revenue:", total)
console$log("Average:", round(average, 1))

# %% Plot revenue
cello.plot(list(
  title = "Monthly revenue",
  kind = "bar",
  labels = sales$month,
  values = sales$revenue
))

# %% Spotlight a region
south <- subset(sales, region == "South")
console$log("South months:", paste(south$month, collapse = ", "))
`

/** @deprecated Prefer STARTER_SCRIPT_JS / STARTER_SCRIPT_R */
export const STARTER_SCRIPT = STARTER_SCRIPT_JS

export function starterScript(language: KernelLanguage): string {
  return language === 'r' ? STARTER_SCRIPT_R : STARTER_SCRIPT_JS
}

export function defaultScriptPath(language: KernelLanguage): string {
  return language === 'r' ? 'analysis.R' : 'analysis.js'
}
