import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Clock3, Download, ExternalLink, FileText, FolderOpen, Image, Link2, Loader2, MousePointer2, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Table2, Trash2, Undo2, Upload } from 'lucide-react';

const templates = [
  ['articles', FileText, '文章与标题', '文章标题、正文与来源'],
  ['links', Link2, '网页链接', '链接文字和目标地址'],
  ['images', Image, '图片地址', '原始地址和图片说明'],
  ['tables', Table2, '网页表格', '按网页表格的行列采集'],
  ['custom', MousePointer2, '自定义字段', '在网页中点选需要的内容'],
];
const statusNames = { completed: '已完成', stopped: '已停止', running: '运行中', error: '采集失败', scheduled: '等待执行', paused: '已暂停', missed: '已错过' };
const reserved = new Set(['__proto__', 'prototype', 'constructor', '来源网页']);
const messageOf = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error: /, '');
const localDate = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const hostOf = value => { try { return new URL(value).hostname; } catch { return '尚未填写网址'; } };
function webUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error('请填写完整的 http:// 或 https:// 网址，网址中不能包含账号密码。'); }
}
function readConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('任务包中的采集设置无效。');
  const rawUrls = Array.isArray(input.urls) ? input.urls : [input.url, ...String(input.extraUrls || '').split(/\r?\n/)];
  const urls = [...new Set(rawUrls.filter(value => String(value || '').trim()).map(webUrl))];
  if (!urls.length || urls.length > 100) throw new Error('请设置 1 至 100 个起始网址。');
  if (!templates.some(([id]) => id === input.template)) throw new Error('无法识别这个采集模板。');
  const number = (key, fallback, min, max) => {
    const value = Number(input[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`采集设置 ${key} 超出允许范围。`);
    return Math.round(value);
  };
  const fields = (Array.isArray(input.fields) ? input.fields : []).map(field => {
    const name = String(field?.name || '').trim();
    const selector = String(field?.selector || '').trim();
    if (!name || name.length > 80 || reserved.has(name) || !selector || selector.length > 1000 || !['text', 'link', 'image'].includes(field.type)) throw new Error('任务包包含无效字段，请检查字段名称与规则。');
    return { name, selector, type: field.type, enabled: field.enabled !== false };
  });
  if (fields.length > 30 || new Set(fields.map(field => field.name)).size !== fields.length || (input.template === 'custom' && !fields.length)) throw new Error('自定义字段不能为空或重名，最多设置 30 个。');
  return {
    name: String(input.name || '').trim().slice(0, 100), url: urls[0], extraUrls: urls.slice(1).join('\n'), template: input.template, fields,
    maxPages: number('maxPages', 3, 1, 50), delayMs: number('delayMs', 2000, 1000, 10000), waitMs: number('waitMs', 1500, 500, 15000), maxRows: number('maxRows', 1000, 1, 10000),
    nextSelector: String(input.nextSelector || '').trim().slice(0, 1000), keyword: String(input.keyword || '').trim().slice(0, 100), dedupe: input.dedupe !== false, pagination: input.pagination !== false,
  };
}
function backendConfig(config) {
  const clean = readConfig(config);
  const { url, extraUrls, ...rest } = clean;
  const fields = rest.fields.filter(field => field.enabled !== false);
  if (rest.template === 'custom' && !fields.length) throw new Error('请至少启用一个字段。');
  return { ...rest, fields, maxPages: rest.pagination ? rest.maxPages : 1, urls: [url, ...extraUrls.split('\n').filter(Boolean)] };
}
function SectionTitle({ icon: Icon, title, description, children }) {
  return <div className="panel-head"><div><h2>{Icon && <Icon size={18}/>} {title}</h2>{description && <p className="muted">{description}</p>}</div>{children}</div>;
}
function MiniTable({ rows, limit = 6 }) {
  const keys = useMemo(() => [...new Set(rows.slice(0, 100).flatMap(row => Object.keys(row)))], [rows]);
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>#</th>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map((row, index) => <tr key={index}><td>{index + 1}</td>{keys.map(key => <td key={key} title={String(row[key] ?? '')}>{String(row[key] ?? '')}</td>)}</tr>)}</tbody></table></div>;
}

