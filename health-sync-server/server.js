#!/usr/bin/env node
'use strict';
/*
 * 健康紀錄 App 的雲端同步伺服器（不需安裝任何套件，Node.js 18+）
 *
 *   node server.js
 *
 * 伺服器只保存「加密後的資料」與「存取權杖的雜湊」，無法得知內容或帳號名稱。
 * 同時也會提供 ../health-tracker 的網頁，讓手機直接連這台伺服器使用 App。
 *
 * 環境變數：
 *   PORT        監聽埠（預設 8787）
 *   HOST        監聽位址（預設 0.0.0.0）
 *   DATA_DIR    資料存放資料夾（預設 ./data）
 *   STATIC_DIR  App 網頁資料夾（預設 ../health-tracker；設為空字串則不提供網頁）
 *   MAX_BYTES   單一保險箱大小上限（預設 10 MB）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const STATIC_DIR = process.env.STATIC_DIR === '' ? null : path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'health-tracker'));
const MAX_BYTES = Number(process.env.MAX_BYTES) || 10 * 1024 * 1024;

const ID_RE = /^[a-f0-9]{64}$/;
const TOKEN_RE = /^Bearer ([a-f0-9]{64})$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

/* 簡單的暴力破解防護：每個 IP 10 分鐘內最多 20 次驗證失敗 */
const failures = new Map();
const FAIL_WINDOW = 10 * 60e3, FAIL_LIMIT = 20;
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > FAIL_WINDOW) return false;
  return f.count >= FAIL_LIMIT;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > FAIL_WINDOW) failures.set(ip, { since: Date.now(), count: 1 });
  else f.count++;
}
setInterval(() => {
  for (const [ip, f] of failures) if (Date.now() - f.since > FAIL_WINDOW) failures.delete(ip);
}, FAIL_WINDOW).unref();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const vaultPath = (id) => path.join(DATA_DIR, `${id}.json`);

function readVault(id) {
  try {
    return JSON.parse(fs.readFileSync(vaultPath(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function writeVault(id, vault) {
  const file = vaultPath(id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault), { mode: 0o600 });
  fs.renameSync(tmp, file); // 原子性寫入，避免寫到一半的檔案
}

function authorized(vault, token) {
  const a = Buffer.from(vault.authHash, 'hex');
  const b = Buffer.from(sha256(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body, headers = {}) {
  const data = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleVault(req, res, id) {
  const ip = req.socket.remoteAddress;
  if (tooManyFailures(ip)) return send(res, 429, { error: 'too many attempts' });
  const m = TOKEN_RE.exec(req.headers.authorization || '');
  if (!m) return send(res, 401, { error: 'missing token' });
  const token = m[1];
  const vault = readVault(id);

  if (vault && !authorized(vault, token)) {
    recordFailure(ip);
    return send(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    if (!vault) return send(res, 404, { error: 'not found' });
    return send(res, 200, { version: vault.version, updatedAt: vault.updatedAt, iv: vault.iv, ct: vault.ct });
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: e.status ? 'too large' : 'invalid json' });
    }
    if (typeof body.iv !== 'string' || typeof body.ct !== 'string' || body.iv.length > 64) {
      return send(res, 400, { error: 'invalid payload' });
    }
    const expected = Number(req.headers['if-match']);
    if (!Number.isInteger(expected)) return send(res, 428, { error: 'If-Match version required' });
    // 樂觀鎖：版本不符代表其他裝置剛更新過，請客戶端重新合併
    const current = vault ? vault.version : 0;
    if (expected !== current) return send(res, 409, { error: 'version conflict', version: current });
    const next = {
      authHash: vault ? vault.authHash : sha256(token),
      version: current + 1,
      updatedAt: new Date().toISOString(),
      iv: body.iv,
      ct: body.ct,
    };
    writeVault(id, next);
    return send(res, vault ? 200 : 201, { version: next.version, updatedAt: next.updatedAt });
  }

  if (req.method === 'DELETE') {
    if (!vault) return send(res, 404, { error: 'not found' });
    fs.unlinkSync(vaultPath(id));
    return send(res, 204, null);
  }

  return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, PUT, DELETE' });
}

function serveStatic(req, res, pathname) {
  if (!STATIC_DIR || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not found' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'bad path' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, '.' + path.posix.normalize(rel));
  if (!file.startsWith(STATIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  // 允許 App 放在其他網域（例如 GitHub Pages）時跨網域同步；驗證靠 Bearer 權杖，不使用 cookie
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return send(res, 204, null);

  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, { error: 'bad url' }); }

  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true });
    const m = /^\/api\/vault\/([^/]+)$/.exec(pathname);
    if (m) {
      if (!ID_RE.test(m[1])) return send(res, 400, { error: 'invalid id' });
      return await handleVault(req, res, m[1]);
    }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`健康紀錄同步伺服器已啟動：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`資料夾：${DATA_DIR}`);
  if (STATIC_DIR) console.log(`App 網頁：${STATIC_DIR}`);
});
