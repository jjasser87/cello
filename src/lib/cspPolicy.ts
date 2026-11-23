/**
 * Document CSP for the Electron desktop host (and optional meta tag).
 * Mermaid SVGs rely on inline `style=""` attributes, so `style-src` must
 * allow `'unsafe-inline'`. Scripts stay locked to `'self'` — Mermaid click
 * directives are unused (securityLevel: strict).
 */
export const CELLO_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export function cspAllowsInlineStyles(policy = CELLO_CONTENT_SECURITY_POLICY): boolean {
  return /style-src[^;]*'unsafe-inline'/.test(policy)
}
