'use strict';
const { app, BrowserWindow, ipcMain, dialog, session, Menu, clipboard, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { webUrl, normalizeConfig, sanitizeRows, safeSpreadsheet, toCsv, extractPage } = require('./core.cjs');
const { pickElement } = require('./picker.cjs');
const { startDemoServer } = require('./demo-server.cjs');
const { detectPageFields } = require('./inspect.cjs');
const { normalizeSchedule, restoreSchedule, nextDailyRun } = require('./schedules.cjs');

const userDataArg = process.argv.find(value => value.startsWith('--user-data-dir='));
// The previous app's verified default directory was named 轻采集. Preserve it across rebranding.
const preservedUserData = process.env.CRAWLFLOW_USER_DATA || process.env.QINGCAIJI_USER_DATA || (userDataArg && userDataArg.slice('--user-data-dir='.length)) || path.join(app.getPath('appData'), '轻采集');
app.setPath('userData', preservedUserData);
app.setPath('sessionData', preservedUserData);
app.setName('CrawlFlow');
app.setAppUserModelId('local.crawlflow.desktop');
let mainWindow;
let loginWindow;
let pickerWindow;
let activeJob = null;
let previewController = null;
let demo = null;
let history = [];
let historyWrite = Promise.resolve();
let schedules = [];
let scheduleWrite = Promise.resolve();
let scheduleTimer = null;
let schedulerTicking = false;
let quitting = false;
let appUrl = '';
const externalWindows = new Set();
const historyDir = () => path.join(app.getPath('userData'), 'tasks');
const schedulesPath = () => path.join(app.getPath('userData'), 'schedules.json');

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (error?.name === 'AbortError' || /采集已停止/.test(message)) return '采集已停止，已获取的数据已保留。';
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED/i.test(message)) return '网页无法连接，请检查网络和网址后重试。';
  if (/ERR_CERT|ERR_SSL/i.test(message)) return '这个网页的安全证书存在问题，请检查网址或联系网站管理员。';
  if (/ERR_HTTP_RESPONSE_CODE_FAILURE/i.test(message)) return '网站拒绝了访问，请在浏览器中检查是否需要登录。';
  if (/destroyed|closed|ERR_ABORTED|execution context/i.test(message)) return '网页窗口已关闭或正在跳转，请重新打开后再试。';
  if (/ENOSPC/i.test(message)) return '磁盘空间不足，请清理空间后再试。';
  if (/EACCES|EPERM|EBUSY/i.test(message)) return '文件无法写入，可能正在被其他程序使用，请换一个保存位置。';
  if (/[\u3400-\u9fff]/u.test(message)) return message.slice(0, 300);
  return '操作未能完成，请检查网页是否可访问后重试。';
}

function abortError() { const error = new Error('采集已停止'); error.name = 'AbortError'; return error; }
function abortIfNeeded(signal) { if (signal?.aborted) throw abortError(); }
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    abortIfNeeded(signal);
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
function bounded(promise, milliseconds, signal, message = '网页响应超时，请稍后重试，或增加网页等待时间。') {
  return new Promise((resolve, reject) => {
    let finished = false;
    const complete = (fn, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); fn(value);
    };
    const timer = setTimeout(() => complete(reject, new Error(message)), milliseconds);
    const cancel = () => complete(reject, abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    Promise.resolve(promise).then(value => complete(resolve, value), error => complete(reject, error));
  });
}

async function atomicWrite(filename, content) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, content, 'utf8'); await fs.rename(temporary, filename); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

async function initializeHistory() {
  await fs.mkdir(historyDir(), { recursive: true });
  try {
    const list = JSON.parse(await fs.readFile(path.join(historyDir(), 'index.json'), 'utf8'));
    history = Array.isArray(list) ? list.filter(item => /^[a-f0-9-]{36}$/i.test(item.id)).slice(0, 20).map(item => ({ ...item, status: item.status === 'running' ? 'stopped' : item.status })) : [];
  } catch { history = []; }
}

async function initializeSchedules() {
  try {
    const list = JSON.parse(await fs.readFile(schedulesPath(), 'utf8'));
    const now = new Date();
    schedules = (Array.isArray(list) ? list : []).slice(0, 20).flatMap(item => {
      try { return [restoreSchedule(item, now)]; } catch { return []; }
    });
  } catch { schedules = []; }
  await atomicWrite(schedulesPath(), JSON.stringify(schedules));
}

