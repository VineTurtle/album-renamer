#!/usr/bin/env node
/**
 * 图册批量重命名 — 本地服务
 * 零依赖，只监听 127.0.0.1：读目录、发原图、执行重命名/复制/移动、写撤销日志。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.PORT) || 8787;
const NO_OPEN = process.env.NO_OPEN === '1' || process.argv.includes('--no-open');

const IMAGE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff',
  '.avif', '.heic', '.heif', '.jfif'
]);
const IGNORE = new Set(['desktop.ini', 'thumbs.db', '.ds_store', 'ehthumbs.db']);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif', '.jfif': 'image/jpeg',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ------------------------------- 基础工具 ------------------------------- */

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function listDrives() {
  if (process.platform !== 'win32') return ['/'];
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try {
      fs.accessSync(d);
      out.push(d);
    } catch { /* 不存在 */ }
  }
  return out;
}

/* ------------------------------- 目录读取 ------------------------------- */

async function listDir(dir, imagesOnly) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = entries.filter(
    (e) =>
      e.isFile() &&
      !IGNORE.has(e.name.toLowerCase()) &&
      !e.name.startsWith('_rename-log-') &&
      !e.name.startsWith('.ren-tmp-')
  );
  const out = [];
  for (const e of files) {
    const full = path.join(dir, e.name);
    let st;
    try {
      st = await fsp.stat(full);
    } catch {
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    out.push({
      name: e.name,
      path: full,
      size: st.size,
      mtime: st.mtimeMs,
      ext,
      isImage: IMAGE_EXT.has(ext)
    });
  }
  if (imagesOnly) return out.filter((f) => f.isImage);
  return out;
}

/* ------------------------------- 命名校验 ------------------------------- */

function validateName(name) {
  if (!name) return '文件名不能为空';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return '包含 Windows 非法字符';
  if (/[. ]$/.test(name)) return '不能以空格或点结尾';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) return 'Windows 保留名称';
  if (Buffer.byteLength(name, 'utf8') > 240) return '文件名过长';
  return null;
}

/* ------------------------------- 执行重命名 ------------------------------- */

/** 原地重命名：两阶段（先全部改临时名，再改目标名），支持互换/轮转 */
async function renameInPlace(dir, pairs) {
  const ops = pairs.filter((p) => p.from !== p.to);
  if (!ops.length) return { done: 0 };

  const existing = new Set((await fsp.readdir(dir)).map((n) => n.toLowerCase()));
  const vacating = new Set(pairs.map((p) => p.from.toLowerCase()));

  for (const p of ops) {
    if (!fs.existsSync(path.join(dir, p.from))) throw new Error(`源文件不存在：${p.from}`);
    const key = p.to.toLowerCase();
    if (existing.has(key) && !vacating.has(key)) throw new Error(`目标已存在：${p.to}`);
  }

  const temps = [];
  try {
    for (const p of ops) {
      const tmp = path.join(dir, `.ren-tmp-${randomUUID()}`);
      await fsp.rename(path.join(dir, p.from), tmp);
      temps.push({ tmp, p, done: false });
    }
    for (const t of temps) {
      await fsp.rename(t.tmp, path.join(dir, t.p.to));
      t.done = true;
    }
    return { done: ops.length };
  } catch (e) {
    for (const t of temps.reverse()) {
      try {
        if (t.done) await fsp.rename(path.join(dir, t.p.to), t.tmp);
        await fsp.rename(t.tmp, path.join(dir, t.p.from));
      } catch { /* 尽力回滚 */ }
    }
    throw e;
  }
}

async function copyToDir(srcDir, destDir, pairs) {
  await fsp.mkdir(destDir, { recursive: true });
  const existing = new Set((await fsp.readdir(destDir)).map((n) => n.toLowerCase()));
  const created = [];
  try {
    for (const p of pairs) {
      if (!fs.existsSync(path.join(srcDir, p.from))) throw new Error(`源文件不存在：${p.from}`);
      if (existing.has(p.to.toLowerCase())) throw new Error(`目标已存在：${p.to}`);
      const to = path.join(destDir, p.to);
      await fsp.copyFile(path.join(srcDir, p.from), to, fs.constants.COPYFILE_EXCL);
      created.push(to);
    }
  } catch (e) {
    for (const f of created) {
      try {
        await fsp.unlink(f);
      } catch { /* ignore */ }
    }
    throw e;
  }
  return created;
}

