"use strict";

const { normalizeAdvanced } = require("./network.cjs");

const VALID_TEMPLATES = new Set([
  "articles",
  "links",
  "images",
  "tables",
  "custom",
]);
const VALID_TYPES = new Set(["text", "link", "image"]);
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function webUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
    parsed.hash = "";
    return parsed.href;
  } catch {
    throw new Error("请输入完整的网址，以 http:// 或 https:// 开头。");
  }
}

function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.round(number)))
    : fallback;
}

function normalizeConfig(input = {}) {
  if (!input || typeof input !== "object")
    throw new Error("采集设置无效，请重新填写。");
  const urls = [
    ...new Set(
      (Array.isArray(input.urls) ? input.urls : [])
        .filter(Boolean)
        .slice(0, 100)
        .map(webUrl),
    ),
  ];
  if (!urls.length) throw new Error("请先添加至少一个网页地址。");
  const template = VALID_TEMPLATES.has(input.template)
    ? input.template
    : "articles";
  const fields = (Array.isArray(input.fields) ? input.fields : [])
    .slice(0, 30)
    .map((field, index) => ({
      name: String(field.name || `字段${index + 1}`)
        .trim()
        .slice(0, 80),
      selector: String(field.selector || "")
        .trim()
        .slice(0, 1000),
      type: VALID_TYPES.has(field.type) ? field.type : "text",
    }));
  if (
    template === "custom" &&
    (!fields.length || fields.some((field) => !field.selector))
  )
    throw new Error("请为每个自定义字段点选网页元素。");
  if (
    fields.some(
      (field) =>
        !field.name ||
        RESERVED_KEYS.has(field.name) ||
        field.name === "来源网页",
    )
  )
    throw new Error("字段名称不能为空或使用系统保留名称，请换一个名称。");
  if (new Set(fields.map((field) => field.name)).size !== fields.length)
    throw new Error("字段名称不能重复，请为每个字段取不同的名称。");
  return {
    name: String(input.name || "未命名采集")
      .trim()
      .slice(0, 100),
    urls,
    template,
    fields,
    maxPages: integer(input.maxPages, 5, 1, 50),
    delayMs: integer(input.delayMs, 1500, 1000, 10000),
    waitMs: integer(input.waitMs, 1500, 500, 15000),
    nextSelector: String(input.nextSelector || "")
      .trim()
      .slice(0, 1000),
    keyword: String(input.keyword || "")
      .trim()
      .slice(0, 100),
    dedupe: input.dedupe !== false,
    maxRows: integer(input.maxRows, 1000, 1, 10000),
    advanced: normalizeAdvanced(input.advanced),
  };
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("没有可以导出的数据，请先完成采集。");
  let budget = 20 * 1024 * 1024;
  return rows.slice(0, 10000).map((row) => {
    const clean = Object.create(null);
    for (const [key, value] of Object.entries(row || {}).slice(0, 40)) {
      if (RESERVED_KEYS.has(key)) continue;
      const text = String(value ?? "").slice(0, 12000);
      budget -= text.length + key.length;
      if (budget < 0) throw new Error("导出内容过大，请减少采集数量后再试。");
      clean[String(key).slice(0, 100)] = text;
    }
    return clean;
  });
}

function safeSpreadsheet(value) {
  const text = String(value ?? "");
  return /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
}

function toCsv(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) => `"${safeSpreadsheet(value).replace(/"/g, '""')}"`;
  return (
    "\ufeff" +
    [
      keys.map(cell).join(","),
      ...rows.map((row) => keys.map((key) => cell(row[key])).join(",")),
    ].join("\r\n")
  );
}

