"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

function startDemoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/login" && req.method === "POST") {
          res.writeHead(303, {
            "Set-Cookie": "qing_demo_login=yes; Path=/; HttpOnly; SameSite=Lax",
            Location: "/private",
          });
          res.end();
          return;
        }
        let filename = "index.html";
        if (url.pathname === "/private")
          filename = /(?:^|;\s*)qing_demo_login=yes(?:;|$)/.test(
            req.headers.cookie || "",
          )
            ? "private.html"
            : "login.html";
        else if (url.pathname === "/login") filename = "login.html";
        else if (url.pathname === "/image.svg") filename = "image.svg";
        else if (!["/", "/index.html", "/article"].includes(url.pathname)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const bytes = await fs.readFile(path.join(__dirname, "demo", filename));
        res.writeHead(200, {
          "Content-Type": filename.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(bytes);
      } catch {
        res.writeHead(500);
        res.end("Demo unavailable");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }),
    );
  });
}
module.exports = { startDemoServer };
