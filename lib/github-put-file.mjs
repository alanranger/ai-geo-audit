/**
 * Create or update one text file on GitHub (contents API).
 */
function token() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
}

function headers(tok) {
  return {
    Authorization: `Bearer ${tok}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-geo-audit'
  };
}

export async function getGithubFileText({ owner, repo, path, branch = 'main' }) {
  const tok = token();
  if (!tok) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, { headers: { ...headers(tok), Accept: 'application/vnd.github.v3.raw' } });
  if (!res.ok) return null;
  return res.text();
}

export async function putGithubFile({ owner, repo, path, content, message, branch = 'main' }) {
  const tok = token();
  if (!tok) throw new Error('missing_env:GITHUB_TOKEN');
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const get = await fetch(`${api}?ref=${branch}`, { headers: headers(tok) });
  let sha;
  if (get.ok) {
    const data = await get.json();
    sha = data.sha;
    const current = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
    if (current === content) return { ok: true, unchanged: true, sha };
  } else if (get.status !== 404) {
    throw new Error(`github_get:${get.status}:${(await get.text()).slice(0, 180)}`);
  }
  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...headers(tok), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!put.ok) throw new Error(`github_put:${put.status}:${(await put.text()).slice(0, 180)}`);
  const body = await put.json();
  return { ok: true, commit: body.commit?.sha, html_url: body.commit?.html_url, unchanged: false };
}
