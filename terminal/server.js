const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const port = Number(process.env.TERMINAL_PORT || 3030);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function resolveFile(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[\/\\])+/, "");
  const candidate =
    safePath === "/" || safePath === "\\" || safePath === "." || safePath === ""
      ? "index.html"
      : safePath.replace(/^[/\\]+/, "");
  return path.join(rootDir, candidate);
}

const server = http.createServer((req, res) => {
  const filePath = resolveFile(req.url || "/");

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end(error.code === "ENOENT" ? "Not Found" : "Internal Server Error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    res.end(content);
  });
});

server.listen(port, () => {
  console.log(`[terminal] pronto em http://localhost:${port}`);
});
