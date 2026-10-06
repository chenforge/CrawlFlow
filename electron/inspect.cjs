"use strict";

// Runs in a Chromium isolated world; returns only page-derived field descriptions.
function detectPageFields(requestedTemplate = "auto") {
  const visible = (node) =>
    node &&
    node.getClientRects().length > 0 &&
    !node.closest('[hidden],[aria-hidden="true"],script,style,noscript');
  const query = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .slice(0, 10000);
  const compact = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  const cardCandidates = [
    "article",
    '[role="article"]',
    ".story-card",
    ".article-card",
    ".news-card",
    ".news-item",
    ".article-item",
    ".post-item",
    ".post",
    ".entry",
  ];
  let cardSelector =
    cardCandidates.find((selector) => query(selector).length > 1) ||
    cardCandidates.find((selector) => query(selector).length === 1);
  const tableCount = query("table").length;
  const imageCount = query("img").length;
  const linkCount = query("a[href]").length;
  let template = ["articles", "links", "images", "tables"].includes(
    requestedTemplate,
  )
    ? requestedTemplate
    : cardSelector
      ? "articles"
      : tableCount
        ? "tables"
        : query("h1,h2").length
          ? "articles"
          : imageCount > Math.max(2, linkCount)
            ? "images"
            : "links";
  const fields = [];
  const add = (name, selector, type) => {
    if (!selector) return;
    const matches = query(selector);
    if (!matches.length) return;
    const node = matches[0];
    const sample =
      type === "image"
        ? node.currentSrc || node.src || ""
        : type === "link"
          ? node.href || node.querySelector("a[href]")?.href || ""
          : node.innerText || node.textContent;
    fields.push({
      name,
      selector,
      type,
      enabled: true,
      count: matches.length,
      sample: compact(sample),
    });
  };
  if (template === "articles") {
    const base = cardSelector || (query("main").length ? "main" : "body");
    const within = (selectors) =>
      selectors
        .map((selector) => `${base} ${selector}`)
        .find((selector) => query(selector).length);
    add(
      "标题",
      within(["h1", "h2", "h3", "h4", '[class*="title"]', "a[href]"]) ||
        (query("h1").length ? "h1" : "title"),
      "text",
    );
    add(
      "链接",
      within(["h1 a[href]", "h2 a[href]", "h3 a[href]", "a[href]"]),
      "link",
    );
    add(
      "摘要",
      within(['[class*="summary"]', '[class*="excerpt"]', "p"]),
      "text",
    );
    add("图片地址", within(["img"]), "image");
  } else if (template === "links") {
    add("文本", "a[href]", "text");
    add("链接", "a[href]", "link");
  } else if (template === "images") {
    add("图片地址", "img", "image");
  } else {
    const firstTable = query("table")[0];
    if (firstTable) {
      const header = Array.from(firstTable.querySelectorAll("tr"))[0];
      const headers = Array.from(header?.querySelectorAll("th,td") || []);
      const hasHeader = !!header?.querySelector("th");
      headers.slice(0, 20).forEach((cell, index) => {
        const name = hasHeader
          ? compact(cell.innerText || cell.textContent) || `列${index + 1}`
          : `列${index + 1}`;
        add(name, `table tr td:nth-child(${index + 1})`, "text");
      });
    }
  }
  return { template, fields };
}

module.exports = { detectPageFields };