async function moveOne(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(from);
  }
}

async function writeLog(destDir, mode, srcDir, items) {
  const log = {
    version: 1,
    id: randomUUID(),
    time: new Date().toISOString(),
    mode,
    srcDir,
    destDir,
    undone: false,
    items
  };
  const logPath = path.join(destDir, `_rename-log-${stamp()}-${randomUUID().slice(0, 4)}.json`);
  await fsp.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
  return logPath;
}

async function handleRename(body) {
  const mode = body.mode === 'copy' || body.mode === 'move' ? body.mode : 'rename';
  const srcDir = path.resolve(String(body.srcDir || ''));
  const items = Array.isArray(body.items) ? body.items : [];
  const destDir = mode === 'rename' ? srcDir : path.resolve(String(body.destDir || ''));

  if (!items.length) return { ok: false, error: '没有需要处理的文件' };
  if (!fs.existsSync(srcDir)) return { ok: false, error: '源文件夹不存在' };
  if (mode !== 'rename') {
    if (!body.destDir) return { ok: false, error: '请选择目标文件夹' };
    if (destDir === srcDir) return { ok: false, error: '目标文件夹不能与源文件夹相同' };
  }

  const pairs = items.map((i) => ({ from: String(i.from || ''), to: String(i.to || '') }));
  const errors = [];
  const seen = new Set();
  const vacating = new Set(pairs.map((p) => p.from.toLowerCase()));

  let existing = new Set();
  if (mode === 'rename') {
    existing = new Set((await fsp.readdir(srcDir)).map((n) => n.toLowerCase()));
  } else {
    await fsp.mkdir(destDir, { recursive: true });
    existing = new Set((await fsp.readdir(destDir)).map((n) => n.toLowerCase()));
  }

  for (const p of pairs) {
    if (!p.from || !p.to) {
      errors.push('存在空文件名');
      continue;
    }
    if (p.to.includes('/') || p.to.includes('\\')) {
      errors.push(`非法的目标名称：${p.to}`);
      continue;
    }
    const bad = validateName(p.to);
    if (bad) {
      errors.push(`${p.to}：${bad}`);
      continue;
    }
    const key = p.to.toLowerCase();
    if (seen.has(key)) errors.push(`新文件名重复：${p.to}`);
    seen.add(key);
    if (existing.has(key) && (mode !== 'rename' || !vacating.has(key))) errors.push(`目标已存在：${p.to}`);
    if (!fs.existsSync(path.join(srcDir, p.from))) errors.push(`源文件不存在：${p.from}`);
  }
  if (errors.length) {
    return { ok: false, error: '检测到冲突，未执行任何操作', details: errors.slice(0, 60) };
  }

  const logItems = pairs.map((p) => ({
    from: path.join(srcDir, p.from),
    to: path.join(destDir, p.to)
  }));

    if (mode === 'rename') {
      const r = await renameInPlace(srcDir, pairs);
      let logPath = '';
      try {
        logPath = await writeLog(srcDir, 'rename', srcDir, logItems);
      } catch { /* 日志写入失败不影响重命名结果 */ }
      return { ok: true, count: r.done, logPath, mode };
    }

    await copyToDir(srcDir, destDir, pairs);
    if (mode === 'move') {
      for (const p of pairs) {
        await fsp.unlink(path.join(srcDir, p.from));
      }
    }
    let copyLog = '';
    try {
      copyLog = await writeLog(destDir, mode, srcDir, logItems);
    } catch { /* ignore */ }
    return { ok: true, count: pairs.length, logPath: copyLog, mode, destDir };
}

/* ------------------------------- 撤销 ------------------------------- */

