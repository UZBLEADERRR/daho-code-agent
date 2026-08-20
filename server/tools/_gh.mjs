// GitHub REST yordamchisi — barcha github_* toollari shu fayldan foydalanadi.
// GitHub Enterprise yoki test uchun manzilni almashtirish mumkin.
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
export const apiBase = () => API;

export function token(ctx) {
  const t = ctx?.env?.GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!t) throw new Error('GitHub tokeni yo\'q — sozlamalarga GITHUB_TOKEN kiriting');
  return t;
}

/** Token talab qilmaydigan o'qish uchun (public repo). */
export function softToken(ctx) {
  return ctx?.env?.GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
}

export async function gh(path, { method = 'GET', body, tok, raw = false } = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: {
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'daho-brain',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || String(data || res.statusText);
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** "owner/repo" yoki {owner, repo} ni ajratadi; berilmasa sozlamadagi standart. */
export function target(input, ctx) {
  const fallback = (ctx?.env?.GITHUB_REPO_FULL || process.env.GITHUB_REPO_FULL || '').trim();
  const raw = (input.repo && input.repo.includes('/') ? input.repo : null)
    || (input.owner && input.repo ? `${input.owner}/${input.repo}` : null)
    || fallback;
  if (!raw) throw new Error('repo ko\'rsatilmagan ("owner/repo" ko\'rinishida bering)');
  const [owner, repo] = raw.split('/');
  if (!owner || !repo) throw new Error(`repo formati noto'g'ri: ${raw}`);
  return { owner, repo, branch: input.branch || ctx?.env?.GITHUB_BRANCH || 'main' };
}

/** Bir nechta faylni BITTA commit bilan yuboradi (Git Data API). */
export async function commitFiles({ owner, repo, branch, files, message, tok }) {
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, { tok }).catch(() => null);
  let baseSha = ref?.object?.sha;
  let baseTree;

  if (!baseSha) {
    // Tarmoq yo'q — standart tarmoqdan ochamiz.
    const info = await gh(`/repos/${owner}/${repo}`, { tok });
    const head = await gh(`/repos/${owner}/${repo}/git/ref/heads/${info.default_branch}`, { tok });
    baseSha = head.object.sha;
    await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST', tok,
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    });
  }
  const baseCommit = await gh(`/repos/${owner}/${repo}/git/commits/${baseSha}`, { tok });
  baseTree = baseCommit.tree.sha;

  const tree = [];
  for (const f of files) {
    if (f.delete) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST', tok,
      body: { content: Buffer.from(String(f.content ?? ''), 'utf8').toString('base64'), encoding: 'base64' },
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST', tok,
    body: { base_tree: baseTree, tree },
  });
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST', tok,
    body: { message: message || 'Daho miya yangilanishi', tree: newTree.sha, parents: [baseSha] },
  });
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH', tok,
    body: { sha: commit.sha },
  });
  return { commit: commit.sha, files: files.length, branch };
}
