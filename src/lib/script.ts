import type { Cell } from '../types'

const CELL_RE = /^#\s*%%\s*(.*)$/

export function cellsToScript(cells: Cell[]): string {
  return cells
    .map((cell) => {
      const header = cell.name.trim() ? `# %% ${cell.name.trim()}` : '# %%'
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
    }
  })
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export const STARTER_SCRIPT = `# %% Load sample data
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

# %% Summarize by month
const byMonth = sales.map((row) => row.revenue);
const total = byMonth.reduce((sum, value) => sum + value, 0);
const average = total / byMonth.length;

console.log("Total revenue:", total);
console.log("Average:", average.toFixed(1));

# %% Plot revenue
cello.plot({
  title: "Monthly revenue",
  kind: "bar",
  labels: sales.map((row) => row.month),
  values: byMonth,
});

# %% Spotlight a region
const south = sales.filter((row) => row.region === "South");
cello.table(south, "south_sales");
console.log("South months:", south.map((row) => row.month).join(", "));
`
