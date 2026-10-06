import {
  Globe2,
  Languages,
  Timer,
  SlidersHorizontal,
  RotateCcw,
  ImageOff,
  Film,
  ArrowRight,
} from "lucide-react";
import { Switch } from "../../Workbench";
import SlidingSelection from "../../shared/SlidingSelection";
import { advancedDefaults, readAdvanced } from "./config";

const modes = [
  { id: "simple", label: "标准模式" },
  { id: "advanced", label: "高级模式" },
];

export default function AdvancedSettings({ config, update, busy, notify }) {
  const advanced = readAdvanced(config.advanced);
  const locked = Boolean(busy);
  const change = (key, value) =>
    update("advanced", { ...advanced, [key]: value });
  return (
    <div className="advanced-page page-stack">
      <section className="panel advanced-intro">
        <div className="advanced-intro-copy">
          <h2>高级采集设置</h2>
          <p>
            大多数网站使用标准模式即可。遇到编码、加载速度或请求设置问题时，再开启高级模式。
          </p>
        </div>
        <SlidingSelection
          value={advanced.enabled ? "advanced" : "simple"}
          items={modes}
          onChange={(value) => change("enabled", value === "advanced")}
          disabled={locked}
          label="采集模式"
        />
      </section>
      <div className={`advanced-form ${advanced.enabled ? "enabled" : ""}`}>
        {!advanced.enabled && (
          <div className="mode-explanation">
            <SlidersHorizontal size={19} />
            <span>以下是当前保留的高级设置。开启高级模式后生效。</span>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => change("enabled", true)}
            >
              开启高级模式
              <ArrowRight size={13} />
            </button>
          </div>
        )}
        <fieldset
          disabled={locked || !advanced.enabled}
          className="advanced-grid"
        >
          <section className="panel page-section">
            <div className="panel-head">
              <div>
                <h2>
                  <Globe2 size={18} />
                  连接方式
                </h2>
                <p className="muted">协议与浏览器身份。</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                访问协议
                <select
                  aria-label="访问协议"
                  value={advanced.protocol}
                  onChange={(event) => change("protocol", event.target.value)}
                >
                  <option value="auto">跟随网址（推荐）</option>
                  <option value="https">HTTPS</option>
                  <option value="http">HTTP</option>
                </select>
                <small>用于打开网址；网站仍可能自动跳转。</small>
              </label>
              <label className="field">
                网页编码
                <select
                  aria-label="网页编码"
                  value={advanced.encoding}
                  onChange={(event) => change("encoding", event.target.value)}
                >
                  <option value="auto">自动识别（推荐）</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="gb18030">GB18030 / GBK（简体中文）</option>
                  <option value="big5">Big5（繁体中文）</option>
                  <option value="shift_jis">Shift_JIS（日文）</option>
                </select>
                <small>网页文字乱码时，可尝试指定编码。</small>
              </label>
              <label className="field span-2">
                浏览器标识 · User-Agent
                <input
                  aria-label="浏览器标识"
                  value={advanced.userAgent}
                  maxLength={512}
                  onChange={(event) => change("userAgent", event.target.value)}
                  placeholder="留空，使用 CrawlFlow 内置浏览器"
                />
                <small>仅在目标网站要求特定浏览器标识时填写。</small>
              </label>
            </div>
          </section>
          <section className="panel page-section">
            <div className="panel-head">
              <div>
                <h2>
                  <Timer size={18} />
                  加载与重试
                </h2>
                <p className="muted">给慢速网页留出时间。</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                连接超时 / 秒
                <input
                  aria-label="连接超时秒数"
                  type="number"
                  min={3}
                  max={120}
                  value={advanced.timeoutMs / 1000}
                  onChange={(event) =>
                    change("timeoutMs", Number(event.target.value) * 1000)
                  }
                />
                <small>3–120 秒，超时后结束本次尝试。</small>
              </label>
              <label className="field">
                失败重试次数
                <input
                  aria-label="失败重试次数"
                  type="number"
                  min={0}
                  max={3}
                  value={advanced.retries}
                  onChange={(event) =>
                    change("retries", Number(event.target.value))
                  }
                />
                <small>0–3 次；0 表示失败后不重试。</small>
              </label>
            </div>
            <div className="resource-options">
              <div>
                <ImageOff size={19} />
                <span>
                  <strong>不加载图片</strong>
                  <small>减少流量；依赖图片加载的页面可能受影响。</small>
                </span>
                <Switch
                  checked={advanced.blockImages}
                  onChange={(value) => change("blockImages", value)}
                  label="不加载图片"
                  disabled={locked || !advanced.enabled}
                />
              </div>
              <div>
                <Film size={19} />
                <span>
                  <strong>不加载音视频</strong>
                  <small>跳过媒体内容，集中采集文字与链接。</small>
                </span>
                <Switch
                  checked={advanced.blockMedia}
                  onChange={(value) => change("blockMedia", value)}
                  label="不加载音视频"
                  disabled={locked || !advanced.enabled}
                />
              </div>
            </div>
          </section>
          <section className="panel page-section request-headers">
            <div className="panel-head">
              <div>
                <h2>
                  <Languages size={18} />
                  自定义请求头
                </h2>
                <p className="muted">
                  可指定网站偏好的语言或其他普通请求参数。
                </p>
              </div>
              <span className="pill">选填</span>
            </div>
            <label className="field">
              每行一项，名称与值用英文冒号分隔
              <textarea
                aria-label="自定义请求头"
                spellCheck={false}
                rows={5}
                value={advanced.headers}
                maxLength={16384}
                placeholder={
                  "Accept-Language: zh-CN,zh;q=0.9\nX-Client-Name: CrawlFlow"
                }
                onChange={(event) => change("headers", event.target.value)}
              />
            </label>
            <p className="muted section-note">
              最多 30 项。登录请使用“打开网页 / 登录”，不支持在这里填写
              Cookie、Authorization 或浏览器保留请求头。
            </p>
          </section>
        </fieldset>
      </div>
      <div className="advanced-footer">
        <span>
          <i className={advanced.enabled ? "active" : ""} />
          {advanced.enabled
            ? "高级设置会应用于预览、测试与正式采集。"
            : "当前使用标准模式；高级设置暂不生效。"}
        </span>
        <button
          className="button subtle"
          disabled={locked}
          onClick={() => {
            update("advanced", { ...advancedDefaults });
            notify("已恢复标准模式与默认参数。");
          }}
        >
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>
    </div>
  );
}
