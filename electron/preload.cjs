/**
 * Preload bridge for the Cello desktop shell.
 * Kept as CommonJS so Electron can load it without a bundler step.
 */
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('celloDesktop', {
  isDesktop: true,
  /**
   * Ask the main process to resize the window content area to (width, height)
   * CSS pixels from the renderer layout measurement.
   */
  setContentSize(width, height) {
    return ipcRenderer.invoke('cello:set-content-size', { width, height })
  },
  minimize() {
    return ipcRenderer.invoke('cello:window-minimize')
  },
  maximizeToggle() {
    return ipcRenderer.invoke('cello:window-maximize-toggle')
  },
  close() {
    return ipcRenderer.invoke('cello:window-close')
  },
  openFolder() {
    return ipcRenderer.invoke('cello:open-folder')
  },
  listFolder(root, options) {
    return ipcRenderer.invoke('cello:list-folder', { root, ...(options || {}) })
  },
  readTextFile(absolutePath) {
    return ipcRenderer.invoke('cello:read-text', { path: absolutePath })
  },
  writeTextFile(absolutePath, contents) {
    return ipcRenderer.invoke('cello:write-text', { path: absolutePath, contents })
  },
  setProjectCwd(cwd) {
    return ipcRenderer.invoke('cello:set-project-cwd', { cwd })
  },
})