function NewTask({ config, update, busy, onDemo, onPreview, onStart, onOpen, onPickNext, go }) {
  const locked = !!busy;
  return <div className="split-page">
    <section className="panel page-section"><SectionTitle icon={Link2} title="采集来源" description="填写网页地址，选择需要带回的内容。"><button className="button subtle" disabled={locked} onClick={onDemo}>试用示例</button></SectionTitle>
      <div className="form-grid"><label className="field span-2">任务名称<input maxLength={100} value={config.name} placeholder="例如：每周行业资讯" disabled={locked} onChange={event => update('name', event.target.value)}/></label>
        <label className="field span-2">网页网址<input type="url" value={config.url} placeholder="https://example.com/articles" disabled={locked} onChange={event => update('url', event.target.value)}/></label>
        <div className="row-actions span-2"><button className="button" disabled={locked} onClick={onOpen}><ExternalLink size={15}/>打开网页 / 登录</button><span className="muted">登录完成后，返回这里继续采集。</span></div>
        <label className="field span-2">其他起始网址 <span className="muted">选填，每行一个</span><textarea rows={3} value={config.extraUrls} placeholder="可同时采集多个文章页或列表页" disabled={locked} onChange={event => update('extraUrls', event.target.value)}/></label>
      </div>
      <div className="section-divider"/><SectionTitle icon={MousePointer2} title="采集内容"/>
      <div className="template-options" role="radiogroup" aria-label="采集模板">{templates.map(([id, Icon, name, description]) => <button key={id} className={`template-option ${config.template === id ? 'selected' : ''}`} role="radio" aria-checked={config.template === id} disabled={locked} onClick={() => { if (config.template !== id) update('__replace', { ...config, template: id, fields: [] }); }}><Icon size={20}/><span><strong>{name}</strong><small className="muted">{description}</small></span>{config.template === id && <Check size={16}/>}</button>)}</div>
      {config.template === 'custom' && <div className="list-row"><span className="muted">已添加 {config.fields?.length || 0} 个字段</span><button className="button" onClick={() => go('rules')} disabled={locked}>管理字段规则<ArrowRight size={15}/></button></div>}
      <div className="row-actions section-actions"><button className="button primary" disabled={locked} onClick={onStart}><Play size={15} fill="currentColor"/>开始采集</button><button className="button" disabled={locked} onClick={onPreview}>先测试一页</button></div>
    </section>
    <div className="page-stack"><section className="panel page-section"><SectionTitle icon={Settings2} title="采集设置" description="控制任务的范围与访问节奏。"/>
      <div className="form-grid"><label className="field">最多页数<input type="number" min={1} max={50} value={config.maxPages} disabled={locked} onChange={event => update('maxPages', Number(event.target.value))}/></label><label className="field">最多结果数<input type="number" min={1} max={10000} value={config.maxRows} disabled={locked} onChange={event => update('maxRows', Number(event.target.value))}/></label><label className="field">请求间隔 / 秒<input type="number" min={1} max={10} step={0.5} value={config.delayMs / 1000} disabled={locked} onChange={event => update('delayMs', Number(event.target.value) * 1000)}/></label><label className="field">网页等待 / 秒<input type="number" min={0.5} max={15} step={0.5} value={config.waitMs / 1000} disabled={locked} onChange={event => update('waitMs', Number(event.target.value) * 1000)}/></label><label className="field span-2">只保留包含以下文字的内容<input value={config.keyword} placeholder="留空则采集全部内容" maxLength={100} disabled={locked} onChange={event => update('keyword', event.target.value)}/></label><label className="check-label span-2"><input type="checkbox" checked={config.dedupe} disabled={locked} onChange={event => update('dedupe', event.target.checked)}/>自动去除重复结果</label></div>
      <p className="muted section-note">页数上限包含全部起始网址及自动翻页。网页加载较慢时，可增加等待时间。</p>
    </section><section className="panel page-section"><SectionTitle icon={ArrowRight} title="自动翻页" description={config.nextSelector ? '使用你点选的下一页按钮。' : '默认识别网页中的下一页链接。'}/><div className="row-actions"><button className="button" disabled={locked} onClick={onPickNext}><MousePointer2 size={15}/>{config.nextSelector ? '重新点选下一页' : '点选下一页'}</button>{config.nextSelector && <button className="button subtle" disabled={locked} onClick={() => update('nextSelector', '')}>恢复自动识别</button>}</div>{config.nextSelector && <code className="selector-value">{config.nextSelector}</code>}</section></div>
  </div>;
}

