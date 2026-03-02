import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

const TIMEOUT_MS = 15000;

// Node.js 16 compatible HTTP helper
function request(urlStr, options = {}, bodyStr = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const fn = isHttps ? httpsRequest : httpRequest;

    const req = fn({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
    }, resolve);

    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('請求逾時')));
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function readBody(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function execute(skillName, parameters) {
  switch (skillName) {
    case 'fetch_url':
      return fetchUrl(parameters.url);
    case 'post_request':
      return postRequest(parameters.url, parameters.body);
    default:
      throw new Error(`[web] 未知技能: ${skillName}`);
  }
}

async function fetchUrl(url) {
  if (!url) throw new Error('url 參數為必填');

  const res = await request(url, {
    headers: { 'User-Agent': 'SkillAgent/1.0' },
  });

  const contentType = res.headers['content-type'] ?? '';
  let body = await readBody(res);

  if (contentType.includes('application/json')) {
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* use raw */ }
  } else if (body.length > 3000) {
    body = body.slice(0, 3000) + '\n... (內容已截斷)';
  }

  return `HTTP ${res.statusCode}\nContent-Type: ${contentType}\n\n${body}`;
}

async function postRequest(url, body = {}) {
  if (!url) throw new Error('url 參數為必填');

  const bodyStr = JSON.stringify(body);
  const res = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'User-Agent': 'SkillAgent/1.0',
    },
  }, bodyStr);

  const contentType = res.headers['content-type'] ?? '';
  let resBody = await readBody(res);

  if (contentType.includes('application/json')) {
    try { resBody = JSON.stringify(JSON.parse(resBody), null, 2); } catch { /* use raw */ }
  }

  return `HTTP ${res.statusCode}\n\n${resBody}`;
}
