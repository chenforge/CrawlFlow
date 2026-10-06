"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { normalizeConfig } = require("../electron/core.cjs");
const {
  normalizeAdvanced,
  parseHeaders,
  applyProtocol,
  mergeHeaders,
  overrideCharset,
  configureBrowserNetwork,
} = require("../electron/network.cjs");

test("old task files keep browser defaults and advanced limits are bounded", () => {
  const old = normalizeConfig({ urls: ["https://example.com"] }).advanced;
  assert.equal(old.enabled, false);
  assert.equal(old.protocol, "auto");
  assert.equal(old.encoding, "auto");
  assert.equal(old.timeoutMs, 25000);
  assert.equal(old.retries, 1);
  const advanced = normalizeAdvanced({
    enabled: true,
    timeoutMs: 999999,
    retries: -2,
    protocol: "ftp",
    encoding: "javascript",
  });
  assert.equal(advanced.timeoutMs, 120000);
  assert.equal(advanced.retries, 0);
  assert.equal(advanced.protocol, "auto");
  assert.equal(advanced.encoding, "auto");
});

test("protocol choice changes actual navigation URL only when enabled", () => {
  assert.equal(
    applyProtocol("http://example.com:8080/path?q=a#top", {
      enabled: true,
      protocol: "https",
    }),
    "https://example.com:8080/path?q=a",
  );
  assert.equal(
    applyProtocol("https://example.com", { enabled: true, protocol: "http" }),
    "http://example.com/",
  );
  assert.equal(
    applyProtocol("http://example.com", { enabled: false, protocol: "https" }),
    "http://example.com/",
  );
  assert.throws(
    () =>
      applyProtocol("file:///C:/Windows", { enabled: true, protocol: "https" }),
    /http/,
  );
  assert.throws(() => applyProtocol("https://user:secret@example.com"), /http/);
});

test("custom request headers reject forbidden browser fields, injection and duplicates", () => {
  assert.deepEqual(
    parseHeaders("Accept-Language: zh-CN\nX-Project: CrawlFlow:1.2"),
    [
      { name: "Accept-Language", value: "zh-CN" },
      { name: "X-Project", value: "CrawlFlow:1.2" },
    ],
  );
  for (const text of [
    "Host: elsewhere.test",
    "Cookie: session=secret",
    "Authorization: secret",
    "Content-Length: 0",
    "Sec-Fetch-Site: none",
    "Proxy-Foo: x",
    "Name: hello\rInjected",
    "X-Name: a\nx-name: b",
    "No colon here",
  ])
    assert.throws(() => parseHeaders(text));
  assert.throws(
    () => normalizeAdvanced({ enabled: true, userAgent: "Browser\r\nOther: injected" }),
    /浏览器标识/,
  );
  assert.throws(() => parseHeaders("X-Name: " + "x".repeat(17000)), /16 KB/);
  assert.doesNotThrow(() => normalizeAdvanced({ enabled: false, headers: 'invalid header', userAgent: 'bad\nvalue' }));
  const merged = mergeHeaders(
    { "accept-language": "en", Cookie: "website-session" },
    [{ name: "Accept-Language", value: "zh-CN" }],
  );
  assert.deepEqual(merged, {
    Cookie: "website-session",
    "Accept-Language": "zh-CN",
  });
});

test("forced charset replaces HTML charset while preserving security and unrelated response headers", () => {
  const original = {
    "content-type": ['text/html; charset="iso-8859-1"'],
    "Content-Security-Policy": ["default-src 'self'"],
    "Set-Cookie": ["session=one"],
  };
  const result = overrideCharset(original, "gb18030");
  assert.deepEqual(result["content-type"], ["text/html; charset=gb18030"]);
  assert.deepEqual(
    result["Content-Security-Policy"],
    original["Content-Security-Policy"],
  );
  assert.deepEqual(result["Set-Cookie"], original["Set-Cookie"]);
  assert.deepEqual(original["content-type"], [
    'text/html; charset="iso-8859-1"',
  ]);
  const image = { "Content-Type": ["image/png"] };
  assert.equal(overrideCharset(image, "utf-8"), image);
  assert.equal(overrideCharset(original, "auto"), original);
});

