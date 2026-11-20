import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import chat from '../api/chat.js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
else if (existsSync('.env')) process.loadEnvFile('.env');

const files = new Set(['/index.html', '/style.css', '/app.js', '/lib/crypto.js', '/favicon.svg', '/logo.png']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/chat') {
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) { res.writeHead(413).end(); return; }
      }
      req.body = body ? JSON.parse(body) : {};
    } catch { res.writeHead(400).end('Invalid JSON'); return; }
    res.status = (status) => { res.statusCode = status; return res; };
    res.json = (value) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    try { await chat(req, res); } catch { if (!res.headersSent) res.writeHead(500).end('Server error'); }
    return;
  }
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!files.has(file)) { res.writeHead(404).end('Not found'); return; }
  try {
    const content = await readFile(resolve('.' + file));
    res.writeHead(200, { 'Content-Type': types[extname(file)] });
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
const initialPort = Number(process.env.PORT) || 3000;
let port = initialPort;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < Math.min(initialPort + 10, 65535)) {
    console.log(`Port ${port} is in use; trying ${port + 1}...`);
    server.listen(++port, '127.0.0.1');
    return;
  }
  console.error(`Could not start the development server: ${error.message}`);
  process.exitCode = 1;
});
server.on('listening', () => console.log(`Ready at http://127.0.0.1:${server.address().port}`));
server.listen(port, '127.0.0.1');
