import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import chat from '../api/chat.js';
import vault from '../api/vault.js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
else if (existsSync('.env')) process.loadEnvFile('.env');

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
const handlers = new Map([['/api/chat', chat], ['/api/vault', vault]]);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const handler = handlers.get(pathname);
  if (!handler) {
    vite.middlewares(req, res);
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  try {
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 100_000) { res.writeHead(413).end(); return; }
    }
    req.body = body ? JSON.parse(body) : {};
  } catch { res.writeHead(400).end('Invalid JSON'); return; }
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (value) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
  try { await handler(req, res); } catch { if (!res.headersSent) res.writeHead(500).end('Server error'); }
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