function mockSession() {
  const listeners = {};
  const calls = {};
  const webRequest = {};
  for (const name of [
    "onBeforeRequest",
    "onBeforeSendHeaders",
    "onHeadersReceived",
  ])
    webRequest[name] = (listener) => {
      listeners[name] = listener;
      calls[name] = (calls[name] || 0) + 1;
    };
  return { webRequest, listeners, calls };
}

function mockWindow(id, session) {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    session,
    userAgent: "DefaultBrowser",
    getUserAgent() {
      return this.userAgent;
    },
    setUserAgent(value) {
      this.userAgent = value;
    },
  });
  return { webContents };
}

function dispatch(session, name, input) {
  let result;
  session.listeners[name](input, (value) => {
    result = value;
  });
  assert.notEqual(result, undefined);
  return result;
}

test("advanced settings remain isolated across windows and do not leak custom headers across origins", () => {
  const session = mockSession();
  const custom = mockWindow(1, session);
  const normal = mockWindow(2, session);
  configureBrowserNetwork(
    custom,
    {
      enabled: true,
      headers: "X-Project: CrawlFlow",
      encoding: "gb18030",
      userAgent: "CrawlFlow/1.2",
      blockImages: true,
    },
    "https://example.com/page",
  );
  configureBrowserNetwork(normal, {}, "https://example.com/page");
  assert.equal(session.calls.onBeforeRequest, 1);
  assert.equal(custom.webContents.userAgent, "CrawlFlow/1.2");
  assert.equal(normal.webContents.userAgent, "DefaultBrowser");
  const details = {
    webContentsId: 1,
    url: "https://example.com/data",
    requestHeaders: { Cookie: "existing-session" },
  };
  assert.equal(
    dispatch(session, "onBeforeSendHeaders", details).requestHeaders[
      "X-Project"
    ],
    "CrawlFlow",
  );
  assert.equal(
    dispatch(session, "onBeforeSendHeaders", {
      ...details,
      url: "https://third-party.test/data",
    }).requestHeaders["X-Project"],
    undefined,
  );
  assert.deepEqual(
    dispatch(session, "onBeforeSendHeaders", { ...details, webContentsId: 2 }),
    {},
  );
  assert.deepEqual(
    dispatch(session, "onBeforeSendHeaders", {
      ...details,
      webContentsId: 999,
    }),
    {},
  );
  assert.equal(
    dispatch(session, "onBeforeRequest", { ...details, resourceType: "image" })
      .cancel,
    true,
  );
  assert.equal(
    dispatch(session, "onBeforeRequest", { ...details, resourceType: "script" })
      .cancel,
    false,
  );
  assert.equal(
    dispatch(session, "onBeforeRequest", {
      ...details,
      webContentsId: 2,
      resourceType: "image",
    }).cancel,
    false,
  );
  const html = {
    ...details,
    resourceType: "mainFrame",
    responseHeaders: { "Content-Type": ["text/html; charset=utf-8"] },
  };
  assert.deepEqual(
    dispatch(session, "onHeadersReceived", html).responseHeaders[
      "Content-Type"
    ],
    ["text/html; charset=gb18030"],
  );
  assert.deepEqual(
    dispatch(session, "onHeadersReceived", { ...html, webContentsId: 2 }),
    {},
  );
  configureBrowserNetwork(custom, { enabled: false }, "https://example.com");
  assert.equal(custom.webContents.userAgent, "DefaultBrowser");
  assert.deepEqual(dispatch(session, "onBeforeSendHeaders", details), {});
  custom.webContents.emit("destroyed");
  assert.equal(typeof session.listeners.onBeforeRequest, "function");
  normal.webContents.emit("destroyed");
  assert.equal(session.listeners.onBeforeRequest, null);
  assert.equal(session.listeners.onBeforeSendHeaders, null);
  assert.equal(session.listeners.onHeadersReceived, null);
});
