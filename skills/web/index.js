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

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SkillAgent/1.0' },
    signal: AbortSignal.timeout(15000),
  });

  const contentType = res.headers.get('content-type') ?? '';
  let body;
  if (contentType.includes('application/json')) {
    body = JSON.stringify(await res.json(), null, 2);
  } else {
    body = await res.text();
    // 截斷過長的 HTML
    if (body.length > 3000) body = body.slice(0, 3000) + '\n... (內容已截斷)';
  }

  return `HTTP ${res.status} ${res.statusText}\nContent-Type: ${contentType}\n\n${body}`;
}

async function postRequest(url, body = {}) {
  if (!url) throw new Error('url 參數為必填');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'SkillAgent/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const contentType = res.headers.get('content-type') ?? '';
  let resBody;
  if (contentType.includes('application/json')) {
    resBody = JSON.stringify(await res.json(), null, 2);
  } else {
    resBody = await res.text();
  }

  return `HTTP ${res.status} ${res.statusText}\n\n${resBody}`;
}
