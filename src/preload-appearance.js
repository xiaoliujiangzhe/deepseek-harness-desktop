'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appearanceApi', {
  get: () => ipcRenderer.invoke('appearance:get'),
  save: (appearance) => ipcRenderer.invoke('appearance:save', appearance)
});
