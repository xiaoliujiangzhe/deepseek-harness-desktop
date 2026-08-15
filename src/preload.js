'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  /** Subscribe to progress updates: callback receives { pct, label }. */
  onProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('startup:progress', listener);
    return () => ipcRenderer.removeListener('startup:progress', listener);
  },
  /** Subscribe to startup errors: callback receives { message, detail }. */
  onError(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('startup:error', listener);
    return () => ipcRenderer.removeListener('startup:error', listener);
  },
  /** Subscribe to a reset request (after workspace change). */
  onReset(callback) {
    const listener = () => callback();
    ipcRenderer.on('startup:reset', listener);
    return () => ipcRenderer.removeListener('startup:reset', listener);
  },
  /** Let the user pick a workspace directory from the error screen. */
  chooseWorkspace() {
    return ipcRenderer.invoke('startup:choose-workspace');
  },
  /** Retry service startup after an error. */
  retry() {
    return ipcRenderer.invoke('startup:retry');
  },
  /** Read static app state (app name, etc.). */
  getState() {
    return ipcRenderer.invoke('startup:get-state');
  }
});
