"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PROFILE_ENTRIES = [
  "Local State",
  "Preferences",
  "Local Storage",
  "Session Storage",
  "IndexedDB",
  "Network",
  "Partitions",
  "WebStorage",
  "Service Worker",
];
const CACHE_ENTRIES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
  "GrShaderCache",
  "ShaderCache",
  "CacheStorage",
  "blob_storage",
  "DevToolsActivePort",
  "LOCK",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
]);

// Runs before Electron creates any sessions. Existing 1.2 settings always win.
function migrateLegacyProfile(legacyDir, runtimeDir) {
  const source = path.resolve(legacyDir);
  const destination = path.resolve(runtimeDir);
  if (source === destination || destination.startsWith(source + path.sep)) {
    throw new Error("旧版与新版数据目录不能重叠。");
  }
  fs.mkdirSync(destination, { recursive: true });
  const marker = path.join(destination, ".profile-migrated-v1.json");
  if (fs.existsSync(marker))
    return { alreadyMigrated: true, files: 0, bytes: 0 };
  if (!fs.existsSync(source)) return { missing: true, files: 0, bytes: 0 };
  const result = {
    files: 0,
    bytes: 0,
    skippedCaches: 0,
    migratedAt: new Date().toISOString(),
  };

  function copy(from, to) {
    if (CACHE_ENTRIES.has(path.basename(from))) {
      result.skippedCaches++;
      return;
    }
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink())
      throw new Error("旧版数据中有链接目录，请先检查后再迁移。");
    if (fs.existsSync(to) && fs.lstatSync(to).isSymbolicLink())
      throw new Error("新版数据目录不能指向其他位置。");
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from))
        copy(path.join(from, name), path.join(to, name));
    } else if (stat.isFile() && !fs.existsSync(to)) {
      const temporary = `${to}.${randomUUID()}.tmp`;
      try {
        fs.copyFileSync(from, temporary);
        fs.renameSync(temporary, to);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      result.files++;
      result.bytes += stat.size;
    }
  }

  for (const entry of PROFILE_ENTRIES) {
    const from = path.join(source, entry);
    if (fs.existsSync(from)) copy(from, path.join(destination, entry));
  }
  fs.writeFileSync(marker, JSON.stringify(result, null, 2), "utf8");
  return result;
}

module.exports = { migrateLegacyProfile };
