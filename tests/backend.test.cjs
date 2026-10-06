"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeConfig,
  webUrl,
  safeSpreadsheet,
  sanitizeRows,
  toCsv,
} = require("../electron/core.cjs");

test("only web URLs without embedded credentials are accepted", () => {
  assert.equal(
    webUrl(" https://example.com/news#top "),
    "https://example.com/news",
  );
  for (const url of [
    "file:///C:/Windows/system.ini",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:secret@example.com",
    "not a url",
  ])
    assert.throws(() => webUrl(url), /http/);
});

test("config constrains task size, timings, fields and duplicate input URLs", () => {
  const result = normalizeConfig({
    urls: ["https://example.com", "https://example.com/#a"],
    maxPages: 2000,
    maxRows: 500000,
    waitMs: -3,
    delayMs: 0,
  });
  assert.equal(result.urls.length, 1);
  assert.equal(result.maxPages, 50);
  assert.equal(result.maxRows, 10000);
  assert.equal(result.waitMs, 500);
  assert.equal(result.delayMs, 1000);
  assert.throws(
    () =>
      normalizeConfig({
        urls: ["https://example.com"],
        template: "custom",
        fields: [{ name: "A", selector: "" }],
      }),
    /点选/,
  );
  assert.throws(
    () =>
      normalizeConfig({
        urls: ["https://example.com"],
        template: "custom",
        fields: [{ name: "__proto__", selector: "a" }],
      }),
    /保留/,
  );
  assert.throws(
    () =>
      normalizeConfig({
        urls: ["https://example.com"],
        fields: [
          { name: "A", selector: "a" },
          { name: "A", selector: "p" },
        ],
      }),
    /重复/,
  );
});

test("spreadsheet export neutralizes formula prefixes including leading whitespace", () => {
  for (const value of [
    "=1+1",
    "+CMD",
    "-2+3",
    "@SUM(A1)",
    '\t=HYPERLINK("x")',
    "\r\n+1",
  ])
    assert.equal(safeSpreadsheet(value), "'" + value);
  assert.equal(safeSpreadsheet("普通文章"), "普通文章");
  assert.equal(safeSpreadsheet("https://example.com"), "https://example.com");
});

test("CSV handles Unicode, quoted values, line breaks and formula injection", () => {
  const csv = toCsv([{ 标题: '你好,"朋友"\n第二行', 数值: "=1+1" }]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"你好,""朋友""\n第二行"/);
  assert.match(csv, /"'=1\+1"/);
});

test("export rows are bounded, string-only and ignore prototype keys", () => {
  const rows = sanitizeRows([
    JSON.parse(
      '{"__proto__":"bad","constructor":"bad","title":"ok","value":42}',
    ),
  ]);
  assert.equal(rows[0].title, "ok");
  assert.equal(rows[0].value, "42");
  assert.equal(Object.hasOwn(rows[0], "__proto__"), false);
  assert.equal(Object.hasOwn(rows[0], "constructor"), false);
  assert.throws(() => sanitizeRows([]), /没有/);
});