function Cleaning({ rows, setRows, busy, notify, onExport, go }) {
  const [trim, setTrim] = useState(true);
  const [empty, setEmpty] = useState(true);
  const [dedupe, setDedupe] = useState(true);
  const [column, setColumn] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [undo, setUndo] = useState(null);
  const lastApplied = useRef(null);
  useEffect(() => { if (lastApplied.current && rows !== lastApplied.current) { setUndo(null); lastApplied.current = null; } }, [rows]);
  const keys = useMemo(() => [...new Set(rows.flatMap(row => Object.keys(row)))], [rows]);
  const cleaned = useMemo(() => {
    const seen = new Set();
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      let next = typeof value === 'string' && trim ? value.trim() : value;
      if (find && (!column || column === key)) next = String(next ?? '').split(find).join(replace);
      return [key, next];
    }))).filter(row => {
      if (empty && Object.values(row).every(value => String(value ?? '').trim() === '')) return false;
      const signature = JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]));
      if (dedupe && seen.has(signature)) return false;
      seen.add(signature); return true;
    });
  }, [rows, trim, empty, dedupe, column, find, replace]);
  const apply = () => { setUndo(rows); lastApplied.current = cleaned; setRows(cleaned); notify(`清洗已应用，保留 ${cleaned.length} 条数据。原始历史记录不受影响。`, 'success'); };
  return <div className="split-page"><section className="panel page-section"><SectionTitle icon={Settings2} title="清洗规则" description="预览变化，确认后应用到当前结果。"/>
    <div className="page-stack"><label className="check-label"><input type="checkbox" checked={trim} disabled={!!busy} onChange={event => setTrim(event.target.checked)}/>清理文字首尾空格</label><label className="check-label"><input type="checkbox" checked={empty} disabled={!!busy} onChange={event => setEmpty(event.target.checked)}/>移除全部字段为空的行</label><label className="check-label"><input type="checkbox" checked={dedupe} disabled={!!busy} onChange={event => setDedupe(event.target.checked)}/>合并完全重复的行</label></div>
    <div className="section-divider"/><h3>查找与替换</h3><div className="form-grid"><label className="field span-2">应用字段<select aria-label="应用字段" value={column} disabled={!!busy} onChange={event => setColumn(event.target.value)}><option value="">所有字段</option>{keys.map(key => <option key={key}>{key}</option>)}</select></label><label className="field">查找文字<input value={find} disabled={!!busy} placeholder="输入要替换的文字" onChange={event => setFind(event.target.value)}/></label><label className="field">替换为<input value={replace} disabled={!!busy} placeholder="留空则删除匹配文字" onChange={event => setReplace(event.target.value)}/></label></div>
    <div className="row-actions section-actions"><button className="button primary" disabled={!!busy || !rows.length} onClick={apply}><Check size={15}/>应用清洗</button><button className="button" disabled={!!busy || !undo} onClick={() => { setRows(undo); setUndo(null); notify('已还原到上次清洗前的数据。'); }}><Undo2 size={15}/>撤销上次</button></div><p className="muted section-note">修改仅影响当前结果。清洗后的内容请重新导出保存。</p>
    </section><section className="panel page-section"><SectionTitle icon={Table2} title="结果预览" description={`原始 ${rows.length.toLocaleString()} 条 · 清洗后 ${cleaned.length.toLocaleString()} 条`}><button className="button" disabled={!!busy || !cleaned.length} onClick={() => onExport(cleaned, 'xlsx')}><Download size={15}/>导出预览结果</button></SectionTitle>{rows.length ? <><MiniTable rows={cleaned}/><p className="muted section-note">显示前 6 条，导出包含全部清洗结果。</p></> : <div className="empty-state"><Table2 size={36}/><h3>还没有可清洗的数据</h3><p>先采集网页，或从历史记录中载入结果。</p><button className="button" onClick={() => go('history')}>查看历史记录</button></div>}</section></div>;
}

