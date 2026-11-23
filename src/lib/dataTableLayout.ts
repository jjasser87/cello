/**
 * Layout contract for Data panel tables (`.data-table` / `.table-scroll`).
 * Column width is driven by row cell content (at least the header); typical
 * string cells do not wrap. Wide tables scroll horizontally inside the panel.
 */
export const DATA_TABLE_LAYOUT = {
  tableWidth: 'max-content',
  tableMinWidth: '100%',
  tableLayout: 'auto',
  cellWhiteSpace: 'nowrap',
  /** Cap for extreme values; normal labels like "Level + four scores" stay intact. */
  cellMaxWidth: '24rem',
  scrollOverflowX: 'auto',
} as const