function mutateSchedules(update) {
  const operation = scheduleWrite.catch(() => {}).then(async () => {
    const mutation = update(schedules);
    if (!mutation) return null;
    await atomicWrite(schedulesPath(), JSON.stringify(mutation.list));
    schedules = mutation.list;
    return mutation.result;
  });
  scheduleWrite = operation;
  return operation;
}

function createJob(config, extra = {}) {
  return { id: randomUUID(), createdAt: new Date().toISOString(), config, rows: [], page: 0, status: 'running', controller: new AbortController(), window: null, ...extra };
}

async function finishSchedule(job) {
  if (!job.scheduleId) return;
  await mutateSchedules(list => ({
    list: list.map(item => item.id === job.scheduleId ? { ...item, lastStatus: job.status, status: item.enabled ? 'scheduled' : item.mode === 'once' ? 'completed' : 'paused', updatedAt: new Date().toISOString() } : item),
    result: true,
  }));
}

async function tickSchedules() {
  if (quitting || schedulerTicking || activeJob || previewController || (pickerWindow && !pickerWindow.isDestroyed())) return;
  schedulerTicking = true;
  let job;
  try {
    job = await mutateSchedules(list => {
      if (quitting || activeJob || previewController || (pickerWindow && !pickerWindow.isDestroyed())) return null;
      const now = new Date();
      const due = list.filter(item => item.enabled && item.nextRunAt && new Date(item.nextRunAt) <= now).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))[0];
      if (!due) return null;
      const task = createJob(due.config, { source: 'schedule', name: due.name, scheduleId: due.id });
      activeJob = task;
      job = task;
      const next = { ...due, enabled: due.mode === 'daily', nextRunAt: due.mode === 'daily' ? nextDailyRun(due.time, now) : null, lastRunAt: now.toISOString(), lastJobId: task.id, lastStatus: 'running', status: 'running', updatedAt: now.toISOString() };
      return { list: list.map(item => item.id === due.id ? next : item), result: task };
    });
    if (job && !quitting) setImmediate(() => runJob(job));
  } catch (error) {
    if (job) {
      job.status = 'error';
      emitProgress(job, '定时任务无法启动：' + friendlyError(error));
      if (activeJob?.id === job.id) activeJob = null;
    }
  } finally { schedulerTicking = false; }
}

function metadata(job) {
  return { id: job.id, name: job.config.name, createdAt: job.createdAt, rowsCount: job.rows.length, pageCount: job.page, status: job.status, config: job.config, ...(job.source ? { source: job.source, scheduleId: job.scheduleId } : {}) };
}

function saveJob(job) {
  const record = { ...metadata(job), rows: job.rows };
  const bytes = JSON.stringify(record);
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    const discarded = history.filter(item => item.id !== job.id).slice(19);
    const { rows: _rows, ...recordMetadata } = record;
    history = [recordMetadata, ...history.filter(item => item.id !== job.id)].slice(0, 20);
    await atomicWrite(path.join(historyDir(), job.id + '.json'), bytes);
    await atomicWrite(path.join(historyDir(), 'index.json'), JSON.stringify(history));
    await Promise.all(discarded.map(item => fs.unlink(path.join(historyDir(), item.id + '.json')).catch(() => {})));
  });
  return historyWrite;
}

