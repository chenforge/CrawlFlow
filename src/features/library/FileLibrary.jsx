import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import Dialog from "../../shared/Dialog";

const messageOf = (error) =>
  String(error?.message || error)
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    .replace(/^Error: /, "");
const date = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const PAGE_SIZE = 20;

export default function FileLibrary({
  api,
  info,
  notify,
  busy,
  registerGuard,
  onDirtyChange,
  onUse,
  refreshToken,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [document, setDocument] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(0);
  const [rowQuery, setRowQuery] = useState("");
  const [deleteFile, setDeleteFile] = useState(null);
  const [pendingLeave, setPendingLeave] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [undoRow, setUndoRow] = useState(null);
  const dirtyRef = useRef(false);
  const deferredQuery = useDeferredValue(rowQuery);
  const locked = Boolean(busy) || working;
  const refresh = async () => {
    if (!api?.getSavedFiles) {
      setLoading(false);
      return;
    }
    try {
      setFiles(await api.getSavedFiles());
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, [api, refreshToken]);
  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    registerGuard((callback) => {
      if (dirtyRef.current) setPendingLeave(() => callback);
      else callback();
    });
    return () => {
      registerGuard(null);
      onDirtyChange(false);
    };
  }, [registerGuard, onDirtyChange]);
  const requestLeave = (callback) => {
    if (dirty) setPendingLeave(() => callback);
    else callback();
  };
  const open = async (id) => {
    setWorking(true);
    try {
      const value = await api.loadSavedFile(id);
      setDocument(value);
      setDirty(false);
      setPage(0);
      setRowQuery("");
      setEditingRow(null);
      setUndoRow(null);
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setWorking(false);
    }
  };
  const close = () => {
    setDocument(null);
    setDirty(false);
    setEditingRow(null);
    setUndoRow(null);
  };
  const save = async (after) => {
    if (!document?.name.trim()) {
      notify("请为文件填写一个名称。", "error");
      return;
    }
    setWorking(true);
    try {
      const metadata = await api.updateSavedFile({
        id: document.id,
        name: document.name.trim(),
        rows: document.rows,
        config: document.config,
        expectedUpdatedAt: document.updatedAt,
      });
      setDocument((current) => ({ ...current, ...metadata }));
      setDirty(false);
      dirtyRef.current = false;
      setUndoRow(null);
      await refresh();
      notify("文件修改已保存。", "success");
      if (after) after();
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setWorking(false);
    }
  };
  const remove = async () => {
    setWorking(true);
    try {
      await api.deleteSavedFile(deleteFile.id);
      if (document?.id === deleteFile.id) close();
      setDeleteFile(null);
      await refresh();
      notify("文件已删除。");
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setWorking(false);
    }
  };
  const updateCell = (index, column, value) => {
    setDocument((current) => ({
      ...current,
      rows: current.rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [column]: value } : row,
      ),
    }));
    setDirty(true);
  };
  const removeRow = (index) => {
    setUndoRow({ row: document.rows[index], index });
    setDocument((current) => ({
      ...current,
      rows: current.rows.filter((_, rowIndex) => rowIndex !== index),
    }));
    setDirty(true);
    setEditingRow(null);
  };
  const columns = useMemo(
    () => [
      ...new Set((document?.rows || []).flatMap((row) => Object.keys(row))),
    ],
    [document?.rows],
  );
  const filteredRows = useMemo(
    () =>
      (document?.rows || [])
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            !deferredQuery ||
            Object.values(row).some((value) =>
              String(value ?? "")
                .toLowerCase()
                .includes(deferredQuery.toLowerCase()),
            ),
        ),
    [document?.rows, deferredQuery],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filteredRows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(query.toLowerCase()),
  );
  const openFolder = async () => {
    try {
      await api.revealDataFolder();
    } catch (error) {
      notify(messageOf(error), "error");
    }
  };

  return (
    <div className="library-page page-stack">
      {document ? (
        <section className="panel library-document">
          <div className="document-heading">
            <button
              className="icon-button"
              aria-label="返回文件列表"
              disabled={locked}
              onClick={() => requestLeave(close)}
            >
              <ArrowLeft size={20} />
            </button>
            <span className="document-icon">
              <FileText size={22} />
            </span>
            <label className="document-name">
              <span className="mini-label">文件名称</span>
              <input
                aria-label="文件名称"
                value={document.name}
                maxLength={100}
                disabled={locked}
                onChange={(event) => {
                  setDocument((current) => ({
                    ...current,
                    name: event.target.value,
                  }));
                  setDirty(true);
                }}
              />
            </label>
            <span className={`save-status ${dirty ? "unsaved" : ""}`}>
              {dirty ? (
                <>
                  <i />
                  尚未保存修改
                </>
              ) : (
                <>
                  <Check size={14} />
                  已保存
                </>
              )}
            </span>
            <button
              className="button"
              disabled={locked || dirty}
              onClick={() => onUse(document)}
            >
              <ArrowUpRight size={15} />
              载入工作台
            </button>
            <button
              className="button primary"
              disabled={locked || !dirty}
              onClick={() => save()}
            >
              {working ? (
                <Loader2 size={15} className="spinning" />
              ) : (
                <Save size={15} />
              )}
              保存修改
            </button>
          </div>
          <div className="document-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="搜索文件内容"
                placeholder="在文件中搜索…"
                value={rowQuery}
                onChange={(event) => {
                  setRowQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <span>
              {document.rows.length.toLocaleString()} 条记录 · {columns.length}{" "}
              个字段
            </span>
            <span className="document-instruction">
              <Pencil size={13} />
              点击单元格即可修改
            </span>
            {undoRow && (
              <button
                className="text-button"
                disabled={locked}
                onClick={() => {
                  setDocument((current) => {
                    const next = [...current.rows];
                    next.splice(undoRow.index, 0, undoRow.row);
                    return { ...current, rows: next };
                  });
                  setUndoRow(null);
                  setDirty(true);
                }}
              >
                <Undo2 size={14} />
                撤销删行
              </button>
            )}
          </div>
          <div className="library-table-wrap">
            <table className="library-table">
              <thead>
                <tr>
                  <th className="library-row-number">#</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  <th className="library-row-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, index }) => (
                  <tr key={index}>
                    <td className="library-row-number">{index + 1}</td>
                    {columns.map((column) => (
                      <td key={column}>
                        <textarea
                          rows={2}
                          maxLength={12000}
                          spellCheck={false}
                          aria-label={`第 ${index + 1} 条 ${column}`}
                          value={String(row[column] ?? "")}
                          disabled={locked}
                          onChange={(event) =>
                            updateCell(index, column, event.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td className="library-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`展开编辑第 ${index + 1} 条`}
                        onClick={() => setEditingRow(index)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={locked}
                        aria-label={`删除第 ${index + 1} 条`}
                        onClick={() => removeRow(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="empty-state">
                <Search size={30} />
                <p>
                  {rowQuery ? "没有匹配的记录。" : "这个文件暂时没有数据。"}
                </p>
              </div>
            )}
          </div>
          <div className="table-pagination">
            <span>
              最近保存 {date(document.updatedAt)} · 每页 {PAGE_SIZE} 条
            </span>
            <div>
              <button
                className="icon-button"
                disabled={!currentPage}
                aria-label="上一页文件数据"
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                className="icon-button"
                disabled={currentPage === pageCount - 1}
                aria-label="下一页文件数据"
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="panel library-overview">
            <div className="library-overview-copy">
              <h2>我的采集文件</h2>
              <p>预览满意后保存。随时回来查看、修改或整理。</p>
            </div>
            <div className="library-count">
              <strong>{files.length}</strong>
              <span>个已保存文件</span>
            </div>
            <button className="button" disabled={!api} onClick={openFolder}>
              <FolderOpen size={16} />
              打开文件夹
            </button>
          </section>
          <section className="panel library-list">
            <div className="panel-head">
              <h2>我的文件</h2>
              <span className="panel-hint">按最近修改排序</span>
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="搜索已保存文件"
                  placeholder="搜索文件名称"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            {loading ? (
              <div className="empty-state">
                <Loader2 className="spinning" size={28} />
                <p>正在读取文件…</p>
              </div>
            ) : filteredFiles.length ? (
              <div className="saved-file-list">
                {filteredFiles.map((file) => (
                  <article className="saved-file" key={file.id}>
                    <button
                      className="file-open-area"
                      disabled={locked}
                      onClick={() => open(file.id)}
                    >
                      <span className="file-tile">
                        <FileText size={24} />
                        <small>DATA</small>
                      </span>
                      <span className="file-description">
                        <strong>{file.name}</strong>
                        <small>
                          {(
                            file.rowsCount ??
                            file.rowCount ??
                            0
                          ).toLocaleString()}{" "}
                          条数据 · {date(file.updatedAt || file.createdAt)}
                        </small>
                      </span>
                      <span className="file-open-hint">
                        查看与编辑
                        <ArrowUpRight size={15} />
                      </span>
                    </button>
                    <button
                      className="icon-button file-delete"
                      aria-label={`删除文件${file.name}`}
                      disabled={locked}
                      onClick={() => setDeleteFile(file)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="library-empty">
                <div className="empty-file-stack">
                  <FileText size={46} strokeWidth={1} />
                </div>
                <h3>{query ? "没有找到这个文件" : "还没有保存的采集文件"}</h3>
                <p>
                  {query
                    ? "试试其他名称。"
                    : "采集完成后点击“保存到文件库”，就能在这里管理。"}
                </p>
              </div>
            )}
          </section>
          <div className="library-location">
            <FolderOpen size={14} />
            <span>保存位置</span>
            <code title={info?.collectionsDir}>
              {info?.collectionsDir || "CrawlFlow / Data / Collections"}
            </code>
          </div>
        </>
      )}
      {pendingLeave && (
        <Dialog
          title="保存文件的修改？"
          locked={working}
          onClose={() => setPendingLeave(null)}
        >
          <p className="muted">
            “{document?.name}
            ”有尚未保存的修改。离开前可以保存，也可以放弃这次编辑。
          </p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={working}
              onClick={() => setPendingLeave(null)}
            >
              继续编辑
            </button>
            <button
              className="button"
              disabled={working}
              onClick={() => {
                const leave = pendingLeave;
                setPendingLeave(null);
                setDirty(false);
                dirtyRef.current = false;
                leave();
              }}
            >
              放弃修改
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() =>
                save(() => {
                  const leave = pendingLeave;
                  setPendingLeave(null);
                  leave();
                })
              }
            >
              保存并离开
            </button>
          </div>
        </Dialog>
      )}
      {deleteFile && (
        <Dialog
          title="删除这个文件？"
          locked={working}
          onClose={() => setDeleteFile(null)}
        >
          <p className="muted">
            “{deleteFile.name}
            ”将从文件库中删除。文件会移入程序的回收文件夹，已另行导出的副本不受影响。
          </p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={working}
              onClick={() => setDeleteFile(null)}
            >
              保留文件
            </button>
            <button
              className="button danger"
              disabled={working}
              onClick={remove}
            >
              {working ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </Dialog>
      )}
      {editingRow !== null && document?.rows[editingRow] && (
        <Dialog
          title={`编辑第 ${editingRow + 1} 条数据`}
          wide
          onClose={() => setEditingRow(null)}
        >
          <div className="row-editor-fields">
            {columns.map((column) => (
              <label className="field" key={column}>
                {column}
                <textarea
                  rows={3}
                  aria-label={`编辑 ${column}`}
                  value={String(document.rows[editingRow][column] ?? "")}
                  disabled={locked}
                  onChange={(event) =>
                    updateCell(editingRow, column, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <span className="muted">完成后，点击文件顶部的“保存修改”。</span>
            <button
              className="button primary"
              onClick={() => setEditingRow(null)}
            >
              <Check size={15} />
              完成编辑
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
