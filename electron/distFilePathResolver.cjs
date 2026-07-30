/**
 * Pure helpers for mapping a `dustweaver://app/...` request URL to a
 * filesystem path under `dist/`, and picking a Content-Type for it.
 *
 * Extracted from main.cjs so these can be unit-tested without requiring
 * the `electron` module (main.cjs calls Electron APIs at module load time,
 * so it cannot be `require()`d outside a running Electron process).
 */

const path = require("path");

function getContentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

/**
 * Maps a `dustweaver://app/<path>` request URL to an absolute filesystem
 * path under `<distDir>`. Returns null if the resolved path would escape
 * `distDir` (path-traversal guard).
 *
 * `baseDir` should be the directory this file lives in (`__dirname` from
 * main.cjs) so `distDir` resolves to `<repo>/dist` the same way in both
 * the real handler and tests.
 */
function resolveDistFilePath(url, baseDir) {
  const distDir = path.join(baseDir, "../dist");
  const parsedUrl = new URL(url);
  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(distDir, relativePath));
  const normalizedDistDir = path.normalize(distDir);
  if (filePath !== normalizedDistDir && !filePath.startsWith(normalizedDistDir + path.sep)) {
    return null;
  }
  return filePath;
}

module.exports = { getContentTypeForPath, resolveDistFilePath };