function secureBrowser(visible, title = '网页浏览 · CrawlFlow') {
  const window = new BrowserWindow({
    show: visible, width: 1220, height: 850, minWidth: 760, minHeight: 560, title,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#0c1420', autoHideMenuBar: true,
    webPreferences: { partition: 'persist:crawler', contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, spellcheck: false, backgroundThrottling: false },
  });
  externalWindows.add(window);
  window.on('closed', () => externalWindows.delete(window));
  const guard = (event, url) => { try { webUrl(typeof url === 'string' ? url : url.url); } catch { event.preventDefault(); } };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', guard);
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(details => {
    if (visible) {
      try { const url = webUrl(details.url); window.loadURL(url).catch(() => {}); } catch { /* Non-web popups are blocked. */ }
    }
    return { action: 'deny' };
  });
  if (visible) {
    const navigation = window.webContents.navigationHistory;
    window.setMenu(Menu.buildFromTemplate([{ label: '网页操作', submenu: [
      { label: '后退', accelerator: 'Alt+Left', click: () => { if (navigation.canGoBack()) navigation.goBack(); } },
      { label: '前进', accelerator: 'Alt+Right', click: () => { if (navigation.canGoForward()) navigation.goForward(); } },
      { label: '刷新', accelerator: 'Ctrl+R', click: () => window.webContents.reload() },
      { type: 'separator' },
      { label: '复制当前网址', accelerator: 'Ctrl+Shift+C', click: () => clipboard.writeText(window.webContents.getURL()) },
      { label: title.includes('点选') ? '取消点选并返回 CrawlFlow' : '完成登录并返回 CrawlFlow', accelerator: 'Ctrl+Enter', click: () => { if (title.includes('点选')) window.close(); else window.hide(); if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } },
    ] }]));
    window.setMenuBarVisibility(true);
    window.webContents.on('page-title-updated', event => event.preventDefault());
    window.webContents.on('did-navigate', (_event, url) => { try { window.setTitle(`${new URL(url).hostname} · ${title}`); } catch {} });
  }
  return window;
}

async function loadPage(window, url, waitMs, signal) {
  abortIfNeeded(signal);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await bounded(window.loadURL(webUrl(url)), 25000, signal);
      await delay(waitMs, signal);
      webUrl(window.webContents.getURL());
      return;
    } catch (error) {
      abortIfNeeded(signal);
      if (window.isDestroyed()) throw error;
      window.webContents.stop();
      lastError = error;
      if (attempt === 0) await delay(800, signal);
    }
  }
  throw lastError;
}

async function capture(window, config, signal) {
  abortIfNeeded(signal);
  const code = `(() => { try { return { ok: true, value: (${extractPage.toString()})(${JSON.stringify(config)}) }; } catch (error) { return { ok: false, error: String(error?.message || '网页内容读取失败，请重新预览。') }; } })()`;
  const result = await bounded(window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code }], true), 18000, signal, '网页内容较复杂，读取超时。请减少采集数量或稍后再试。');
  if (!result?.ok) throw new Error(result?.error || '网页内容读取失败，请重新预览。');
  return result.value;
}

async function capturePreviewImage(window, signal) {
  // A newly created hidden window can have no compositor frame yet, even
  // after the document is ready. Allow a brief redraw before failing preview.
  for (let attempt = 0; attempt < 3; attempt++) {
    abortIfNeeded(signal);
    try {
      const screenshot = await bounded(window.webContents.capturePage(
        { x: 0, y: 0, width: 1280, height: 720 },
        { stayHidden: true, stayAwake: true },
      ), 5000, signal, '网页截图超时，请重试。');
      abortIfNeeded(signal);
      if (!screenshot.isEmpty()) return screenshot.resize({ width: 1280, height: 720 }).toDataURL();
    } catch (error) {
      abortIfNeeded(signal);
      if (window.isDestroyed()) throw error;
    }
    if (attempt < 2) await delay(250, signal);
  }
  throw new Error('网页预览暂时未能生成，请稍后重试，或增加网页等待时间。');
}

function emitProgress(job, message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collector:progress', { id: job.id, status: job.status, page: job.page, rows: job.rows, message, ...(job.source ? { source: job.source, name: job.name || job.config.name, scheduleId: job.scheduleId } : {}) });
}

