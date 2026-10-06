"use strict";

// Runs inside a browser isolated world. Selection never exposes app privileges to the page.
function pickElement(mode) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-qingcaiji-picker", "");
    host.style.cssText =
      "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      '<style>*{box-sizing:border-box}.banner{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#184d45;color:white;padding:14px 20px;border-radius:12px;font:14px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 8px 30px #0003;white-space:nowrap}.outline{position:fixed;border:2px solid #1eae93;background:#1eae9324;border-radius:3px}.label{position:fixed;background:#184d45;color:white;padding:5px 8px;font:12px "Microsoft YaHei",sans-serif;border-radius:4px;max-width:70vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style><div class="banner">移动鼠标查看范围，点击选择' +
      ({ text: "文字", link: "链接", image: "图片", next: "下一页按钮" }[
        mode
      ] || "元素") +
      ' · 按 Esc 取消</div><div class="outline"></div><div class="label"></div>';
    document.documentElement.appendChild(host);
    const outline = shadow.querySelector(".outline");
    const label = shadow.querySelector(".label");
    let target = null;
    const escape = (value) => CSS.escape(value);
    const classes = (element) =>
      [...element.classList]
        .filter(
          (value) =>
            value.length < 60 &&
            !/^(active|hover|focus|selected|current|is-)/i.test(value),
        )
        .slice(0, 3);
    const selectorFor = (element) => {
      const tag = element.tagName.toLowerCase();
      const classNames = classes(element);
      if (mode === "next") {
        if (
          element.id &&
          document.querySelectorAll("#" + escape(element.id)).length === 1
        )
          return "#" + escape(element.id);
        const uniqueParts = [];
        for (
          let node = element;
          node && node !== document.documentElement;
          node = node.parentElement
        ) {
          let part = node.tagName.toLowerCase();
          if (node.parentElement) {
            const siblings = [...node.parentElement.children].filter(
              (sibling) => sibling.tagName === node.tagName,
            );
            if (siblings.length > 1)
              part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
          }
          uniqueParts.unshift(part);
        }
        return uniqueParts.join(" > ");
      }
      for (const name of classNames) {
        const selector = tag + "." + escape(name);
        if (document.querySelectorAll(selector).length > 1) return selector;
      }
      for (
        let parent = element.parentElement, depth = 0;
        parent && depth < 4;
        parent = parent.parentElement, depth++
      ) {
        for (const name of classes(parent)) {
          const selector =
            "." +
            escape(name) +
            " " +
            tag +
            (classNames.length ? "." + escape(classNames[0]) : "");
          const matches = document.querySelectorAll(selector);
          if (matches.length > 1 && matches.length < 1000) return selector;
        }
      }
      if (
        element.id &&
        document.querySelectorAll("#" + escape(element.id)).length === 1
      )
        return "#" + escape(element.id);
      const parts = [];
      for (
        let node = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift("#" + escape(node.id));
          break;
        }
        const names = classes(node);
        if (names.length) part += "." + escape(names[0]);
        else if (node.parentElement) {
          const siblings = [...node.parentElement.children].filter(
            (sibling) => sibling.tagName === node.tagName,
          );
          if (siblings.length > 1)
            part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
        parts.unshift(part);
        if (parts.length >= 5) break;
      }
      return parts.join(" > ") || tag;
    };
    const chooseTarget = (element) => {
      if (!(element instanceof Element) || element === host) return null;
      if (mode === "link")
        return element.closest("a[href]") || element.querySelector("a[href]");
      if (mode === "image")
        return element.closest("img") || element.querySelector("img");
      if (mode === "next")
        return element.closest('a,button,[role="button"]') || element;
      return element;
    };
    const cleanup = (value) => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      host.remove();
      resolve(value);
    };
    const move = (event) => {
      target = chooseTarget(event.target);
      if (!target) {
        outline.style.display = label.style.display = "none";
        return;
      }
      const rect = target.getBoundingClientRect();
      Object.assign(outline.style, {
        display: "block",
        top: rect.top + "px",
        left: rect.left + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
      const selector = selectorFor(target);
      label.textContent =
        "将匹配 " +
        document.querySelectorAll(selector).length +
        " 个元素 · " +
        selector;
      Object.assign(label.style, {
        display: "block",
        top: Math.min(innerHeight - 30, Math.max(0, rect.bottom + 4)) + "px",
        left: Math.max(0, Math.min(innerWidth - 250, rect.left)) + "px",
      });
    };
    const click = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      target = chooseTarget(event.target);
      if (!target) return;
      const selector = selectorFor(target);
      const preview =
        mode === "image"
          ? target.currentSrc || target.src || ""
          : mode === "link"
            ? target.href
            : target.innerText || target.textContent || "";
      cleanup({
        selector,
        preview: String(preview).trim().slice(0, 500),
        count: document.querySelectorAll(selector).length,
        url: location.href,
      });
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup(null);
      }
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
}

module.exports = { pickElement };
