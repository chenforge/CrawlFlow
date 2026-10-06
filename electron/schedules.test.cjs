"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseLocalAt,
  nextDailyRun,
  normalizeSchedule,
  restoreSchedule,
} = require("./schedules.cjs");
const config = {
  name: "文章",
  urls: ["https://example.com"],
  template: "articles",
};
const now = new Date(2026, 9, 4, 8, 30, 0, 0);

test("local date parsing rejects impossible dates and preserves local wall-clock time", () => {
  const date = parseLocalAt("2026-10-05T09:15");
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 15);
  assert.equal(date.getDate(), 5);
  for (const value of [
    "2026-02-30T09:00",
    "2026-10-05T25:00",
    "2026-10-05T09:61",
    "tomorrow",
  ])
    assert.throws(() => parseLocalAt(value));
});

test("daily execution uses the next local occurrence, including month boundaries", () => {
  const today = new Date(nextDailyRun("09:00", now));
  assert.equal(today.getDate(), 4);
  assert.equal(today.getHours(), 9);
  const tomorrow = new Date(nextDailyRun("08:00", now));
  assert.equal(tomorrow.getDate(), 5);
  assert.equal(tomorrow.getHours(), 8);
  const month = new Date(nextDailyRun("09:00", new Date(2026, 9, 31, 10)));
  assert.equal(month.getMonth(), 10);
  assert.equal(month.getDate(), 1);
});

test("once schedules require a future time when enabled", () => {
  assert.throws(
    () =>
      normalizeSchedule(
        { config, mode: "once", at: "2026-10-04T08:00" },
        null,
        now,
      ),
    /未来/,
  );
  const future = normalizeSchedule(
    { config, mode: "once", at: "2026-10-05T10:00" },
    null,
    now,
  );
  assert.equal(future.enabled, true);
  assert.equal(future.status, "scheduled");
  assert.ok(future.nextRunAt);
  const paused = normalizeSchedule(
    { config, mode: "once", at: "2026-10-04T08:00", enabled: false },
    null,
    now,
  );
  assert.equal(paused.nextRunAt, null);
});

test("restart skips missed once jobs and reschedules daily jobs without catch-up", () => {
  const earlier = new Date(2026, 9, 3, 8);
  const once = normalizeSchedule(
    { config, mode: "once", at: "2026-10-03T09:00" },
    null,
    earlier,
  );
  const restoredOnce = restoreSchedule(once, now);
  assert.equal(restoredOnce.enabled, false);
  assert.equal(restoredOnce.status, "missed");
  assert.equal(restoredOnce.nextRunAt, null);
  const daily = normalizeSchedule(
    { config, mode: "daily", time: "08:00" },
    null,
    earlier,
  );
  const restoredDaily = restoreSchedule(daily, now);
  assert.equal(new Date(restoredDaily.nextRunAt).getDate(), 5);
});

test("edits retain record identity and execution history, and validate crawl config", () => {
  const first = normalizeSchedule(
    { config, mode: "daily", time: "09:00" },
    null,
    now,
  );
  first.lastJobId = "previous-job";
  first.lastStatus = "completed";
  const edited = normalizeSchedule(
    { ...first, name: "晨间文章", time: "10:00" },
    first,
    now,
  );
  assert.equal(edited.id, first.id);
  assert.equal(edited.lastJobId, "previous-job");
  assert.equal(edited.config.name, "晨间文章");
  assert.throws(
    () =>
      normalizeSchedule(
        { config: { urls: ["file:///secret"] }, mode: "daily", time: "09:00" },
        null,
        now,
      ),
    /http/,
  );
  assert.throws(
    () =>
      normalizeSchedule({ config, mode: "daily", time: "24:00" }, null, now),
    /有效/,
  );
});
