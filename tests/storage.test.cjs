"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  resolveStoragePaths,
  createCollectionStore,
  sanitizeCollectionRows,
} = require("../electron/storage.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "crawlflow-storage-test-"),
  );
  t.after(async () => {
    assert.ok(
      root.startsWith(path.join(os.tmpdir(), "crawlflow-storage-test-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const paths = resolveStoragePaths({ testDataDir: path.join(root, "Data") });
  const store = createCollectionStore(paths);
  await store.init();
  return { root, paths, store };
}

const sample = () => ({
  name: "文章收集",
  rows: [{ 标题: "第一篇", 链接: "https://example.com/one" }],
  config: { urls: ["https://example.com"], template: "articles" },
});

test("paths follow portable or installed app and never silently use C drive", () => {
  if (process.platform !== "win32") return;
  const portable = resolveStoragePaths({
    portableDir: "E:\\CrawlFlow",
    env: {},
  });
  assert.equal(portable.dataDir, "E:\\CrawlFlow\\Data");
  assert.equal(portable.exportsDir, "E:\\CrawlFlow\\Data\\Exports");
  const installed = resolveStoragePaths({
    isPackaged: true,
    executablePath: "D:\\Apps\\CrawlFlow\\CrawlFlow.exe",
    env: {},
  });
  assert.equal(installed.runtimeDir, "D:\\Apps\\CrawlFlow\\Data\\Runtime");
  assert.equal(resolveStoragePaths({isPackaged:true,executablePath:'D:\\CrawlFlow\\App\\CrawlFlow.exe',env:{}}).dataDir, 'D:\\CrawlFlow\\Data');
  assert.equal(resolveStoragePaths({sourceDir:'D:\\Dev\\CrawlFlow',env:{}}).dataDir, 'D:\\Dev\\CrawlFlow\\Data');
  assert.equal(resolveStoragePaths({sourceDir:'D:\\CrawlFlow\\Source',env:{}}).dataDir, 'D:\\CrawlFlow\\Data');
  const fallback = resolveStoragePaths({
    homeDir: "C:\\Users\\Alice\\Downloads",
    existsSync: () => true,
    env: {},
  });
  assert.equal(fallback.homeDir, "D:\\CrawlFlow");
  assert.throws(
    () =>
      resolveStoragePaths({
        homeDir: "C:\\Users\\Alice",
        existsSync: () => false,
        env: {},
      }),
    /非 C 盘/,
  );
});

test("only explicit save creates a collection, which can be read, edited, and reopened", async (t) => {
  const { store, paths } = await fixture(t);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await fs.readdir(paths.collectionsDir), []);
  const saved = await store.create(sample());
  assert.equal(saved.rowsCount, 1);
  assert.ok(saved.size > 0);
  assert.match(saved.filename, /^[a-f0-9-]+\.crawlflow\.json$/);
  const reopenedStore = createCollectionStore(paths);
  const document = await reopenedStore.read(saved.id);
  assert.equal(document.rows[0].标题, "第一篇");
  const edited = await reopenedStore.update({
    id: saved.id,
    name: "修改后的文件",
    rows: [{ 标题: "第二篇", 数量: 3 }],
    expectedUpdatedAt: document.updatedAt,
  });
  assert.ok(edited.updatedAt > document.updatedAt);
  const updated = await store.read(saved.id);
  assert.equal(updated.name, "修改后的文件");
  assert.equal(updated.rows[0].数量, "3");
  assert.equal(updated.createdAt, document.createdAt);
  assert.deepEqual(
    (await fs.readdir(paths.collectionsDir)).filter((name) =>
      name.endsWith(".tmp"),
    ),
    [],
  );
});

test("deleting moves only the selected collection into Data/Trash", async (t) => {
  const { store, paths } = await fixture(t);
  const first = await store.create(sample());
  const second = await store.create({ ...sample(), name: "保留的文件" });
  const result = await store.delete(first.id);
  assert.equal(result.recoverable, true);
  assert.deepEqual(
    (await store.list()).map((item) => item.id),
    [second.id],
  );
  const trash = await fs.readdir(paths.trashDir);
  assert.equal(trash.length, 1);
  const preserved = JSON.parse(
    await fs.readFile(path.join(paths.trashDir, trash[0]), "utf8"),
  );
  assert.equal(preserved.rows[0].标题, "第一篇");
  await assert.rejects(store.read(first.id), { code: "ENOENT" });
});

test("traversal IDs and prototype pollution fields are rejected without touching files", async (t) => {
  const { store, paths } = await fixture(t);
  for (const bad of [
    "../outside",
    "..\\outside",
    "C:\\secret.json",
    randomUUID() + "/..",
    null,
  ]) {
    await assert.rejects(store.read(bad), /编号无效/);
    await assert.rejects(store.delete(bad), /编号无效/);
  }
  await assert.rejects(
    store.create({
      name: "无效字段",
      rows: [JSON.parse('{"__proto__":"polluted"}')],
    }),
    /保留名称/,
  );
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(await fs.readdir(paths.collectionsDir), []);
});

test("row limits reject oversized data without silent truncation or partial file writes", async (t) => {
  const { store, paths } = await fixture(t);
  await assert.rejects(
    store.create({
      name: "太多数据",
      rows: Array.from({ length: 10001 }, () => ({ 标题: "一行" })),
    }),
    /10,000/,
  );
  await assert.rejects(
    store.create({ name: "单元格过长", rows: [{ 标题: "中".repeat(12001) }] }),
    /12,000/,
  );
  await assert.rejects(
    store.create({ name: "嵌套内容", rows: [{ 标题: { x: 1 } }] }),
    /单元格/,
  );
  assert.throws(
    () =>
      sanitizeCollectionRows(
        Array.from({ length: 1000 }, () => ({ 标题: "中".repeat(10000) })),
      ),
    /20 MB/,
  );
  assert.deepEqual(await fs.readdir(paths.collectionsDir), []);
});

test("invalid edits and stale revisions leave the last saved document intact", async (t) => {
  const { store } = await fixture(t);
  const original = await store.create(sample());
  const current = await store.update({
    id: original.id,
    name: "当前版本",
    expectedUpdatedAt: original.updatedAt,
  });
  await assert.rejects(
    store.update({
      id: original.id,
      rows: [{ 标题: "错误覆盖" }],
      expectedUpdatedAt: original.updatedAt,
    }),
    /刚刚被修改/,
  );
  await assert.rejects(
    store.update({ id: original.id, name: "", rows: [] }),
    /文件名称/,
  );
  const retained = await store.read(original.id);
  assert.equal(retained.name, "当前版本");
  assert.equal(retained.rows[0].标题, "第一篇");
  assert.equal(retained.updatedAt, current.updatedAt);
});

test("concurrent saves preserve every document and one damaged file does not hide other files", async (t) => {
  const { store, paths } = await fixture(t);
  const saved = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      store.create({ ...sample(), name: `文件 ${index}` }),
    ),
  );
  assert.equal(new Set(saved.map((item) => item.id)).size, 6);
  await fs.writeFile(
    path.join(paths.collectionsDir, saved[0].filename),
    "{damaged",
    "utf8",
  );
  const list = await store.list();
  assert.equal(list.length, 6);
  assert.equal(list.find((item) => item.id === saved[0].id).unreadable, true);
  assert.equal(list.filter((item) => !item.unreadable).length, 5);
});

test("junction data directories cannot redirect storage outside the selected folder", async (t) => {
  const { root, paths, store } = await fixture(t);
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.rmdir(paths.collectionsDir);
  await fs.symlink(
    outside,
    paths.collectionsDir,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(store.create(sample()), /链接/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("legacy migration preserves originals and does not reimport a user-deleted file", async (t) => {
  const { root, paths, store } = await fixture(t);
  const legacyDir = path.join(root, "legacy", "tasks");
  await fs.mkdir(legacyDir, { recursive: true });
  const id = randomUUID();
  const emptyId = randomUUID();
  const content = JSON.stringify({
    id,
    ...sample(),
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  await fs.writeFile(path.join(legacyDir, id + ".json"), content);
  await fs.writeFile(
    path.join(legacyDir, emptyId + ".json"),
    JSON.stringify({ id: emptyId, name: "空历史", rows: [] }),
  );
  const first = await store.migrateLegacyHistory(legacyDir);
  assert.equal(first.imported.length, 1);
  assert.equal(first.errors.length, 0);
  assert.equal(first.skipped[0].reason, "empty");
  assert.equal((await store.read(id)).createdAt, "2025-01-01T00:00:00.000Z");
  assert.equal(
    await fs.readFile(path.join(legacyDir, id + ".json"), "utf8"),
    content,
  );
  await store.delete(id);
  const reopened = createCollectionStore(paths);
  const repeated = await reopened.migrateLegacyHistory(legacyDir);
  assert.equal(repeated.imported.length, 0);
  assert.equal(
    repeated.skipped.find((item) => item.id === id).reason,
    "already-imported",
  );
  assert.deepEqual(await reopened.list(), []);
});

test("migration resumes safely if a document was written before its manifest", async (t) => {
  const { root, paths, store } = await fixture(t);
  const legacyDir = path.join(root, "legacy");
  await fs.mkdir(legacyDir);
  const id = randomUUID();
  await fs.writeFile(
    path.join(legacyDir, id + ".json"),
    JSON.stringify({ id, ...sample() }),
  );
  await store.migrateLegacyHistory(legacyDir);
  await fs.unlink(path.join(paths.historyDir, "legacy-migration.json"));
  const repeated = await store.migrateLegacyHistory(legacyDir);
  assert.equal(repeated.imported.length, 0);
  assert.equal(repeated.errors.length, 0);
  assert.equal(repeated.skipped[0].reason, "already-imported");
  assert.equal((await store.list()).length, 1);
});
