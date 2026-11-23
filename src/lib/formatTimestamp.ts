/** Dense date+time for History / Plot / Console / Data panel rows. */
const PANEL_TIMESTAMP_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

/**
 * Format a panel history timestamp as a readable date and time
 * (e.g. `Nov 23, 2026, 3:42 PM` in en-US).
 */
export function formatPanelTimestamp(
  value: number | Date,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleString(locale, PANEL_TIMESTAMP_OPTIONS)
}
