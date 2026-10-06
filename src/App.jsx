import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home,
  SquarePlus,
  ScanLine,
  PanelsTopLeft,
  Brush,
  Clock3,
  History,
  Users,
  Settings,
  Search,
  Bell,
  Play,
  Square,
  ChevronDown,
  HelpCircle,
  ArrowUpRight,
  X,
  Loader2,
  Check,
  Globe2,
  Plus,
  MousePointer2,
  FileText,
  Link2,
  Image,
  Table2,
  ExternalLink,
  FolderOpen,
  SlidersHorizontal,
  Save,
} from "lucide-react";
import WorkspacePages from "./WorkspacePages";
import {
  WebsitePanel,
  RulesPanel,
  PaginationPanel,
  AutomationPanel,
  Statistics,
  LogPanel,
  DataPreview,
} from "./Workbench";
import AdvancedSettings from "./features/advanced/AdvancedSettings";
import { advancedDefaults, readAdvanced } from "./features/advanced/config";
import FileLibrary from "./features/library/FileLibrary";
import SlidingSelection from "./shared/SlidingSelection";
import Dialog from "./shared/Dialog";

const defaults = {
  url: "",
  extraUrls: "",
  name: "",
  template: "articles",
  fields: [],
  maxPages: 3,
  delayMs: 2000,
  waitMs: 1500,
  nextSelector: "",
  keyword: "",
  dedupe: true,
  maxRows: 1000,
  pagination: true,
  advanced: advancedDefaults,
};
const navigation = [
  ["dashboard", Home, "仪表盘"],
  ["new", SquarePlus, "新建任务"],
  ["rules", ScanLine, "采集规则"],
  ["website", PanelsTopLeft, "网站预览"],
  ["library", FolderOpen, "文件库"],
  ["clean", Brush, "数据清洗"],
  ["advanced", SlidersHorizontal, "高级模式"],
  ["schedules", Clock3, "定时任务"],
  ["history", History, "历史记录"],
  ["team", Users, "任务共享"],
  ["settings", Settings, "设置"],
];
const navItems = navigation.map(([id, Icon, label]) => ({ id, Icon, label }));
const modeItems = [
  { id: "simple", label: "标准模式" },
  { id: "advanced", label: "高级模式" },
];
const subtitles = {
  dashboard: "预览网页，选择内容，再决定保存什么",
  new: "从一个网址开始，设置你需要的内容",
  rules: "点选网页元素，将需要的内容整理为字段",
  website: "查看真实网页，登录网站或点选需要的内容",
  library: "查看、修改和整理你主动保存的采集文件",
  advanced: "调整协议、编码、加载和请求参数",
  clean: "整理采集结果，让数据可以直接使用",
  schedules: "按本机时间执行，完成后预览并选择保存",
  history: "查看任务记录，复用采集设置",
  team: "把采集规则打包，交给下一位使用者",
  settings: "按你的习惯设置采集方式",
  guide: "从打开网页到保存数据，一步一步完成",
};
function initialConfig() {
  try {
    return {
      ...defaults,
      ...JSON.parse(
        localStorage.getItem("crawlflow-config-v1") ||
          localStorage.getItem("qingcaiji-config-v1") ||
          "{}",
      ),
    };
  } catch {
    return { ...defaults };
  }
}
const messageOf = (error) =>
  String(error?.message || error)
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    .replace(/^Error: /, "");

