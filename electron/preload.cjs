"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, value) => ipcRenderer.invoke("collector:" + name, value);
contextBridge.exposeInMainWorld(
  "collector",
  Object.freeze({
    getAppInfo: () => invoke("getAppInfo"),
    setUnsavedChanges: (value) => invoke("setUnsavedChanges", value),
    getSavedFiles: () => invoke("getSavedFiles"),
    saveResult: (options) => invoke("saveResult", options),
    loadSavedFile: (id) => invoke("loadSavedFile", id),
    updateSavedFile: (options) => invoke("updateSavedFile", options),
    deleteSavedFile: (id) => invoke("deleteSavedFile", id),
    revealDataFolder: () => invoke("revealDataFolder"),
    exportTask: (config) => invoke("exportTask", config),
    inspect: (options) => invoke("inspect", options),
    preview: (config) => invoke("preview", config),
    start: (config) => invoke("start", config),
    stop: () => invoke("stop"),
    openBrowser: (url) => invoke("openBrowser", url),
    pick: (options) => invoke("pick", options),
    exportData: (options) => invoke("exportData", options),
    getHistory: () => invoke("getHistory"),
    loadHistory: (id) => invoke("loadHistory", id),
    deleteHistory: (id) => invoke("deleteHistory", id),
    getSchedules: () => invoke("getSchedules"),
    saveSchedule: (options) => invoke("saveSchedule", options),
    deleteSchedule: (id) => invoke("deleteSchedule", id),
    onProgress: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("collector:progress", listener);
      return () => ipcRenderer.removeListener("collector:progress", listener);
    },
  }),
);
