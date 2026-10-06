"use strict";

const PROTOCOLS = new Set(["auto", "http", "https"]);
const ENCODINGS = new Set(["auto", "utf-8", "gb18030", "big5", "shift_jis"]);
const FORBIDDEN_HEADERS = new Set([
  "host",
  "cookie",
  "cookie2",
  "authorization",
  "proxy-authorization",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "user-agent",
  "origin",
  "referer",
]);
const sessions = new WeakMap();
const windows = new WeakMap();

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === "" || value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}

function parseHeaders(value = "") {
  const text = String(value || "");
  if (text.length > 16384)
    throw new Error("自定义请求头过长，请控制在 16 KB 以内。");
  const headers = [];
  const used = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (colon < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name))
      throw new Error("请求头格式应为「名称: 值」，每行填写一个。");
    if (!/^[\x20-\x7e]*$/.test(value))
      throw new Error(
        "请求头的值只能包含可打印的英文字符，不能包含换行或控制字符。",
      );
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || /^(sec-|proxy-)/.test(lower))
      throw new Error(
        `不能自定义 ${name} 请求头；登录信息请通过「打开网页」完成登录。`,
      );
    if (used.has(lower)) throw new Error(`请求头 ${name} 重复，请只保留一行。`);
    used.add(lower);
    headers.push({ name, value });
    if (headers.length > 30) throw new Error("最多设置 30 个自定义请求头。");
  }
  return headers;
}

function normalizeAdvanced(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  const enabled = input.enabled === true;
  let userAgent = String(input.userAgent || "").trim();
  if (userAgent.length > 512 || !/^[\x20-\x7e]*$/.test(userAgent)) {
    if (enabled) throw new Error("浏览器标识只能填写 512 个以内的可打印英文字符。");
    userAgent = "";
  }
  let headers = "";
  try {
    headers = parseHeaders(input.headers).map((header) => `${header.name}: ${header.value}`).join("\n");
  } catch (error) { if (enabled) throw error; }
  return {
    enabled,
    protocol: PROTOCOLS.has(input.protocol) ? input.protocol : "auto",
    encoding: ENCODINGS.has(input.encoding) ? input.encoding : "auto",
    timeoutMs: boundedInteger(input.timeoutMs, 25000, 3000, 120000),
    retries: boundedInteger(input.retries, 1, 0, 3),
    userAgent,
    headers,
    blockImages: input.blockImages === true,
    blockMedia: input.blockMedia === true,
  };
}

function applyProtocol(value, advanced) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("请输入完整的网址，以 http:// 或 https:// 开头。");
  if (
    advanced?.enabled &&
    PROTOCOLS.has(advanced.protocol) &&
    advanced.protocol !== "auto"
  )
    url.protocol = advanced.protocol + ":";
  url.hash = "";
  return url.href;
}

function mergeHeaders(original, overrides) {
  const next = { ...original };
  for (const { name, value } of overrides) {
    for (const existing of Object.keys(next))
      if (existing.toLowerCase() === name.toLowerCase()) delete next[existing];
    next[name] = value;
  }
  return next;
}

function overrideCharset(headers = {}, encoding) {
  if (!ENCODINGS.has(encoding) || encoding === "auto") return headers;
  const key = Object.keys(headers).find(
    (name) => name.toLowerCase() === "content-type",
  );
  const original = key
    ? String(Array.isArray(headers[key]) ? headers[key][0] : headers[key])
    : "text/html";
  if (!/^\s*(text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(original))
    return headers;
  const withoutCharset = original.replace(
    /;\s*charset\s*=\s*(?:"[^"]*"|'[^']*'|[^;]*)/gi,
    "",
  );
  return {
    ...headers,
    [key || "Content-Type"]: [`${withoutCharset}; charset=${encoding}`],
  };
}

function installSessionHooks(session) {
  let registry = sessions.get(session);
  if (registry) return registry;
  registry = new Map();
  sessions.set(session, registry);
  // Electron allows one listener per event. A single registry routes settings
  // to the requesting window, while preserving the shared website login session.
  session.webRequest.onBeforeRequest((details, callback) => {
    const entry = registry.get(details.webContentsId);
    const active = entry?.advanced.enabled;
    callback({
      cancel: Boolean(
        active &&
          ((entry.advanced.blockImages && details.resourceType === "image") ||
            (entry.advanced.blockMedia && details.resourceType === "media")),
      ),
    });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const entry = registry.get(details.webContentsId);
    if (!entry?.advanced.enabled) return callback({});
    let sameOrigin = false;
    try {
      sameOrigin = new URL(details.url).origin === entry.origin;
    } catch {}
    // Headers supplied for a site must never follow it onto an unrelated host.
    const overrides = sameOrigin ? entry.headers : [];
    callback({
      requestHeaders: mergeHeaders(details.requestHeaders, overrides),
    });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const entry = registry.get(details.webContentsId);
    if (
      !entry?.advanced.enabled ||
      !["mainFrame", "subFrame"].includes(details.resourceType) ||
      entry.advanced.encoding === "auto"
    )
      return callback({});
    callback({
      responseHeaders: overrideCharset(
        details.responseHeaders,
        entry.advanced.encoding,
      ),
    });
  });
  return registry;
}

function configureBrowserNetwork(window, input, url) {
  const advanced = normalizeAdvanced(input);
  const webContents = window.webContents;
  let entry = windows.get(window);
  if (!entry) {
    const browserSession = webContents.session;
    const registry = installSessionHooks(browserSession);
    const id = webContents.id;
    entry = {
      defaultUserAgent: webContents.getUserAgent(),
      advanced,
      origin: null,
      headers: [],
    };
    windows.set(window, entry);
    registry.set(id, entry);
    webContents.once("destroyed", () => {
      registry.delete(id);
      windows.delete(window);
      if (!registry.size) {
        browserSession.webRequest.onBeforeRequest(null);
        browserSession.webRequest.onBeforeSendHeaders(null);
        browserSession.webRequest.onHeadersReceived(null);
        sessions.delete(browserSession);
      }
    });
  }
  entry.advanced = advanced;
  entry.headers = parseHeaders(advanced.headers);
  if (url) entry.origin = new URL(applyProtocol(url, advanced)).origin;
  webContents.setUserAgent(
    advanced.enabled && advanced.userAgent
      ? advanced.userAgent
      : entry.defaultUserAgent,
  );
  return advanced;
}

function browserNetworkOptions(window) {
  return windows.get(window)?.advanced || normalizeAdvanced();
}

module.exports = {
  normalizeAdvanced,
  parseHeaders,
  applyProtocol,
  mergeHeaders,
  overrideCharset,
  configureBrowserNetwork,
  browserNetworkOptions,
};