function SchedulePage({ config, api, notify, busy, go }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(config.name || '定时采集');
  const [mode, setMode] = useState('daily');
  const [time, setTime] = useState('09:00');
  const [at, setAt] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const locked = !!busy || saving;
  const refresh = async () => { if (!api?.getSchedules) { setLoading(false); return; } try { setItems(await api.getSchedules()); } catch (error) { notify(messageOf(error), 'error'); } finally { setLoading(false); } };
  useEffect(() => { refresh(); const unsubscribe = api?.onProgress?.(event => { if (event.source === 'schedule' || event.status !== 'running') refresh(); }); return () => unsubscribe?.(); }, [api]);
  const save = async input => {
    if (!api?.saveSchedule) { notify('定时任务需要在 Windows 桌面程序中使用。', 'error'); return; }
    setSaving(true);
    if (input.id) setItems(current => current.map(item => item.id === input.id ? { ...item, enabled: input.enabled } : item));
    try { await api.saveSchedule(input); await refresh(); notify(input.enabled ? '定时任务已保存。到达设定时间后会自动开始。' : '定时任务已暂停。', 'success'); } catch (error) { await refresh(); notify(messageOf(error), 'error'); } finally { setSaving(false); }
  };
  const add = () => { try { if (mode === 'once' && (!at || new Date(at).getTime() <= Date.now())) throw new Error('请选择一个尚未到达的执行时间。'); save({ name: name.trim() || '定时采集', config: backendConfig(config), mode, ...(mode === 'daily' ? { time } : { at }), enabled: true }); } catch (error) { notify(messageOf(error), 'error'); } };
  const remove = async id => { setSaving(true); try { await api.deleteSchedule(id); setDeleteId(null); await refresh(); notify('定时任务已删除。'); } catch (error) { await refresh(); notify(messageOf(error), 'error'); } finally { setSaving(false); } };
  return <div className="split-page"><section className="panel page-section"><SectionTitle icon={Clock3} title="安排执行时间" description="使用当前工作台的采集配置创建任务。"/><div className="list-row"><div><span className="mini-label">当前采集来源</span><strong>{config.name || hostOf(config.url)}</strong><p className="muted">{hostOf(config.url)} · 最多 {config.maxPages} 页</p></div><button className="button subtle" onClick={() => go('new')} disabled={locked}>修改</button></div><div className="form-grid"><label className="field span-2">任务名称<input value={name} maxLength={100} disabled={locked} onChange={event => setName(event.target.value)}/></label><label className="field">重复方式<select value={mode} disabled={locked} onChange={event => setMode(event.target.value)}><option value="daily">每天</option><option value="once">仅一次</option></select></label><label className="field">{mode === 'daily' ? '每日执行时间' : '执行日期与时间'}{mode === 'daily' ? <input type="time" value={time} disabled={locked} onChange={event => setTime(event.target.value)}/> : <input type="datetime-local" value={at} disabled={locked} onChange={event => setAt(event.target.value)}/>}</label></div><div className="section-actions"><button className="button primary" disabled={locked || items.length >= 20} onClick={add}>{saving ? <Loader2 size={15} className="spinning"/> : <Plus size={15}/>}添加定时任务</button></div><p className="muted section-note">按本机时区执行。请保持 CrawlFlow 打开；关闭期间错过的一次性任务不会补跑。其他任务运行时会等待空闲后执行。</p></section>
    <section className="panel page-section"><SectionTitle icon={Clock3} title="任务日程" description={`${items.length} / 20 个任务`}><button className="icon-button" aria-label="刷新定时任务" disabled={locked || loading} onClick={refresh}><RefreshCw size={17}/></button></SectionTitle>{loading ? <div className="empty-state"><Loader2 size={26} className="spinning"/><p>正在读取日程…</p></div> : items.length ? <div className="page-stack">{items.map(item => <article className="schedule-item" key={item.id}><div className="list-row"><div><strong>{item.name}</strong><p className="muted">{item.mode === 'daily' ? `每天 ${item.time}` : localDate(item.at)} · {statusNames[item.status] || (item.enabled ? '等待执行' : '已暂停')}</p></div><label className="check-label"><input type="checkbox" aria-label={`启用${item.name}`} checked={item.enabled} disabled={locked || item.status === 'running'} onChange={event => save({ ...item, enabled: event.target.checked })}/>启用</label></div><div className="list-row"><span className="muted">下次：{localDate(item.nextRunAt)}{item.lastRunAt ? ` · 上次：${localDate(item.lastRunAt)}` : ''}</span><div className="row-actions">{deleteId === item.id ? <><button className="button subtle" disabled={locked} onClick={() => setDeleteId(null)}>取消</button><button className="button danger" disabled={locked} onClick={() => remove(item.id)}>确认删除</button></> : <button className="icon-button" aria-label={`删除定时任务${item.name}`} disabled={locked || item.status === 'running'} onClick={() => setDeleteId(item.id)}><Trash2 size={16}/></button>}</div></div></article>)}</div> : <div className="empty-state"><Clock3 size={36}/><h3>尚未安排任务</h3><p>设置时间后，采集会按计划自动开始。</p></div>}</section></div>;
}

