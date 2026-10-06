"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateLegacyProfile } = require("../electron/profile-migration.cjs");

test("profile upgrade preserves settings and cookies, omits caches, and is idempotent", (t) => {
  const base = fs.mkdtempSync(
    path.join(os.tmpdir(), "crawlflow-profile-test-"),
  );
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const legacy = path.join(base, "legacy");
  const runtime = path.join(base, "runtime");
  fs.mkdirSync(path.join(legacy, "Partitions", "crawler", "Network"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(legacy, "Partitions", "crawler", "Cache"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(legacy, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "Preferences"), "old preferences");
  fs.writeFileSync(
    path.join(legacy, "Partitions", "crawler", "Network", "Cookies"),
    "cookie fixture",
  );
  fs.writeFileSync(
    path.join(legacy, "Partitions", "crawler", "Cache", "cache"),
    "discard",
  );
  fs.writeFileSync(
    path.join(legacy, "tasks", "record.json"),
    "handled separately",
  );
  const result = migrateLegacyProfile(legacy, runtime);
  assert.equal(result.files, 2);
  assert.equal(
    fs.readFileSync(
      path.join(runtime, "Partitions", "crawler", "Network", "Cookies"),
      "utf8",
    ),
    "cookie fixture",
  );
  assert.equal(
    fs.existsSync(path.join(runtime, "Partitions", "crawler", "Cache")),
    false,
  );
  assert.equal(fs.existsSync(path.join(runtime, "tasks")), false);
  assert.equal(fs.existsSync(path.join(legacy, "Preferences")), true);
  fs.writeFileSync(path.join(runtime, "Preferences"), "new preferences");
  assert.equal(migrateLegacyProfile(legacy, runtime).alreadyMigrated, true);
  assert.equal(
    fs.readFileSync(path.join(runtime, "Preferences"), "utf8"),
    "new preferences",
  );
  assert.throws(
    () => migrateLegacyProfile(legacy, path.join(legacy, "nested")),
    /重叠/,
  );
});
