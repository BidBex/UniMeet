#!/usr/bin/env node
/**
 * Layout smoke test for the built site (run by .github/workflows/layout-check.yml).
 *
 * Opens every page of the production build at phone, tablet and desktop widths as a
 * logged-out visitor and fails if any page:
 *   - scrolls sideways (document wider than the screen),
 *   - has a broken image,
 *   - fails to load one of its own files (HTML/CSS/JS/images, HTTP >= 400),
 *   - throws an uncaught JavaScript error.
 *
 * Usage: npm run build && node scripts/check-layout.mjs [baseUrl]
 * Without a baseUrl the script serves ./dist itself on a free local port.
 * Requires the `playwright` package and a Chromium browser (npx playwright install chromium).
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

/** Minimal static file server for ./dist (no directory listing, no path traversal). */
function serveDist() {
  if (!existsSync(path.join(DIST_DIR, "index.html"))) {
    console.error("dist/index.html not found: run `npm run build` first.");
    process.exit(1);
  }
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const filePath = path.resolve(DIST_DIR, `.${urlPath === "/" ? "/index.html" : urlPath}`);
    if (!filePath.startsWith(DIST_DIR + path.sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = process.argv[2] ? null : await serveDist();
const BASE_URL = (process.argv[2] || `http://127.0.0.1:${server.address().port}/`).replace(/\/?$/, "/");
const PAGES = [
  "index", "login", "register", "reset-password", "events", "discover", "groups",
  "feed", "matches", "messages", "profile", "settings", "create-event",
];
const WIDTHS = [320, 360, 768, 1440];
const SETTLE_MS = 1500;

const browser = await chromium.launch();
const failures = [];
let checks = 0;

try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (err) => problems.push(`JS error: ${err.message}`));
    page.on("response", (res) => {
      if (res.url().startsWith(BASE_URL) && res.status() >= 400) {
        problems.push(`HTTP ${res.status()}: ${res.url().slice(BASE_URL.length - 1)}`);
      }
    });

    for (const name of PAGES) {
      problems.length = 0;
      checks += 1;
      await page.goto(`${BASE_URL}${name}.html`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      // Scroll through the page so lazy-loaded images load before they are checked.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(500);

      const result = await page.evaluate(() => ({
        path: location.pathname.split("/").pop(),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        brokenImages: [...document.images]
          .filter((img) => img.getAttribute("src") && img.complete && img.naturalWidth === 0)
          .map((img) => img.getAttribute("src")),
      }));

      if (result.scrollWidth > result.clientWidth + 1) {
        problems.push(`scrolls sideways: ${result.scrollWidth}px content in ${result.clientWidth}px screen`);
      }
      for (const src of result.brokenImages) problems.push(`broken image: ${src}`);

      const label = `${name}.html @ ${width}px${result.path !== `${name}.html` ? ` (redirected to ${result.path})` : ""}`;
      if (problems.length) {
        failures.push(`${label}\n    - ${[...new Set(problems)].join("\n    - ")}`);
        console.log(`FAIL ${label}`);
      } else {
        console.log(`ok   ${label}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server?.close();
}

console.log(`\n${checks} page checks, ${failures.length} failed.`);
if (failures.length) {
  console.error(`\nLayout check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
