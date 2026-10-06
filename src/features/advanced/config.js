export const advancedDefaults = Object.freeze({
  enabled: false,
  protocol: "auto",
  encoding: "auto",
  timeoutMs: 25000,
  retries: 1,
  userAgent: "",
  headers: "",
  blockImages: false,
  blockMedia: false,
});
export function readAdvanced(input = {}) {
  const clean = { ...advancedDefaults, ...input };
  if (!["auto", "http", "https"].includes(clean.protocol))
    clean.protocol = "auto";
  if (
    !["auto", "utf-8", "gb18030", "big5", "shift_jis"].includes(clean.encoding)
  )
    clean.encoding = "auto";
  clean.timeoutMs = Math.min(
    120000,
    Math.max(3000, Number(clean.timeoutMs) || 25000),
  );
  clean.retries = Math.min(
    3,
    Math.max(0, Math.round(Number(clean.retries) || 0)),
  );
  clean.userAgent = String(clean.userAgent || "").slice(0, 1024);
  clean.headers =
    typeof clean.headers === "string" ? clean.headers.slice(0, 16384) : "";
  return clean;
}