// This function is serialized and runs in Chromium's isolated world, without Node APIs.
function extractPage(config) {
  const cap = 10000;
  const resultLimit = Math.min(
    config._captureLimit || config.maxRows || 1000,
    cap,
  );
  const clean = (value, max = 4000) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const visible = (element) =>
    element &&
    !element.closest('[hidden],[aria-hidden="true"],script,style,noscript') &&
    element.getClientRects().length > 0;
  const select = (selector, base = document) => {
    try {
      return Array.from(base.querySelectorAll(selector)).slice(0, 15000);
    } catch {
      throw new Error("网页元素规则无效，请重新点选元素。");
    }
  };
  const absolute = (value, image = false) => {
    if (!String(value || "").trim()) return "";
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const text = (node) => clean(node?.innerText || node?.textContent || "");
  const source = location.href;
  const valueFor = (element, type) => {
    if (type === "link")
      return absolute(
        (element.matches("a[href]")
          ? element
          : element.querySelector("a[href]")
        )?.getAttribute("href") || "",
      );
    if (type === "image") {
      const img = element.matches("img")
        ? element
        : element.querySelector("img");
      return absolute(
        img?.currentSrc ||
          img?.getAttribute("data-src") ||
          img?.getAttribute("src") ||
          "",
        true,
      );
    }
    return text(element);
  };
  let rows = [];
  if (config.template === "custom") {
    const columns = config.fields.map((field) => ({
      ...field,
      elements: select(field.selector).filter(visible).slice(0, cap),
    }));
    const length = Math.min(
      cap,
      Math.max(0, ...columns.map((column) => column.elements.length)),
    );
    let containers = null;
    if (columns.length > 1 && length > 1) {
      const anchorColumn = columns.find(
        (column) => column.elements.length === length,
      );
      let ancestor = anchorColumn.elements[0].parentElement;
      for (
        let depth = 0;
        ancestor && ancestor !== document.body && depth < 8;
        depth++, ancestor = ancestor.parentElement
      ) {
        const names = [...ancestor.classList].filter(
          (name) =>
            name.length < 60 &&
            !/^(active|selected|hover|focus|is-)/i.test(name),
        );
        const signature =
          ancestor.tagName.toLowerCase() +
          names.map((name) => "." + CSS.escape(name)).join("");
        const candidate = anchorColumn.elements.map((element) =>
          element.closest(signature),
        );
        if (
          candidate.some((element) => !element) ||
          new Set(candidate).size !== length
        )
          continue;
        const allFieldsBelong = columns.every((column) =>
          column.elements.every((element) =>
            candidate.some((container) => container.contains(element)),
          ),
        );
        const noAmbiguousValues = candidate.every((container) =>
          columns.every(
            (column) =>
              column.elements.filter((element) => container.contains(element))
                .length <= 1,
          ),
        );
        if (allFieldsBelong && noAmbiguousValues) {
          containers = candidate;
          break;
        }
      }
      if (!containers && columns.some((column) => column.elements.length))
        throw new Error(
          "这些字段无法可靠对应到同一条记录。请点选同一张卡片或同一表格行中的字段；也可以先单独采集一个字段。",
        );
    }
    rows = Array.from({ length }, (_, index) => {
      const row = {};
      columns.forEach((column) => {
        const element = containers
          ? column.elements.find((element) =>
              containers[index].contains(element),
            )
          : column.elements[index];
        row[column.name] = element ? valueFor(element, column.type) : "";
      });
      row["来源网页"] = source;
      return row;
    });
  } else if (config.template === "links") {
    rows = select("a[href]")
      .filter(visible)
      .map((anchor) => ({
        文本:
          text(anchor) ||
          clean(anchor.getAttribute("title")) ||
          clean(anchor.querySelector("img")?.alt),
        链接: absolute(anchor.getAttribute("href")),
        来源网页: source,
      }))
      .filter((row) => row["链接"])
      .slice(0, cap);
  } else if (config.template === "images") {
    rows = select("img")
      .filter(visible)
      .map((img) => ({
        图片说明: clean(img.alt || img.title),
        图片地址: valueFor(img, "image"),
        来源网页: source,
      }))
      .filter((row) => row["图片地址"])
      .slice(0, cap);
  } else if (config.template === "tables") {
    select("table")
      .filter(visible)
      .forEach((table, tableIndex) => {
        const tableRows = select("tr", table).filter(visible);
        if (!tableRows.length) return;
        const firstCells = select("th,td", tableRows[0]);
        const hasHeader = !!tableRows[0].querySelector("th");
        const header = firstCells.map(
          (cell, index) => (hasHeader ? text(cell) : "") || `列${index + 1}`,
        );
        const names = header.map((name, index) =>
          header.indexOf(name) !== index ||
          [
            "表格",
            "来源网页",
            "__proto__",
            "constructor",
            "prototype",
          ].includes(name)
            ? `${name}_${index + 1}`
            : name,
        );
        tableRows.slice(hasHeader ? 1 : 0).forEach((tr) => {
          if (rows.length >= cap) return;
          const row = { 表格: String(tableIndex + 1) };
          select("th,td", tr).forEach((cell, index) => {
            row[names[index] || `列${index + 1}`] = text(cell);
          });
          row["来源网页"] = source;
          rows.push(row);
        });
      });
  } else {
    let cards = select(
      'article,[role="article"],.post,.entry,.news-item,.article-item,.post-item,.story-card,.news-card,.article-card',
    ).filter(visible);
    cards = cards.filter(
      (card) => !cards.some((other) => other !== card && other.contains(card)),
    );
    rows = cards
      .slice(0, cap)
      .map((card) => {
        const heading = card.querySelector('h1,h2,h3,h4,[class*="title"]');
        const anchor =
          heading?.closest("a[href]") ||
          heading?.querySelector("a[href]") ||
          card.querySelector("a[href]");
        const paragraphs = select("p", card).map(text).filter(Boolean);
        return {
          标题: text(heading) || text(anchor) || clean(document.title),
          链接: absolute(anchor?.getAttribute("href") || source),
          摘要: clean(paragraphs[0] || text(card), 500),
          正文: clean(paragraphs.join("\n"), 12000),
          图片地址: valueFor(card, "image"),
          来源网页: source,
        };
      })
      .filter((row) => row["标题"]);
    if (!rows.length) {
      rows = select("h1 a[href],h2 a[href],h3 a[href],a h1,a h2,a h3")
        .filter(visible)
        .map((element) => {
          const anchor = element.matches("a") ? element : element.closest("a");
          return {
            标题: text(element),
            链接: absolute(anchor?.getAttribute("href")),
            摘要: text(anchor?.parentElement?.querySelector("p")),
            正文: "",
            图片地址: "",
            来源网页: source,
          };
        })
        .filter((row) => row["标题"] && row["链接"])
        .slice(0, cap);
    }
    if (!rows.length) {
      const main =
        document.querySelector(
          'main,[role="main"],.article-content,.post-content',
        ) || document.body;
      rows = [
        {
          标题: text(document.querySelector("h1")) || clean(document.title),
          链接: source,
          摘要: clean(
            document.querySelector('meta[name="description"]')?.content ||
              text(main),
            500,
          ),
          正文: clean(main.innerText || main.textContent, 12000),
          图片地址: valueFor(main, "image"),
          来源网页: source,
        },
      ];
    }
  }
  const contentFingerprint = rows
    .slice(0, 200)
    .map((row) => JSON.stringify(row))
    .join("\n")
    .slice(0, 300000);
  if (config.keyword)
    rows = rows.filter((row) =>
      Object.entries(row).some(
        ([key, value]) =>
          key !== "来源网页" &&
          String(value).toLowerCase().includes(config.keyword.toLowerCase()),
      ),
    );
  let next = null;
  const candidates = config.nextSelector
    ? select(config.nextSelector)
    : select('a[rel="next"],link[rel="next"],a,button,[role="button"]');
  const nextElement = candidates.find((element) => {
    if (!visible(element) && element.tagName !== "LINK") return false;
    if (
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      /(?:^|\s)disabled(?:\s|$)/i.test(element.className || "")
    )
      return false;
    return (
      config.nextSelector ||
      element.getAttribute("rel") === "next" ||
      /^(下一页|下页|后一页|下一頁|下頁|next(?:\s*page)?|older(?:\s*posts)?)[\s›»→>]*$/i.test(
        text(element),
      )
    );
  });
  if (nextElement) {
    const href = nextElement.getAttribute("href");
    const nextUrl =
      href && !href.startsWith("#") && !/^javascript:/i.test(href)
        ? absolute(href)
        : "";
    if (nextUrl && new URL(nextUrl).origin === location.origin)
      next = { url: nextUrl };
    else if (!nextUrl) {
      const all = select('a,button,[role="button"]');
      const index = all.indexOf(nextElement);
      if (index >= 0) next = { clickIndex: index };
    }
  }
  return {
    rows: rows.slice(0, resultLimit),
    title: clean(document.title, 500),
    url: source,
    next,
    fingerprint:
      clean(document.body?.innerText, 30000) + "\n" + contentFingerprint,
  };
}

module.exports = {
  webUrl,
  normalizeConfig,
  sanitizeRows,
  safeSpreadsheet,
  toCsv,
  extractPage,
};