async function runJob(job) {
  const signal = job.controller.signal;
  const queue = job.config.urls.map(url => ({ url, origin: null }));
  const visited = new Set();
  const fingerprints = new Set();
  const rowKeys = new Set();
  let contentBudget = 20 * 1024 * 1024;
  let window;
  try {
    window = secureBrowser(false, '正在采集 · CrawlFlow');
    job.window = window;
    await saveJob(job);
    emitProgress(job, '正在打开第一个网页…');
    while (queue.length && job.page < job.config.maxPages && job.rows.length < job.config.maxRows) {
      abortIfNeeded(signal);
      const item = queue.shift();
      if (item.url) {
        if (visited.has(item.url)) continue;
        visited.add(item.url);
        if (job.page > 0) await delay(job.config.delayMs, signal);
        emitProgress(job, `正在读取第 ${job.page + 1} 个网页…`);
        await loadPage(window, item.url, job.config.waitMs, signal);
      } else {
        await delay(job.config.delayMs, signal);
        try {
          await bounded(window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => { const element = document.querySelectorAll('a,button,[role="button"]')[${item.clickIndex}]; if (element) { element.click(); return true; } return false; })()` }], true), 10000, signal);
        } catch (error) {
          abortIfNeeded(signal);
          if (!/execution context|ERR_ABORTED/i.test(String(error.message))) throw error;
        }
        await delay(job.config.waitMs, signal);
      }
      const currentUrl = webUrl(window.webContents.getURL());
      if (item.origin && new URL(currentUrl).origin !== item.origin) throw new Error('翻页跳转到了其他网站，已停止并保留现有数据。');
      const page = await capture(window, { ...job.config, _captureLimit: 10000 }, signal);
      const fingerprintHash = createHash('sha256').update(page.url + '\n' + page.fingerprint);
      for (const row of page.rows) fingerprintHash.update('\n' + JSON.stringify(row));
      const fingerprint = fingerprintHash.digest('hex');
      if (fingerprints.has(fingerprint)) continue;
      fingerprints.add(fingerprint);
      job.page++;
      for (const row of page.rows) {
        const key = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([name]) => name !== '来源网页')));
        if (job.config.dedupe && rowKeys.has(key)) continue;
        contentBudget -= key.length;
        if (contentBudget < 0) throw new Error('已达到单次采集的内容容量，已保留现有数据。请拆分为多个任务。');
        rowKeys.add(key); job.rows.push(row);
        if (job.rows.length >= job.config.maxRows) break;
      }
      await saveJob(job);
      emitProgress(job, `已完成 ${job.page} 页，采集到 ${job.rows.length} 条数据。`);
      if (page.next && job.page < job.config.maxPages) {
        const origin = new URL(page.url).origin;
        if (page.next.url && !visited.has(webUrl(page.next.url))) queue.unshift({ url: webUrl(page.next.url), origin });
        else if (Number.isInteger(page.next.clickIndex)) queue.unshift({ clickIndex: page.next.clickIndex, origin });
      }
    }
    abortIfNeeded(signal);
    job.status = 'completed';
    await saveJob(job);
    await finishSchedule(job);
    emitProgress(job, job.rows.length ? `采集完成！共 ${job.page} 页、${job.rows.length} 条数据。` : '采集完成，未找到匹配内容。可以更换模板、调整筛选或先登录网页。');
  } catch (error) {
    job.status = signal.aborted ? 'stopped' : 'error';
    let message = friendlyError(error);
    try { await saveJob(job); } catch (saveError) { message += ' 历史记录保存失败：' + friendlyError(saveError); }
    try { await finishSchedule(job); } catch (scheduleError) { message += ' 定时任务状态保存失败：' + friendlyError(scheduleError); }
    emitProgress(job, message);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    if (activeJob?.id === job.id) activeJob = null;
  }
}

function assertTrusted(event) {
  const senderUrl = event.senderFrame?.url?.split('#')[0];
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || senderUrl !== appUrl.split('#')[0]) throw new Error('此操作只能由 CrawlFlow 主窗口发起。');
}

function handle(name, fn) {
  ipcMain.handle('collector:' + name, async (event, value) => {
    assertTrusted(event);
    try { return await fn(value); }
    catch (error) { throw new Error(friendlyError(error)); }
  });
}

function registerApi() {
  handle('getAppInfo', () => ({ version: app.getVersion(), demoUrl: demo.url }));
  handle('getSchedules', async () => { await scheduleWrite.catch(() => {}); return schedules; });
  handle('saveSchedule', input => mutateSchedules(list => {
    const existing = input?.id ? list.find(item => item.id === input.id) : null;
    if (input?.id && !existing) throw new Error('这个定时任务不存在，可能已经被删除。');
    if (!existing && list.length >= 20) throw new Error('最多保存 20 个定时任务，请先删除不需要的任务。');
    const record = normalizeSchedule(input, existing);
    return { list: existing ? list.map(item => item.id === record.id ? record : item) : [record, ...list], result: record };
  }));
  handle('deleteSchedule', id => mutateSchedules(list => {
    if (!list.some(item => item.id === id)) throw new Error('这个定时任务不存在。');
    return { list: list.filter(item => item.id !== id), result: true };
  }));
  handle('inspect', async input => {
    if (previewController) throw new Error('预览正在进行，请稍候。');
    if (activeJob) throw new Error('正在采集，请先停止当前任务后再预览。');
    const options = typeof input === 'string' ? { url: input } : (input || {});
    const url = webUrl(options.url);
    const waitMs = Math.max(500, Math.min(15000, Number(options.waitMs) || 1500));
    const controller = new AbortController();
    previewController = controller;
    const window = secureBrowser(false, '网页预览 · CrawlFlow');
    window.setContentSize(1280, 720);
    const cancel = () => { if (!window.isDestroyed()) window.destroy(); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      await loadPage(window, url, waitMs, controller.signal);
      const code = `(() => { try { return { ok: true, value: (${detectPageFields.toString()})(${JSON.stringify(options.template || 'auto')}) }; } catch(error) { return { ok: false, error: String(error?.message || '网页字段识别失败，请使用点选方式。') }; } })()`;
      const detected = await bounded(window.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code }], true), 15000, controller.signal);
      if (!detected?.ok) throw new Error(detected?.error || '网页字段识别失败，请使用点选方式。');
      const config = normalizeConfig({ urls: [url], template: detected.value.template, waitMs, maxPages: 1, maxRows: 100 });
      const result = await capture(window, config, controller.signal);
      const image = await capturePreviewImage(window, controller.signal);
      return { url: result.url, title: result.title, image, fields: detected.value.fields, rows: result.rows, template: detected.value.template };
    } finally {
      previewController = null;
      controller.signal.removeEventListener('abort', cancel);
      if (!window.isDestroyed()) window.destroy();
    }
  });
  handle('preview', async input => {
    if (previewController) throw new Error('预览正在进行，请稍候。');
    if (activeJob) throw new Error('正在采集，请先停止当前任务后再预览。');
    const config = normalizeConfig(input);
    const controller = new AbortController();
    previewController = controller;
    const window = secureBrowser(false, '预览采集 · CrawlFlow');
    const cancel = () => { if (!window.isDestroyed()) window.destroy(); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      await loadPage(window, config.urls[0], config.waitMs, controller.signal);
      const result = await capture(window, { ...config, maxRows: Math.min(config.maxRows, 100) }, controller.signal);
      return { rows: result.rows, title: result.title, url: result.url };
    } finally {
      previewController = null;
      controller.signal.removeEventListener('abort', cancel);
      if (!window.isDestroyed()) window.destroy();
    }
  });
  handle('start', async input => {
    if (activeJob) throw new Error('已有任务正在采集，请先停止当前任务。');
    if (previewController) throw new Error('预览正在进行，请稍候再开始采集。');
    const config = normalizeConfig(input);
    const job = createJob(config);
    activeJob = job;
    setImmediate(() => runJob(job));
    return { id: job.id };
  });
  handle('stop', () => {
    previewController?.abort();
    if (activeJob) { activeJob.controller.abort(); if (activeJob.window && !activeJob.window.isDestroyed()) activeJob.window.destroy(); }
    return true;
  });
  handle('openBrowser', async value => {
    const url = webUrl(typeof value === 'object' ? value.url : value);
    if (!loginWindow || loginWindow.isDestroyed()) { loginWindow = secureBrowser(true, '登录或浏览网页 · CrawlFlow'); loginWindow.on('closed', () => { loginWindow = null; }); }
    loginWindow.show(); loginWindow.focus();
    await loadPage(loginWindow, url, 500);
    return { url: loginWindow.webContents.getURL() };
  });
  handle('pick', async options => {
    const url = webUrl(options?.url);
    if (!['text', 'link', 'image', 'next'].includes(options?.mode)) throw new Error('请选择要点选的内容类型。');
    if (pickerWindow && !pickerWindow.isDestroyed()) throw new Error('请先完成当前网页的点选。');
    const window = secureBrowser(true, '点选网页内容 · CrawlFlow');
    pickerWindow = window;
    const controller = new AbortController();
    window.on('closed', () => { controller.abort(); if (pickerWindow === window) pickerWindow = null; });
    try {
      await loadPage(window, url, 800, controller.signal);
      const result = await bounded(window.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code: `(${pickElement.toString()})(${JSON.stringify(options.mode)})` }], true), 300000, controller.signal, '点选等待时间已结束，请重新点选。');
      if (!result) throw new Error('已取消点选。');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('已取消点选。');
      throw error;
    } finally { if (!window.isDestroyed()) window.destroy(); }
  });
  handle('getHistory', async () => { await historyWrite.catch(() => {}); return history; });
  handle('loadHistory', async id => {
    await historyWrite.catch(() => {});
    const record = history.find(item => item.id === id);
    if (!record) throw new Error('这条历史记录不存在，可能已经被删除。');
    try { const saved = JSON.parse(await fs.readFile(path.join(historyDir(), id + '.json'), 'utf8')); return { ...saved, status: record.status }; }
    catch { throw new Error('历史记录文件无法读取，请重新采集。'); }
  });
  handle('deleteHistory', async id => {
    if (activeJob?.id === id) throw new Error('正在采集的任务不能删除，请先停止任务。');
    if (!history.some(item => item.id === id)) throw new Error('这条历史记录不存在。');
    historyWrite = historyWrite.catch(() => {}).then(async () => {
      history = history.filter(item => item.id !== id);
      await atomicWrite(path.join(historyDir(), 'index.json'), JSON.stringify(history));
      await fs.unlink(path.join(historyDir(), id + '.json')).catch(() => {});
    });
    await historyWrite; return true;
  });
  handle('exportData', async options => {
    const rows = sanitizeRows(options?.rows);
    const format = ['xlsx', 'csv', 'json'].includes(options?.format) ? options.format : 'xlsx';
    const name = String(options?.name || '采集结果').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || '采集结果';
    const result = await dialog.showSaveDialog(mainWindow, { title: '保存采集结果', defaultPath: path.join(app.getPath('downloads'), `${name}.${format}`), filters: [{ name: { xlsx: 'Excel 工作簿', csv: 'CSV 表格', json: 'JSON 数据' }[format], extensions: [format] }] });
    if (result.canceled || !result.filePath) return { canceled: true, path: null };
    let filePath = result.filePath;
    if (!filePath.toLowerCase().endsWith('.' + format)) filePath += '.' + format;
    if (format === 'xlsx') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'CrawlFlow'; workbook.created = new Date();
      const sheet = workbook.addWorksheet('采集结果', { views: [{ state: 'frozen', ySplit: 1 }] });
      const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
      sheet.columns = keys.map(key => ({ header: safeSpreadsheet(key), key, width: /链接|地址|网页/.test(key) ? 50 : /正文|摘要/.test(key) ? 70 : 28 }));
      rows.forEach(row => sheet.addRow(keys.map(key => safeSpreadsheet(row[key]))));
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF286F5A' } };
      sheet.getRow(1).height = 26;
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: keys.length } };
      await workbook.xlsx.writeFile(filePath);
    } else if (format === 'csv') await fs.writeFile(filePath, toCsv(rows), 'utf8');
    else await fs.writeFile(filePath, JSON.stringify(rows, null, 2), 'utf8');
    return { canceled: false, path: filePath };
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({ width: 1500, height: 980, minWidth: 1200, minHeight: 760, show: false, title: 'CrawlFlow', icon: path.join(__dirname, '..', 'build', 'icon.ico'), backgroundColor: '#0c1420', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    quitting = true;
    if (scheduleTimer) clearInterval(scheduleTimer);
    previewController?.abort(); activeJob?.controller.abort();
    for (const window of externalWindows) if (!window.isDestroyed()) window.destroy();
    mainWindow = null;
  });
  appUrl = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).href : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  await mainWindow.loadURL(appUrl);
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  const crawlerSession = session.fromPartition('persist:crawler');
  crawlerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  crawlerSession.setPermissionCheckHandler(() => false);
  crawlerSession.on('will-download', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await initializeHistory();
  await initializeSchedules();
  demo = await startDemoServer();
  registerApi();
  await createMainWindow();
  scheduleTimer = setInterval(() => { void tickSchedules(); }, 1000);
}).catch(error => { dialog.showErrorBox('CrawlFlow 无法启动', friendlyError(error)); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; if (scheduleTimer) clearInterval(scheduleTimer); previewController?.abort(); activeJob?.controller.abort(); demo?.server.close(); });
