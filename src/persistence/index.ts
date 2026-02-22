export { initDB, getDB } from "./db";
export { loadFilesystem, saveFile, deleteFile, syncFilesystem } from "./filesystem";
export { loadSessions, saveSession, deleteSessionFromDB, syncSessions } from "./sessions";
export { loadAIConfig, saveAIConfig, clearAIConfig } from "./config";
export { loadTheme, saveTheme, clearTheme } from "./theme";
export { loadBootConfig, saveBootConfig, clearBootConfig } from "./boot";
export { loadTermsConfig, saveTermsConfig, clearTermsConfig } from "./terms";
export {
  BatchManager,
  getBatchManager,
  removeBatchManager,
  flushAllManagers
} from "./batch";

// New storage abstraction layer
export {
  initStorage,
  getStorage,
  setStorage,
  isStorageInitialized,
  type StorageBackend,
  type BootConfig,
  type ThemeConfig
} from "./storage";

export { IndexedDBStorage } from "./indexeddb-storage";
export { FilesystemStorage } from "./filesystem-storage";

// Version history management
export {
  getVersionHistory,
  getFileVersions,
  getVersion,
  saveVersion,
  revertToVersion,
  listBranches,
  switchBranch,
  createBranch,
  deleteVersionHistory,
  hasVersionHistory
} from "./versions";

// Import history management
export {
  saveImportEntry,
  getSessionImportHistory,
  getImportEntry,
  getLatestImportEntry,
  deleteImportEntry,
  clearSessionImportHistory,
  getAllImportHistory
} from "./import-history";
