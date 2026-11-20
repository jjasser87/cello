/**
 * Normalize cell source before it reaches R's parse(text=).
 *
 * R's parser rejects bare CR characters. Windows editors / some paste paths
 * can introduce CRLF or CR line endings, and a UTF-8 BOM makes even `1+1`
 * fail to parse. JSON framing keeps these bytes intact inside the `code` field.
 */
export function normalizeRSource(code: string): string {
  let text = String(code ?? '')
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
