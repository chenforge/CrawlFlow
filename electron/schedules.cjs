"use strict";
const { randomUUID } = require("node:crypto");
const { normalizeConfig } = require("./core.cjs");

function parseLocalAt(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
    String(value || ""),
  );
  if (!match) throw new Error("请选择完整的执行日期和时间。");
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    year < 2000 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  )
    throw new Error("执行日期或时间无效，请重新选择。");
  return date;
}

function parseDailyTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  if (!match) throw new Error("请选择有效的每日执行时间。");
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function nextDailyRun(time, now = new Date()) {
  const { hours, minutes } = parseDailyTime(time);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
    next.setHours(hours, minutes, 0, 0);
  }
  return next.toISOString();
}

function normalizeSchedule(input, existing = null, now = new Date()) {
  if (!input || typeof input !== "object")
    throw new Error("定时任务设置无效，请重新填写。");
  if (!["once", "daily"].includes(input.mode))
    throw new Error("请选择单次执行或每天执行。");
  const config = normalizeConfig(input.config);
  const enabled = input.enabled !== false;
  const name =
    String(input.name || config.name || "定时采集")
      .trim()
      .slice(0, 100) || "定时采集";
  let at = null;
  let time = null;
  let nextRunAt = null;
  if (input.mode === "once") {
    at = String(input.at || "");
    const date = parseLocalAt(at);
    if (enabled && date <= now)
      throw new Error("请选择未来的执行时间。已经错过的单次任务不会补跑。");
    if (enabled) nextRunAt = date.toISOString();
  } else {
    time = String(input.time || "");
    parseDailyTime(time);
    if (enabled) nextRunAt = nextDailyRun(time, now);
  }
  return {
    id: existing?.id || randomUUID(),
    name,
    config: { ...config, name },
    mode: input.mode,
    at,
    time,
    enabled,
    nextRunAt,
    lastRunAt: existing?.lastRunAt || null,
    lastJobId: existing?.lastJobId || null,
    lastStatus: existing?.lastStatus || null,
    status: enabled ? "scheduled" : "paused",
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function restoreSchedule(saved, now = new Date()) {
  if (!saved || !/^[a-f0-9-]{36}$/i.test(saved.id))
    throw new Error("定时任务记录无效。");
  const restored = normalizeSchedule({ ...saved, enabled: false }, saved, now);
  restored.lastStatus =
    saved.status === "running" ? "stopped" : saved.lastStatus || null;
  if (!saved.enabled)
    return {
      ...restored,
      status:
        saved.lastRunAt && saved.mode === "once"
          ? "completed"
          : saved.status === "missed"
            ? "missed"
            : "paused",
      updatedAt: saved.updatedAt || restored.updatedAt,
    };
  if (saved.mode === "once" && parseLocalAt(saved.at) <= now)
    return { ...restored, status: "missed", updatedAt: now.toISOString() };
  const active = normalizeSchedule({ ...saved, enabled: true }, restored, now);
  return { ...active, lastStatus: restored.lastStatus };
}

module.exports = {
  parseLocalAt,
  parseDailyTime,
  nextDailyRun,
  normalizeSchedule,
  restoreSchedule,
};
