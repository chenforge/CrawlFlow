"use strict";

const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { normalizeConfig } = require("./core.cjs");

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const SUFFIX = ".crawlflow.json";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS_BYTES = 20 * 1024 * 1024;

function isCDrive(value) {
  return /^c:[\\/]/i.test(String(value));
}

// Resolve this before app.setPath('userData', paths.runtimeDir). Only explicit QA
// injection may opt into a temporary C: directory; production never does so.
function resolveStoragePaths(options = {}) {
  const env = options.env || process.env;
  let homeDir;
  let dataDir;
  if (options.testDataDir) {
    dataDir = path.resolve(options.testDataDir);
    homeDir = path.dirname(dataDir);
  } else {
    const sourceDir = options.sourceDir || path.resolve(__dirname, "..");
    const developmentHome = path.basename(sourceDir).toLowerCase() === "source" ? path.dirname(sourceDir) : sourceDir;
    const candidate =
      options.homeDir ||
      env.CRAWLFLOW_HOME ||
      options.portableDir ||
      env.PORTABLE_EXECUTABLE_DIR ||
      (options.isPackaged
        ? path.dirname(options.executablePath || process.execPath)
        : developmentHome);
    homeDir = path.resolve(candidate);
    if (
      options.isPackaged &&
      !options.homeDir &&
      !env.CRAWLFLOW_HOME &&
      !options.portableDir &&
      !env.PORTABLE_EXECUTABLE_DIR &&
      path.basename(homeDir).toLowerCase() === "app" &&
      path.basename(path.dirname(homeDir)).toLowerCase() === "crawlflow"
    ) {
      homeDir = path.dirname(homeDir);
    }
    if (isCDrive(homeDir)) {
      const driveExists = options.existsSync || fs.existsSync;
      if (!driveExists("D:\\"))
        throw new Error(
          "请把 CrawlFlow 放到 D 盘或其他非 C 盘后再打开；采集文件不会保存到 C 盘。",
        );
      homeDir = path.resolve("D:\\CrawlFlow");
    }
    dataDir = path.join(homeDir, "Data");
  }
  return Object.freeze({
    homeDir,
    dataDir,
    collectionsDir: path.join(dataDir, "Collections"),
    exportsDir: path.join(dataDir, "Exports"),
    runtimeDir: path.join(dataDir, "Runtime"),
    historyDir: path.join(dataDir, "History"),
    trashDir: path.join(dataDir, "Trash"),
    schedulesPath: path.join(dataDir, "schedules.json"),
    settingsPath: path.join(dataDir, "settings.json"),
  });
}

function assertContained(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error("文件位置不在 CrawlFlow 数据目录内。");
  return path.resolve(target);
}

// Walk each component: recursive mkdir alone would silently follow a junction.
async function safeDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await fsp.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      try {
        await fsp.mkdir(current);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      info = await fsp.lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("数据目录包含链接或无效文件夹，请使用普通文件夹。");
  }
  return absolute;
}

async function ensureStoragePaths(paths) {
  await safeDirectory(paths.dataDir, true);
  for (const name of [
    "collectionsDir",
    "exportsDir",
    "runtimeDir",
    "historyDir",
    "trashDir",
  ]) {
    await safeDirectory(assertContained(paths.dataDir, paths[name]), true);
  }
  return paths;
}