function HistoryPage({ history, loadRecord, deleteRecord, refreshHistory, busy, go }) {
  const [query, setQuery] = useState('');
  const filtered = history.filter(record => `${record.name} ${record.config?.urls?.join(' ') || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel page-section"><SectionTitle icon={FolderOpen} title="最近的采集" description="保存最近 20 个正式任务。预览不进入记录，重要结果请导出。"><div className="row-actions"><label className="search-field"><Search size={16}/><input aria-label="搜索历史记录" value={query} placeholder="搜索任务名称" onChange={event => setQuery(event.target.value)}/></label><button className="icon-button" aria-label="刷新历史记录" disabled={!!busy} onClick={refreshHistory}><RefreshCw size={17}/></button></div></SectionTitle>{filtered.length ? <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>任务名称</th><th>采集时间</th><th>数据量</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map(record => <tr key={record.id}><td><strong>{record.name}</strong><small className="muted">{hostOf(record.config?.urls?.[0])}</small></td><td>{localDate(record.createdAt)}</td><td>{record.rowsCount.toLocaleString()} 条 / {record.pageCount} 页</td><td><span className={`pill ${record.status === 'completed' ? 'success' : record.status === 'error' ? 'error' : ''}`}>{statusNames[record.status] || record.status}</span></td><td><div className="row-actions"><button className="button" disabled={!!busy} onClick={() => loadRecord(record)}>查看结果</button><button className="button subtle" disabled={!!busy} onClick={() => loadRecord(record, true)}>复用设置</button><button className="icon-button" aria-label={`删除记录${record.name}`} disabled={!!busy} onClick={() => deleteRecord(record.id)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><FolderOpen size={38}/><h3>{query ? '没有匹配的任务' : '还没有采集记录'}</h3><p>{query ? '换个关键词试试。' : '完成第一次采集后，可以在这里查看结果或复用设置。'}</p>{!query && <button className="button primary" onClick={() => go('new')}>新建任务<ArrowRight size={15}/></button>}</div>}</section>;
}

function Sharing({ config, update, notify, busy, go }) {
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const download = () => {
    try {
      const clean = readConfig(config);
      const blob = new Blob([JSON.stringify({ format: 'crawlflow-task', version: 1, config: clean }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(clean.name || 'CrawlFlow-任务').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80)}.crawlflow.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify('任务包已交给系统保存。分享这个文件即可复用采集设置。', 'success');
    } catch (error) { notify(messageOf(error), 'error'); }
  };
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setImporting(true);
    try { if (file.size > 1024 * 1024) throw new Error('任务包超过 1 MB，请选择 CrawlFlow 导出的设置文件。'); const pack = JSON.parse(await file.text()); if (pack.format !== 'crawlflow-task' || pack.version !== 1) throw new Error('这不是支持的 CrawlFlow 任务包。'); const imported = readConfig(pack.config); update('__replace', imported); notify(`已导入“${imported.name || '采集任务'}”，可先测试一页确认效果。`, 'success'); go('new'); } catch (error) { notify(error instanceof SyntaxError ? '文件内容不是有效的任务包。' : messageOf(error), 'error'); } finally { setImporting(false); }
  };
  return <div className="split-page"><section className="panel page-section"><SectionTitle icon={Upload} title="分享采集设置" description="把设置保存成任务包，交给同事继续使用。"/><div className="sharing-preview"><FileText size={42}/><h3>{config.name || '未命名采集'}</h3><p className="muted">{hostOf(config.url)}</p><div className="row-actions"><span className="pill">{templates.find(([id]) => id === config.template)?.[2]}</span><span className="pill">最多 {config.maxPages} 页</span></div></div><button className="button primary" disabled={!!busy} onClick={download}><Download size={16}/>导出任务包</button><p className="muted section-note">任务包包含网址、字段与采集设置，不包含采集结果和浏览器登录状态。</p></section>
    <section className="panel page-section"><SectionTitle icon={Download} title="导入任务包" description="使用已有规则，省去重复配置。"/><button className="import-dropzone" disabled={!!busy || importing} onClick={() => fileRef.current?.click()}><Upload size={32}/><strong>{importing ? '正在读取任务包…' : '选择任务包文件'}</strong><span className="muted">.crawlflow.json · 最大 1 MB</span></button><input ref={fileRef} type="file" accept=".json,application/json" aria-label="导入任务包文件" hidden onChange={importFile}/><div className="section-divider"/><div className="list-row"><ShieldCheck size={22}/><p className="muted">导入后可检查和修改设置，不会立即开始采集。需要登录的网站，请先使用你自己的账号登录。</p></div><button className="button subtle" onClick={() => go('guide')}><BookOpen size={16}/>查看使用指南</button></section></div>;
}

function SettingsPage({ config, update, busy, info, go }) {
  return <div className="split-page"><section className="panel page-section"><SectionTitle icon={Settings2} title="采集偏好" description="调整当前任务的默认行为，修改后自动保存。"/><div className="form-grid"><label className="field">请求间隔 / 秒<input type="number" min={1} max={10} step={0.5} value={config.delayMs / 1000} disabled={!!busy} onChange={event => update('delayMs', Number(event.target.value) * 1000)}/></label><label className="field">网页等待 / 秒<input type="number" min={0.5} max={15} step={0.5} value={config.waitMs / 1000} disabled={!!busy} onChange={event => update('waitMs', Number(event.target.value) * 1000)}/></label><label className="field">最多采集页数<input type="number" min={1} max={50} value={config.maxPages} disabled={!!busy} onChange={event => update('maxPages', Number(event.target.value))}/></label><label className="field">最多结果数<input type="number" min={1} max={10000} value={config.maxRows} disabled={!!busy} onChange={event => update('maxRows', Number(event.target.value))}/></label><label className="check-label span-2"><input type="checkbox" checked={config.dedupe} disabled={!!busy} onChange={event => update('dedupe', event.target.checked)}/>采集时自动去重</label></div></section><section className="panel page-section"><SectionTitle icon={ShieldCheck} title="本地工作区"/><div className="list-row"><span className="muted">应用版本</span><strong>CrawlFlow {info?.version || '1.1.0'}</strong></div><div className="list-row"><span className="muted">历史记录</span><strong>最近 20 个正式任务</strong></div><div className="list-row"><span className="muted">导出格式</span><strong>Excel / CSV / JSON</strong></div><p className="muted section-note">采集结果与任务设置保存在本机。网页登录状态由独立浏览器保存；导出的任务包不会携带登录状态。</p><div className="row-actions section-actions"><button className="button" onClick={() => go('history')}><FolderOpen size={16}/>管理记录</button><button className="button subtle" onClick={() => go('guide')}><BookOpen size={16}/>使用指南</button></div></section></div>;
}

function GuidePage({ onDemo, busy, go }) {
  const steps = [['01', '填写网页地址', '粘贴文章、列表页或表格所在的网址。多个起始网址可以一起采集。', 'new', '设置来源'], ['02', '选择采集内容', '使用文章、链接、图片或表格模板；需要特定字段时，在网页中直接点选。', 'rules', '设置字段'], ['03', '测试后开始', '先测试一页，确认结果对应正确。设置页数上限后开始采集。', 'dashboard', '返回工作台'], ['04', '整理并导出', '在数据清洗中去除重复行、清理空格，随后导出为 Excel、CSV 或 JSON。', 'clean', '整理数据']];
  return <div className="page-stack"><section className="panel page-section"><SectionTitle icon={BookOpen} title="从一个网页开始" description="设置来源、确认内容、开始采集。"><button className="button primary" onClick={onDemo} disabled={!!busy}><Play size={15}/>试用本地示例</button></SectionTitle><div className="guide-grid">{steps.map(([number, title, text, view, action]) => <article className="guide-step" key={number}><span className="guide-number">{number}</span><h3>{title}</h3><p className="muted">{text}</p><button className="button subtle" onClick={() => go(view)}>{action}<ArrowRight size={14}/></button></article>)}</div></section><div className="split-page"><section className="panel page-section"><SectionTitle icon={ExternalLink} title="需要登录的网站"/><p>点击“打开网页 / 登录”，在网页窗口完成登录，再返回 CrawlFlow。后续预览与采集会使用同一个登录状态。</p><p className="muted">验证码与网站授权需由你在网页中完成。采集只能读取当前账号可见的内容。</p></section><section className="panel page-section"><SectionTitle icon={MousePointer2} title="字段与翻页"/><p>点选多个字段时，请选择同一条记录中的内容，例如同一张商品卡片的标题与价格。</p><p className="muted">自动翻页没有找到“下一页”时，可以手动点选该按钮。遇到动态加载的网页，适当增加网页等待时间。</p></section></div></div>;
}

export default function WorkspacePages(props) {
  switch (props.view) {
    case 'new': return <NewTask {...props}/>;
    case 'clean': return <Cleaning {...props}/>;
    case 'schedules': return <SchedulePage {...props}/>;
    case 'history': return <HistoryPage {...props}/>;
    case 'team': return <Sharing {...props}/>;
    case 'settings': return <SettingsPage {...props}/>;
    case 'guide': return <GuidePage {...props}/>;
    default: return null;
  }
}
