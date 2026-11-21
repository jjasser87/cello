/**
 * Electron entry shim: register tsx so main.ts and server/*.ts load under Electron.
 */
import { register } from 'tsx/esm/api'

register()
await import('./main.ts')