async function handleUndo(body) {
  const logPath = body.logPath ? path.resolve(String(body.logPath)) : '';
  if (!logPath || !fs.existsSync(logPath)) return { ok: false, error: '找不到撤销记录' };

  let log;
  try {
    log = JSON.parse(await fsp.readFile(logPath, 'utf8'));
  } catch {
    return { ok: false, error: '撤销记录已损坏' };
  }
  if (log.undone) return { ok: false, error: '这次操作已经撤销过了' };

  let count = 0;
  if (log.mode === 'rename') {
    const pairs = log.items.map((i) => ({ from: path.basename(i.to), to: path.basename(i.from) }));
    const r = await renameInPlace(log.destDir, pairs);
    count = r.done;
  } else if (log.mode === 'copy') {
    for (const i of log.items) {
      if (fs.existsSync(i.to)) {
        await fsp.unlink(i.to);
        count++;
      }
    }
  } else if (log.mode === 'move') {
    for (const i of log.items) {
      if (fs.existsSync(i.to)) {
        await moveOne(i.to, i.from);
        count++;
      }
    }
  } else {
    return { ok: false, error: '未知的操作类型' };
  }

  log.undone = true;
  log.undoneAt = new Date().toISOString();
  await fsp.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
  return { ok: true, count, mode: log.mode };
}

async function findLogs(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const names = (await fsp.readdir(dir))
    .filter((n) => n.startsWith('_rename-log-') && n.endsWith('.json'))
    .sort()
    .reverse();
  return names.slice(0, 20).map((n) => path.join(dir, n));
}

/* ------------------------------- HTTP 路由 ------------------------------- */

function serveFile(res, file) {
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('文件不存在：' + file);
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const hostName = String(req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]', ''].includes(hostName)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      serveFile(res, path.join(HERE, 'index.html'));
      return;
    }
    if (req.method === 'GET' && (p === '/app.css' || p === '/app.js' || p === '/favicon.svg')) {
      serveFile(res, path.join(HERE, p.slice(1)));
      return;
    }

    if (p === '/api/info') {
      const arg = process.argv[2];
      const initial = arg && fs.existsSync(arg) ? path.resolve(arg) : '';
      json(res, 200, { ok: true, initialPath: initial, drives: listDrives() });
      return;
    }

    if (p === '/api/list' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      if (!dir) return json(res, 400, { ok: false, error: '缺少目录参数' });
      const imagesOnly = url.searchParams.get('images') === '1';
      const entries = await listDir(path.resolve(dir), imagesOnly);
      return json(res, 200, { ok: true, dir: path.resolve(dir), entries });
    }

    if (p === '/api/raw' && req.method === 'GET') {
      const file = url.searchParams.get('path');
      if (!file) return json(res, 400, { ok: false, error: '缺少文件参数' });
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        return json(res, 404, { ok: false, error: '文件不存在' });
      }
      if (!st.isFile()) return json(res, 404, { ok: false, error: '不是文件' });
      const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        ETag: etag,
        'Cache-Control': 'private, max-age=0, must-revalidate'
      });
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (p === '/api/browse' && req.method === 'GET') {
      const raw = url.searchParams.get('path') || '';
      const drives = listDrives();
      if (!raw) return json(res, 200, { ok: true, path: '', parent: null, dirs: [], drives });
      const dir = path.resolve(raw);
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return json(res, 400, { ok: false, error: '无法读取该路径' });
      }
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      const parentPath = path.dirname(dir);
      return json(res, 200, {
        ok: true,
        path: dir,
        parent: parentPath === dir ? null : parentPath,
        dirs,
        drives
      });
    }

    if (p === '/api/logs' && req.method === 'GET') {
      const dir = url.searchParams.get('dir') || '';
      return json(res, 200, { ok: true, logs: await findLogs(dir) });
    }

    if (p === '/api/rename' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await handleRename(body);
      return json(res, 200, result);
    }

    if (p === '/api/undo' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await handleUndo(body);
      return json(res, 200, result);
    }

    if (p === '/api/open' && req.method === 'POST') {
      const body = await readBody(req);
      const dir = path.resolve(String(body.dir || ''));
      if (!fs.existsSync(dir)) return json(res, 400, { ok: false, error: '文件夹不存在' });
      execFile('explorer.exe', [dir], () => {});
      return json(res, 200, { ok: true });
    }

    json(res, 404, { ok: false, error: '接口不存在' });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

/* ------------------------------- 启动 ------------------------------- */

function listen(port, attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 10) {
      listen(port + 1, attempt + 1);
    } else {
      console.error('启动失败：', e.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    console.log('');
    console.log('  图册批量重命名已启动');
    console.log('  ' + url);
    console.log('  关闭此窗口即可退出');
    console.log('');
    if (!NO_OPEN && process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], () => {});
    }
  });
}

listen(BASE_PORT);