export default function App() {
  const api = window.collector;
  const [view, setView] = useState("dashboard");
  const [config, setConfig] = useState(initialConfig);
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [site, setSite] = useState(null);
  const [progress, setProgress] = useState({
    status: "idle",
    page: 0,
    message: "准备就绪",
  });
  const [logs, setLogs] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [modal, setModal] = useState(null);
  const [fieldDraft, setFieldDraft] = useState({
    name: "",
    type: "text",
    selector: "",
  });
  const [query, setQuery] = useState("");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [quickSchedule, setQuickSchedule] = useState("now");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [draftDirty, setDraftDirty] = useState(false);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [savedResultId, setSavedResultId] = useState(null);
  const [resultConfig, setResultConfig] = useState(null);
  const [saveDialog, setSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const pendingAction = useRef(null);
  const libraryGuard = useRef(null);
  const registerGuard = useCallback((guard) => {
    libraryGuard.current = guard;
  }, []);
  const startedAt = useRef(0);
  const initialized = useRef(false);
  const busyRef = useRef("");
  const locked = Boolean(busy);
  const running = busy === "running" || busy === "start";
  const update = (key, value) =>
    setConfig((current) =>
      key === "__replace"
        ? { ...defaults, ...value }
        : { ...current, [key]: value },
    );
  const notify = (text, type = "info") => setNotice({ text, type });
  const log = (message, status = "info", detail = "") =>
    setLogs((current) =>
      [
        ...current,
        {
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          message,
          status,
          detail,
        },
      ].slice(-100),
    );
  const guardLibrary = (callback) =>
    libraryGuard.current ? libraryGuard.current(callback) : callback();
  const go = (id) => {
    if (id === view) return;
    guardLibrary(() => {
      setView(id);
      setModal(null);
    });
  };
  const refreshHistory = async () => {
    if (api) setHistory(await api.getHistory());
  };

  function replaceDraft(callback) {
    guardLibrary(() => {
      if (draftDirty) {
        pendingAction.current = callback;
        setDiscardDialog(true);
      } else callback();
    });
  }
  function markRows(value) {
    setRows(value);
    setDraftDirty(true);
    setSavedResultId(null);
  }
  function openSave(after = null) {
    pendingAction.current = after;
    setSaveName(config.name || "采集结果");
    setSaveDialog(true);
    setModal(null);
  }
  async function saveCurrent() {
    if (!saveName.trim()) {
      notify("请填写文件名称。", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveResult({
        name: saveName.trim(),
        rows,
        config: resultConfig || settings(),
        jobId: progress.id,
      });
      setSavedResultId(saved.id);
      setDraftDirty(false);
      setSaveDialog(false);
      setLibraryRevision((v) => v + 1);
      await api.setUnsavedChanges(libraryDirty);
      await refreshHistory();
      notify(`“${saved.name}”已保存到文件库。`, "success");
      const next = pendingAction.current;
      pendingAction.current = null;
      if (next) next();
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setSaving(false);
    }
  }
  function loadLibraryFile(document) {
    replaceDraft(() => {
      if (document.config) {
        const { urls = [], ...value } = document.config;
        setConfig({
          ...defaults,
          ...value,
          url: urls[0] || "",
          extraUrls: urls.slice(1).join("\n"),
        });
      }
      setRows(document.rows);
      setResultConfig(document.config);
      setDraftDirty(false);
      setSavedResultId(document.id);
      setSite(null);
      setProgress({
        status: "saved",
        page: 0,
        message: `已打开文件 · ${document.name}`,
      });
      setView("dashboard");
    });
  }

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    if (!api) {
      notify("当前是界面预览。采集功能请在 CrawlFlow Windows 程序中使用。");
      return;
    }
    if (!initialized.current) {
      initialized.current = true;
      api
        .getAppInfo()
        .then((value) => {
          setInfo(value);
          if (
            !config.url ||
            (config.name === "城市观察 · 示例采集" &&
              /^http:\/\/127\.0\.0\.1:\d+/.test(config.url))
          ) {
            const demo = {
              ...defaults,
              ...config,
              url: value.demoUrl,
              name: "城市观察 · 示例采集",
            };
            setConfig(demo);
            inspectSite(demo, true);
          }
        })
        .catch((e) => notify(messageOf(e), "error"));
      refreshHistory().catch((e) => notify(messageOf(e), "error"));
    }
    return api.onProgress((event) => {
      if (event.status === "running" && !startedAt.current)
        startedAt.current = Date.now();
      setRows(event.rows || []);
      setResultConfig(event.config);
      setProgress(event);
      setDraftDirty(Boolean(event.rows?.length));
      setSavedResultId(null);
      log(
        event.message,
        event.status,
        event.source === "schedule"
          ? `定时任务 · ${event.name}`
          : `已采集 ${event.rows?.length || 0} 条 · ${event.page || 0} 页`,
      );
      if (event.status === "running") setBusy("running");
      else {
        setBusy("");
        if (startedAt.current) setElapsed(Date.now() - startedAt.current);
        startedAt.current = 0;
        notify(event.message, event.status === "error" ? "error" : "success");
        refreshHistory().catch(() => {});
      }
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("crawlflow-config-v1", JSON.stringify(config));
    } catch {}
  }, [config]);
  useEffect(() => {
    api?.setUnsavedChanges(draftDirty || libraryDirty).catch(() => {});
  }, [api, draftDirty, libraryDirty]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setElapsed(startedAt.current ? Date.now() - startedAt.current : 0),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!notice || notice.type === "error") return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal("search");
      }
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const prev = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const first = dialog?.querySelector("input,button,select");
    first?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const controls = [
        ...dialog.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
        ),
      ];
      if (!controls.length) return;
      if (e.shiftKey && document.activeElement === controls[0]) {
        e.preventDefault();
        controls.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
        e.preventDefault();
        controls[0].focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      prev?.focus();
    };
  }, [modal]);

  function targetUrl(value = config.url) {
    try {
      const url = new URL(value.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error();
      return url.href;
    } catch {
      throw new Error("请填写以 http:// 或 https:// 开头的完整网页地址。");
    }
  }
  function settings(value = config) {
    const url = targetUrl(value.url);
    const fields = (value.fields || []).filter((f) => f.enabled !== false);
    if (value.template === "custom" && !fields.length)
      throw new Error("请至少启用一个字段。");
    return {
      ...value,
      fields,
      urls: [
        url,
        ...value.extraUrls
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      ],
      maxPages: value.pagination === false ? 1 : value.maxPages,
      name: value.name.trim() || `采集 · ${new URL(url).hostname}`,
    };
  }
  async function action(type, callback) {
    if (!api) {
      notify("请在 CrawlFlow Windows 程序中使用此功能。", "error");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = type;
    setBusy(type);
    setNotice(null);
    try {
      await callback();
    } catch (e) {
      const msg = messageOf(e);
      notify(msg, /取消|停止/.test(msg) ? "info" : "error");
      log(msg, "error");
      if (type === "start") {
        setProgress((p) => ({ ...p, status: "error", message: msg }));
        startedAt.current = 0;
      }
      setBusy("");
      busyRef.current = "";
    } finally {
      if (type !== "start") {
        setBusy("");
        busyRef.current = "";
      }
    }
  }
  function inspectSite(value = config, demo = false) {
    const inspect = () =>
      action("inspect", async () => {
        const result = await api.inspect({
          url: targetUrl(value.url),
          waitMs: value.waitMs,
          template: value.template === "custom" ? "auto" : value.template,
          advanced: readAdvanced(value.advanced),
        });
        setSite({ ...result, isDemo: demo || result.url === info?.demoUrl });
        setRows(result.rows || []);
        setResultConfig(
          settings({
            ...value,
            fields: result.fields || [],
            template: result.template || value.template,
          }),
        );
        setDraftDirty(!demo && Boolean(result.rows?.length));
        setSavedResultId(null);
        setConfig((c) => ({
          ...c,
          fields: result.fields || [],
          template: result.template || "articles",
        }));
        setProgress({
          status: "preview",
          page: 1,
          message: `预览完成 · ${result.rows?.length || 0} 条`,
        });
        log("网页预览已更新", "completed", result.title);
        if (!demo)
          notify(
            `已识别 ${result.fields?.length || 0} 个字段，请测试规则确认内容。`,
            "success",
          );
      });
    return demo ? inspect() : replaceDraft(inspect);
  }
  function useDemo() {
    if (locked) return;
    if (!info?.demoUrl) {
      notify("示例正在准备，请稍后重试。");
      return;
    }
    replaceDraft(() => {
      const demo = {
        ...defaults,
        url: info.demoUrl,
        name: "城市观察 · 示例采集",
      };
      setDraftDirty(false);
      setConfig(demo);
      setView("dashboard");
      setSite(null);
      inspectSite(demo, true);
    });
  }
  function preview() {
    replaceDraft(() =>
      action("preview", async () => {
        const result = await api.preview(settings());
        setRows(result.rows);
        setResultConfig(settings());
        setDraftDirty(Boolean(result.rows.length));
        setSavedResultId(null);
        setProgress({
          status: "preview",
          page: 1,
          message: `规则测试完成 · ${result.rows.length} 条`,
        });
        log(
          "规则测试完成",
          "completed",
          `当前页面匹配 ${result.rows.length} 条数据`,
        );
        notify(
          result.rows.length
            ? `规则测试完成，匹配 ${result.rows.length} 条数据。`
            : "没有匹配到内容，请调整模板或重新点选字段。",
          result.rows.length ? "success" : "info",
        );
      }),
    );
  }
  function start() {
    if (quickSchedule === "daily") {
      action("schedule", async () => {
        await api.saveSchedule({
          name: config.name || "每日采集",
          config: settings(),
          mode: "daily",
          time: scheduleTime,
          enabled: true,
        });
        notify(
          `已保存每天 ${scheduleTime} 执行的任务。请保持应用打开。`,
          "success",
        );
        setView("schedules");
      });
      return;
    }
    replaceDraft(() =>
      action("start", async () => {
        const value = settings();
        setRows([]);
        setDraftDirty(false);
        setSavedResultId(null);
        setElapsed(0);
        startedAt.current = Date.now();
        setProgress({ status: "running", page: 0, message: "正在准备采集" });
        setView("dashboard");
        await api.start(value);
      }),
    );
  }
  async function stop() {
    try {
      await api.stop();
      notify("正在停止，已采集的数据会保留。");
    } catch (e) {
      notify(messageOf(e), "error");
    }
  }
  function openWebsite() {
    action("open", async () => {
      await api.openBrowser({ url: targetUrl(), advanced: config.advanced });
      notify("已打开网页窗口。可以浏览或登录，完成后返回 CrawlFlow。");
    });
  }
  function pickNext() {
    action("pick", async () => {
      const result = await api.pick({
        url: targetUrl(),
        mode: "next",
        advanced: config.advanced,
      });
      update("nextSelector", result.selector);
      notify("已设置下一页按钮。", "success");
    });
  }
  function pickField() {
    action("pick", async () => {
      if (!fieldDraft.name.trim()) throw new Error("请给字段起个名字。");
      if (config.fields.some((f) => f.name === fieldDraft.name.trim()))
        throw new Error("字段名称已存在。");
      const selected = await api.pick({
        url: targetUrl(),
        mode: fieldDraft.type,
        advanced: config.advanced,
      });
      setConfig((c) => ({
        ...c,
        template: "custom",
        fields: [
          ...c.fields,
          {
            ...fieldDraft,
            name: fieldDraft.name.trim(),
            selector: selected.selector,
            enabled: true,
          },
        ],
      }));
      setModal(null);
      notify(
        `已添加“${fieldDraft.name}”，匹配 ${selected.count} 个元素。`,
        "success",
      );
    });
  }
  function saveField() {
    if (!fieldDraft.name.trim() || !fieldDraft.selector.trim()) {
      notify("请填写字段名称和网页规则。", "error");
      return;
    }
    if (
      config.fields.some(
        (f, i) => i !== fieldDraft.index && f.name === fieldDraft.name.trim(),
      )
    ) {
      notify("字段名称已存在。", "error");
      return;
    }
    const value = {
      name: fieldDraft.name.trim(),
      type: fieldDraft.type,
      selector: fieldDraft.selector.trim(),
      enabled: fieldDraft.enabled !== false,
    };
    setConfig((c) => ({
      ...c,
      template: "custom",
      fields:
        fieldDraft.index == null
          ? [...c.fields, value]
          : c.fields.map((f, i) => (i === fieldDraft.index ? value : f)),
    }));
    setModal(null);
  }
  function changeField(index, enabled) {
    setConfig((c) => ({
      ...c,
      template: "custom",
      fields: c.fields.map((f, i) => (i === index ? { ...f, enabled } : f)),
    }));
  }
  function editField(field, index) {
    setFieldDraft({ ...field, index });
    setModal("field");
  }
  function addField() {
    setFieldDraft({ name: "", type: "text", selector: "" });
    setModal("field");
  }
  function exportRows(data, format = exportFormat) {
    action("export", async () => {
      const result = await api.exportData({
        rows: data,
        format,
        name: config.name || "CrawlFlow采集结果",
      });
      if (!result.canceled) {
        if (data.length === rows.length) {
          setDraftDirty(false);
          setSavedResultId("exported");
        }
        notify(`已导出到 ${result.path}`, "success");
        log("数据导出成功", "completed", result.path);
      }
    });
  }
  function loadRecord(record, onlySettings = false) {
    replaceDraft(() =>
      action("history", async () => {
        const saved = onlySettings ? record : await api.loadHistory(record.id);
        const { urls = [], ...value } = saved.config;
        setConfig({
          ...defaults,
          ...value,
          url: urls[0] || "",
          extraUrls: urls.slice(1).join("\n"),
        });
        setRows(onlySettings ? [] : saved.rows);
        setResultConfig(saved.config);
        setDraftDirty(
          !onlySettings && !saved.savedFileId && Boolean(saved.rows?.length),
        );
        setSavedResultId(onlySettings ? null : saved.savedFileId || null);
        setSite(null);
        setView("dashboard");
        setProgress({
          id: record.id,
          status: onlySettings ? "idle" : saved.status,
          page: saved.pageCount,
          message: onlySettings
            ? "已复用任务设置"
            : `历史数据 · ${saved.rowsCount} 条`,
        });
        notify(
          onlySettings
            ? "采集设置已填入。"
            : "已载入历史结果，可以查看或导出。",
        );
      }),
    );
  }
  function deleteRecord(id) {
    setModal({ type: "delete", id });
  }
  const websiteProps = {
    config,
    update,
    site,
    busy,
    onInspect: () => inspectSite(),
    onOpen: openWebsite,
    onPreview: preview,
    onDemo: useDemo,
  };
  const ruleProps = {
    config,
    busy,
    onAdd: addField,
    onToggle: changeField,
    onEdit: editField,
    onRemove: (index) =>
      setConfig((c) => ({
        ...c,
        template: "custom",
        fields: c.fields.filter((_, i) => i !== index),
      })),
    onInspect: () => inspectSite(),
  };
  const title =
    view === "dashboard"
      ? "可视化采集工作台"
      : view === "guide"
        ? "使用指南"
        : navigation.find((n) => n[0] === view)?.[2];
  const searchItems = [
    ...navigation.map(([id, Icon, label]) => ({
      id,
      Icon,
      label,
      description: subtitles[id],
    })),
    {
      id: "guide",
      Icon: HelpCircle,
      label: "使用指南",
      description: "登录、点选、翻页与导出",
    },
    ...history.map((h) => ({
      id: h.id,
      Icon: History,
      label: h.name,
      description: `历史记录 · ${h.rowsCount} 条`,
      record: h,
    })),
  ].filter((item) =>
    `${item.label} ${item.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => go("dashboard")}
          aria-label="CrawlFlow 仪表盘"
        >
          <img src="./crawlflow-logo.png" alt="" />
          <span>
            <strong>
              Crawl<span>Flow</span>
            </strong>
            <small>让数据触手可及</small>
          </span>
        </button>
        <SlidingSelection
          value={view}
          items={navItems}
          onChange={go}
          vertical
          className="sidebar-navigation"
          label="主导航"
        />
        <div className="sidebar-bottom">
          <div className="workspace-emblem">
            <Globe2 size={23} />
          </div>
          <strong>你的采集工作区</strong>
          <p>网页内容，井然有序。</p>
          <button
            className="button sidebar-demo"
            disabled={locked}
            onClick={useDemo}
          >
            打开练习示例
            <ArrowUpRight size={16} />
          </button>
          <button className="sidebar-help" onClick={() => go("guide")}>
            <HelpCircle size={15} />
            使用指南<span>v{info?.version || "1.2.0"}</span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div className="page-heading">
            <h1>{title}</h1>
            <p>{subtitles[view]}</p>
          </div>
          <div className="header-tools">
            <button
              className="search-trigger"
              onClick={() => {
                setQuery("");
                setModal("search");
              }}
            >
              <Search size={16} />
              <span>搜索任务、功能或帮助文档…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="icon-button notification-button"
              aria-label="查看运行日志"
              onClick={() => setModal("logs")}
            >
              <Bell size={21} />
              {logs.some((l) => l.status === "error") && <i />}
            </button>
            <button
              className="profile"
              onClick={() => go("settings")}
              aria-label="本地工作区设置"
            >
              <span className="avatar">CF</span>
              <span>
                <strong>本地工作区</strong>
                <small>数据保存在本机</small>
              </span>
              <ChevronDown size={13} />
            </button>
            {running ? (
              <button className="button primary start-button" onClick={stop}>
                <Square size={14} fill="currentColor" />
                停止采集
              </button>
            ) : (
              <button
                className="button primary start-button"
                disabled={locked}
                onClick={start}
              >
                {locked ? (
                  <Loader2 className="spinning" size={16} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {quickSchedule === "daily" ? "保存定时" : "开始采集"}
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div
            className={`notice notice-${notice.type}`}
            role={notice.type === "error" ? "alert" : "status"}
          >
            {notice.type === "success" ? (
              <Check size={16} />
            ) : (
              <span className="notice-dot" />
            )}
            <span>{notice.text}</span>
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="workspace-toolbar">
          <SlidingSelection
            value={config.advanced?.enabled ? "advanced" : "simple"}
            items={modeItems}
            label="采集模式快捷切换"
            disabled={locked}
            onChange={(value) => {
              update("advanced", {
                ...readAdvanced(config.advanced),
                enabled: value === "advanced",
              });
              if (value === "advanced") go("advanced");
            }}
          />
          <span className="storage-note">
            <FolderOpen size={14} />
            <span title={info?.dataDir}>
              {info?.dataDir || "CrawlFlow / Data"}
            </span>
          </span>
          <button className="text-button" onClick={() => go("library")}>
            打开文件库
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className={"page-stage page-" + view} key={view}>
          {view === "dashboard" && (
            <div className="dashboard">
              <div className="top-grid">
                <WebsitePanel {...websiteProps} />
                <div className="configuration-stack">
                  <RulesPanel {...ruleProps} />
                  <div className="control-grid">
                    <PaginationPanel
                      config={config}
                      update={update}
                      busy={busy}
                      onPick={pickNext}
                    />
                    <AutomationPanel
                      mode={quickSchedule}
                      setMode={setQuickSchedule}
                      time={scheduleTime}
                      setTime={setScheduleTime}
                      busy={busy}
                      go={go}
                    />
                  </div>
                </div>
              </div>
              <div className="bottom-grid">
                <div className="data-stack">
                  <Statistics
                    history={history}
                    progress={progress}
                    running={running}
                    elapsed={elapsed}
                  />
                  <DataPreview
                    rows={rows}
                    busy={busy}
                    onExport={exportRows}
                    onClean={() => go("clean")}
                    onExpand={() => setModal("data")}
                    onSave={() => openSave()}
                    saved={Boolean(savedResultId)}
                    format={exportFormat}
                    setFormat={setExportFormat}
                    progress={progress}
                  />
                </div>
                <LogPanel
                  logs={logs}
                  running={running}
                  elapsed={elapsed}
                  onClear={() => setLogs([])}
                />
              </div>
            </div>
          )}
          {view === "website" && (
            <div className="website-page">
              <WebsitePanel {...websiteProps} expanded />
              <div className="website-actions panel">
                <div>
                  <h2>在网页里直接选择内容</h2>
                  <p className="muted">
                    打开网页窗口，登录后继续采集；也可以点选标题、图片或下一页按钮。
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="button"
                    disabled={locked}
                    onClick={openWebsite}
                  >
                    <ExternalLink size={15} />
                    打开网页 / 登录
                  </button>
                  <button
                    className="button primary"
                    disabled={locked}
                    onClick={addField}
                  >
                    <MousePointer2 size={15} />
                    点选采集内容
                  </button>
                </div>
              </div>
            </div>
          )}
          {view === "rules" && (
            <div className="rules-page">
              <div className="panel page-section">
                <div className="panel-head">
                  <div>
                    <h2>采集内容</h2>
                    <p className="muted">
                      选择常用内容，或在网页里点选自己的字段。
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={locked}
                    onClick={preview}
                  >
                    <ScanLine size={15} />
                    测试规则
                  </button>
                </div>
                <div className="template-options">
                  {[
                    [
                      "articles",
                      FileText,
                      "文章与标题",
                      "标题、链接、摘要和正文",
                    ],
                    ["links", Link2, "网页链接", "链接文字与目标地址"],
                    ["images", Image, "图片地址", "图片说明与原始地址"],
                    ["tables", Table2, "网页表格", "保留表格的行与列"],
                  ].map(([id, Icon, label, desc]) => (
                    <button
                      key={id}
                      className={`template-option ${config.template === id ? "selected" : ""}`}
                      disabled={locked}
                      onClick={() =>
                        setConfig((c) => ({ ...c, template: id, fields: [] }))
                      }
                    >
                      <Icon size={25} />
                      <strong>{label}</strong>
                      <small>{desc}</small>
                      {config.template === id && (
                        <Check className="option-check" size={16} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <RulesPanel {...ruleProps} expanded />
              <div className="rules-footer">
                <PaginationPanel
                  config={config}
                  update={update}
                  busy={busy}
                  onPick={pickNext}
                />
                <section className="panel page-section">
                  <h2>点一下，选出你想要的内容</h2>
                  <p className="muted">
                    添加字段后，在网页窗口点击目标元素。相同结构的内容会一起被选中，先测试一页即可确认结果。
                  </p>
                  <button
                    className="button primary"
                    disabled={locked}
                    onClick={addField}
                  >
                    <Plus size={16} />
                    添加自定义字段
                  </button>
                </section>
              </div>
            </div>
          )}
          {view === "advanced" && (
            <AdvancedSettings {...{ config, update, busy, notify }} />
          )}
          {view === "library" && (
            <FileLibrary
              {...{ api, info, notify, busy, registerGuard }}
              onDirtyChange={setLibraryDirty}
              onUse={loadLibraryFile}
              refreshToken={libraryRevision}
            />
          )}
          {!["dashboard", "website", "rules", "advanced", "library"].includes(
            view,
          ) && (
            <WorkspacePages
              {...{
                view,
                config,
                update,
                rows,
                history,
                loadRecord,
                deleteRecord,
                refreshHistory,
                api,
                notify,
                busy,
                info,
                go,
              }}
              setRows={markRows}
              onDemo={useDemo}
              onPreview={preview}
              onStart={start}
              onOpen={openWebsite}
              onPickNext={pickNext}
              onExport={exportRows}
            />
          )}
        </div>
        <footer className="status-bar">
          <span>
            <i className={running ? "working" : ""} />
            {busy === "inspect"
              ? "正在读取网页…"
              : busy === "pick"
                ? "请在网页中点选，按 Esc 取消"
                : progress.message}
          </span>
          <span>
            {draftDirty
              ? "结果尚未保存"
              : savedResultId
                ? "结果已保存"
                : "预览后选择保存"}
            <span className="status-separator">·</span>CrawlFlow 1.2
          </span>
        </footer>
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "data" ? "modal-wide" : ""} ${modal === "search" ? "command-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "field"
                ? "编辑字段"
                : modal === "search"
                  ? "搜索任务和功能"
                  : modal === "data"
                    ? "全部采集数据"
                    : modal === "logs"
                      ? "运行日志"
                      : "删除采集记录"
            }
          >
            <button
              className="icon-button modal-close"
              aria-label="关闭窗口"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "field" && (
              <>
                <div className="modal-title">
                  <span className="modal-symbol">
                    <ScanLine size={23} />
                  </span>
                  <h2>
                    {fieldDraft.index == null ? "添加采集字段" : "编辑采集字段"}
                  </h2>
                  <p>为内容起个名字，再去网页点选。</p>
                </div>
                <label className="field">
                  字段名称
                  <input
                    value={fieldDraft.name}
                    maxLength={80}
                    onChange={(e) =>
                      setFieldDraft((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="例如：文章标题"
                  />
                </label>
                <label className="field">
                  内容类型
                  <select
                    value={fieldDraft.type}
                    onChange={(e) =>
                      setFieldDraft((f) => ({ ...f, type: e.target.value }))
                    }
                  >
                    <option value="text">文字内容</option>
                    <option value="link">链接地址</option>
                    <option value="image">图片地址</option>
                  </select>
                </label>
                <details open={fieldDraft.index != null || undefined}>
                  <summary>已有网页规则</summary>
                  <label className="field">
                    CSS 选择器
                    <input
                      value={fieldDraft.selector}
                      placeholder="例如：.article-title"
                      onChange={(e) =>
                        setFieldDraft((f) => ({
                          ...f,
                          selector: e.target.value,
                        }))
                      }
                    />
                  </label>
                </details>
                <div className="modal-actions">
                  <button
                    className="button"
                    disabled={locked}
                    onClick={saveField}
                  >
                    保存规则
                  </button>
                  {fieldDraft.index == null && (
                    <button
                      className="button primary"
                      disabled={locked}
                      onClick={pickField}
                    >
                      {busy === "pick" ? (
                        <Loader2 size={15} className="spinning" />
                      ) : (
                        <MousePointer2 size={15} />
                      )}
                      去网页点选
                    </button>
                  )}
                </div>
                {busy === "pick" && (
                  <p className="muted">
                    请在打开的网页窗口点击目标内容，按 Esc 可以取消。
                  </p>
                )}
              </>
            )}
            {modal === "search" && (
              <>
                <div className="command-input">
                  <Search size={22} />
                  <input
                    aria-label="搜索任务和功能"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索任务、功能或帮助…"
                  />
                </div>
                <div className="command-results">
                  {searchItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.record) {
                          setModal(null);
                          loadRecord(item.record);
                        } else go(item.id);
                      }}
                    >
                      <item.Icon size={20} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                  {!searchItems.length && (
                    <div className="empty-state">没有找到相关任务或功能。</div>
                  )}
                </div>
                <div className="command-footer">
                  点击打开<span>Esc 关闭</span>
                </div>
              </>
            )}
            {modal === "data" && (
              <DataPreview
                rows={rows}
                busy={busy}
                onExport={exportRows}
                onClean={() => go("clean")}
                onSave={() => openSave()}
                saved={Boolean(savedResultId)}
                expanded
                format={exportFormat}
                setFormat={setExportFormat}
                progress={progress}
              />
            )}
            {modal === "logs" && (
              <LogPanel
                logs={logs}
                running={running}
                elapsed={elapsed}
                onClear={() => setLogs([])}
                expanded
              />
            )}
            {modal?.type === "delete" && (
              <>
                <div className="modal-title">
                  <h2>删除这条采集记录？</h2>
                  <p>只删除这条任务记录，文件库中主动保存的文件不受影响。</p>
                </div>
                <div className="modal-actions">
                  <button className="button" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="button danger"
                    disabled={locked}
                    onClick={() =>
                      action("delete", async () => {
                        await api.deleteHistory(modal.id);
                        await refreshHistory();
                        setModal(null);
                        notify("记录已删除。");
                      })
                    }
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {saveDialog && (
        <Dialog
          title="保存到文件库"
          locked={saving}
          onClose={() => {
            setSaveDialog(false);
            pendingAction.current = null;
          }}
        >
          <p className="save-summary">
            {rows.length.toLocaleString()} 条数据将保存到程序的 Data
            文件夹，可在文件库中继续查看和编辑。
          </p>
          <label className="field">
            文件名称
            <input
              autoFocus
              aria-label="保存文件名称"
              value={saveName}
              maxLength={100}
              disabled={saving}
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saving) saveCurrent();
              }}
            />
          </label>
          <div className="save-location">
            <FolderOpen size={16} />
            <span>{info?.collectionsDir}</span>
          </div>
          <div className="modal-actions">
            <button
              className="button"
              disabled={saving}
              onClick={() => {
                setSaveDialog(false);
                pendingAction.current = null;
              }}
            >
              继续预览
            </button>
            <button
              className="button primary"
              disabled={saving || !saveName.trim()}
              onClick={saveCurrent}
            >
              {saving ? (
                <Loader2 size={15} className="spinning" />
              ) : (
                <Save size={15} />
              )}
              确认保存
            </button>
          </div>
        </Dialog>
      )}
      {discardDialog && (
        <Dialog
          title="处理当前未保存的结果"
          onClose={() => {
            setDiscardDialog(false);
            pendingAction.current = null;
          }}
        >
          <p className="muted">
            当前有 {rows.length}{" "}
            条未保存数据。你可以先保存，也可以放弃后继续操作。
          </p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                setDiscardDialog(false);
                pendingAction.current = null;
              }}
            >
              继续预览
            </button>
            <button
              className="button"
              onClick={() => {
                const next = pendingAction.current;
                pendingAction.current = null;
                setDiscardDialog(false);
                setDraftDirty(false);
                api?.setUnsavedChanges(libraryDirty);
                if (next) next();
              }}
            >
              不保存，继续
            </button>
            <button
              className="button primary"
              onClick={() => {
                setDiscardDialog(false);
                setSaveName(config.name || "采集结果");
                setSaveDialog(true);
              }}
            >
              保存后继续
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
