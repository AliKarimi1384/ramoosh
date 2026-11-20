import http from 'node:http';
import https from 'node:https';

function singleProxyRequest(url, options, proxyUrl) {
  const u = new URL(url);
  const p = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: p.hostname,
      port: p.port,
      method: 'CONNECT',
      path: `${u.hostname}:${u.port || 443}`,
      signal: options.signal,
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with status ${res.statusCode}`));
        return;
      }
      const headers = { ...options.headers, Host: u.hostname, Connection: 'close' };
      const req = https.request({
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
        socket,
        agent: false,
        signal: options.signal,
      }, (resp) => {
        const text = async () => {
          let data = '';
          resp.setEncoding('utf8');
          for await (const chunk of resp) data += chunk;
          return data;
        };
        resolve({
          ok: resp.statusCode >= 200 && resp.statusCode < 300,
          status: resp.statusCode,
          body: resp,
          json: async () => JSON.parse(await text()),
          text,
        });
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

/**
 * Executes a fetch request, prioritizing direct fetch (and respecting mocked fetch in tests).
 * When direct fetch fails due to network/firewall blocks, falls back to an HTTP proxy tunnel.
 */
export async function resilientFetch(url, options = {}, retries = 2) {
  try {
    return await globalThis.fetch(url, options);
  } catch (err) {
    if (options.signal?.aborted) throw err;
    const proxyUrl = process.env.GROQ_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:10809';
    if (!proxyUrl) throw err;

    let lastError = err;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await singleProxyRequest(url, options, proxyUrl);
      } catch (proxyErr) {
        lastError = proxyErr;
        if (options.signal?.aborted) throw proxyErr;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
    throw lastError;
  }
}