function validateId(value) {
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error("文件编号无效，请刷新文件列表后重试。");
  return value.toLowerCase();
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sanitizeCollectionRows(rows) {
  if (!Array.isArray(rows) || rows.length > 10000)
    throw new Error("数据必须是表格，且不能超过 10,000 行。");
  let budget = MAX_ROWS_BYTES;
  return rows.map((row) => {
    if (!plainObject(row)) throw new Error("表格中包含无效的数据行。");
    const entries = Object.entries(row);
    if (entries.length > 40) throw new Error("每行最多保存 40 个字段。");
    const clean = Object.create(null);
    for (const [key, value] of entries) {
      if (
        !key.trim() ||
        key.length > 100 ||
        RESERVED.has(key) ||
        /[\u0000-\u001f]/.test(key)
      )
        throw new Error("字段名称无效或属于系统保留名称。");
      if (
        value !== null &&
        value !== undefined &&
        !["string", "number", "boolean"].includes(typeof value)
      )
        throw new Error("单元格只能保存文字、数字或布尔值。");
      const text = String(value ?? "");
      if (text.length > 12000)
        throw new Error("单个单元格不能超过 12,000 个字符。");
      budget -=
        Buffer.byteLength(key, "utf8") + Buffer.byteLength(text, "utf8");
      if (budget < 0) throw new Error("这份数据超过 20 MB，请拆分后保存。");
      clean[key] = text;
    }
    return clean;
  });
}

function cleanName(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 120 ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error("请输入 1 至 120 个字符的文件名称。");
  return value.trim();
}

function cleanConfig(value) {
  if (value == null) return null;
  if (!plainObject(value)) throw new Error("文件中的采集设置无效。");
  return normalizeConfig(value);
}

function timestamp(value, fallback = new Date().toISOString()) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

async function regularFile(filename, allowMissing = false) {
  try {
    const info = await fsp.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("采集文件不是普通文件，操作已取消。");
    return info;
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(filename) {
  const info = await regularFile(filename);
  if (info.size > MAX_FILE_BYTES) throw new Error("采集文件过大，无法打开。");
  const handle = await fsp.open(
    filename,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > MAX_FILE_BYTES ||
      opened.ino !== info.ino
    )
      throw new Error("文件已发生变化，请重试。");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function atomicJson(filename, value) {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(content) > MAX_FILE_BYTES)
    throw new Error("采集文件过大，请拆分后保存。");
  await safeDirectory(path.dirname(filename));
  await regularFile(filename, true);
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await regularFile(filename, true);
    await fsp.rename(temporary, filename);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return Buffer.byteLength(content);
}

function createCollectionStore(paths) {
  if (!paths || !path.isAbsolute(paths.dataDir || ""))
    throw new Error("请先指定有效的数据目录。");
  let queue = Promise.resolve();
  const serialized = (operation) => {
    const pending = queue.then(async () => {
      await ensureStoragePaths(paths);
      return operation();
    });
    queue = pending.catch(() => {});
    return pending;
  };
  const filePath = (id) =>
    assertContained(
      paths.collectionsDir,
      path.join(paths.collectionsDir, validateId(id) + SUFFIX),
    );
  const toMetadata = (document, size) => ({
    id: document.id,
    name: document.name,
    filename: document.id + SUFFIX,
    rowsCount: document.rows.length,
    size,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    sourceUrl: document.config?.urls?.[0] || "",
  });
  async function readDocument(id) {
    id = validateId(id);
    const filename = filePath(id);
    const stored = await readJson(filename);
    if (!plainObject(stored) || stored.schemaVersion !== 1 || stored.id !== id)
      throw new Error("文件格式不受支持或文件编号不匹配。");
    const document = {
      schemaVersion: 1,
      id,
      name: cleanName(stored.name),
      createdAt: timestamp(stored.createdAt),
      updatedAt: timestamp(stored.updatedAt),
      rows: sanitizeCollectionRows(stored.rows),
      config: cleanConfig(stored.config),
    };
    if (plainObject(stored.legacySource) && UUID.test(stored.legacySource.id))
      document.legacySource = {
        id: stored.legacySource.id.toLowerCase(),
        version: "1.1",
      };
    const info = await regularFile(filename);
    return { document, metadata: toMetadata(document, info.size) };
  }
  async function writeDocument(document) {
    const size = await atomicJson(filePath(document.id), document);
    return toMetadata(document, size);
  }
  async function createDocument(input, migration) {
    if (!plainObject(input)) throw new Error("文件内容无效。");
    const now = new Date().toISOString();
    const document = {
      schemaVersion: 1,
      id: migration?.id || randomUUID(),
      name: cleanName(input.name),
      createdAt: migration ? timestamp(input.createdAt, now) : now,
      updatedAt: now,
      rows: sanitizeCollectionRows(input.rows),
      config: cleanConfig(input.config),
    };
    if (!document.rows.length)
      throw new Error("没有可保存的数据，请先完成采集。");
    if (migration) document.legacySource = { id: migration.id, version: "1.1" };
    if (await regularFile(filePath(document.id), true))
      throw new Error("文件编号已存在，请重试。");
    return writeDocument(document);
  }
  return Object.freeze({
    paths,
    init: () => serialized(() => paths),
    create: (input) => serialized(() => createDocument(input)),
    list: () =>
      serialized(async () => {
        const entries = await fsp.readdir(paths.collectionsDir, {
          withFileTypes: true,
        });
        const items = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(SUFFIX)) continue;
          const id = entry.name.slice(0, -SUFFIX.length);
          if (!UUID.test(id)) continue;
          try {
            items.push((await readDocument(id)).metadata);
          } catch (error) {
            // A damaged file stays on disk and remains visible to the user.
            items.push({
              id,
              name: entry.name,
              filename: entry.name,
              rowsCount: 0,
              size: (await regularFile(filePath(id))).size,
              createdAt: "",
              updatedAt: "",
              sourceUrl: "",
              unreadable: true,
              error: "文件内容损坏，无法预览。可在数据文件夹中检查。",
            });
          }
        }
        return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }),
    read: (id) =>
      serialized(async () => {
        const { document, metadata } = await readDocument(id);
        return { ...document, ...metadata };
      }),
    update: (input) =>
      serialized(async () => {
        if (!plainObject(input)) throw new Error("修改内容无效。");
        const { document } = await readDocument(input.id);
        if (
          input.expectedUpdatedAt &&
          input.expectedUpdatedAt !== document.updatedAt
        )
          throw new Error("文件刚刚被修改，请重新打开后再保存。");
        if (Object.hasOwn(input, "name")) document.name = cleanName(input.name);
        if (Object.hasOwn(input, "rows"))
          document.rows = sanitizeCollectionRows(input.rows);
        if (Object.hasOwn(input, "config"))
          document.config = cleanConfig(input.config);
        document.updatedAt = new Date(
          Math.max(Date.now(), Date.parse(document.updatedAt) + 1),
        ).toISOString();
        return writeDocument(document);
      }),
    delete: (id) =>
      serialized(async () => {
        id = validateId(id);
        const source = filePath(id);
        await regularFile(source);
        const deletedAt = new Date().toISOString();
        const trashName = `${id}.${Date.now()}.${randomUUID()}${SUFFIX}`;
        const destination = assertContained(
          paths.trashDir,
          path.join(paths.trashDir, trashName),
        );
        await fsp.rename(source, destination);
        return { id, deleted: true, recoverable: true, deletedAt };
      }),
    migrateLegacyHistory: (legacyTasksDir) =>
      serialized(async () => {
        const report = { imported: [], skipped: [], errors: [] };
        try {
          await safeDirectory(legacyTasksDir);
        } catch (error) {
          if (error.code === "ENOENT") return report;
          throw error;
        }
        const manifestPath = assertContained(
          paths.historyDir,
          path.join(paths.historyDir, "legacy-migration.json"),
        );
        let manifest = { schemaVersion: 1, importedIds: [] };
        if (await regularFile(manifestPath, true)) {
          const prior = await readJson(manifestPath);
          if (
            !plainObject(prior) ||
            !Array.isArray(prior.importedIds) ||
            !prior.importedIds.every(
              (id) => typeof id === "string" && UUID.test(id),
            )
          )
            throw new Error(
              "旧版迁移记录损坏，请先检查 Data/History/legacy-migration.json。",
            );
          manifest = {
            schemaVersion: 1,
            importedIds: [
              ...new Set(prior.importedIds.map((id) => id.toLowerCase())),
            ],
          };
        }
        const importedIds = new Set(manifest.importedIds);
        const entries = await fsp.readdir(legacyTasksDir, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
          const id = entry.name.slice(0, -5).toLowerCase();
          if (!UUID.test(id)) continue;
          if (importedIds.has(id)) {
            report.skipped.push({ id, reason: "already-imported" });
            continue;
          }
          try {
            if (await regularFile(filePath(id), true)) {
              const existing = await readDocument(id);
              if (existing.document.legacySource?.id !== id)
                throw new Error("文件编号与现有文件冲突，已保留旧版原文件。");
              importedIds.add(id);
              report.skipped.push({ id, reason: "already-imported" });
            } else {
              const legacy = await readJson(
                assertContained(
                  legacyTasksDir,
                  path.join(legacyTasksDir, entry.name),
                ),
              );
              if (
                !plainObject(legacy) ||
                legacy.id?.toLowerCase() !== id ||
                !Array.isArray(legacy.rows)
              )
                throw new Error("旧版历史记录格式无效。");
              if (!legacy.rows.length) {
                report.skipped.push({ id, reason: "empty" });
                continue;
              }
              report.imported.push(
                await createDocument(
                  {
                    name: legacy.name || legacy.config?.name || "旧版采集",
                    rows: legacy.rows,
                    config: legacy.config,
                    createdAt: legacy.createdAt,
                  },
                  { id },
                ),
              );
              importedIds.add(id);
            }
            manifest.importedIds = [...importedIds];
            await atomicJson(manifestPath, manifest);
          } catch (error) {
            report.errors.push({
              filename: entry.name,
              message: error.message,
            });
          }
        }
        return report;
      }),
  });
}

module.exports = {
  resolveStoragePaths,
  ensureStoragePaths,
  createCollectionStore,
  sanitizeCollectionRows,
  assertContained,
  isCDrive,
};
