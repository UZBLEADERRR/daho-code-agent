/** Pull request. input: {repo, action:"list"|"create"|"merge"|"get", head?, base?, title?, body?, number?, draft?} */
import { gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo } = target(input, ctx);
  const action = input.action || 'list';

  if (action === 'list') {
    const list = await gh(`/repos/${owner}/${repo}/pulls?state=${input.state || 'open'}&per_page=30`, { tok: softToken(ctx) });
    return { pulls: list.map((p) => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, head: p.head.ref, url: p.html_url })) };
  }
  if (action === 'get') {
    const p = await gh(`/repos/${owner}/${repo}/pulls/${input.number}`, { tok: softToken(ctx) });
    return { number: p.number, title: p.title, state: p.state, mergeable: p.mergeable, mergeable_state: p.mergeable_state, url: p.html_url };
  }
  const tok = token(ctx);
  if (action === 'create') {
    if (!input.head) throw new Error('head (tarmoq nomi) majburiy');
    const info = await gh(`/repos/${owner}/${repo}`, { tok });
    const p = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST', tok,
      body: {
        title: input.title || `Daho: ${input.head}`,
        head: input.head,
        base: input.base || info.default_branch,
        body: input.body || '',
        draft: input.draft !== false,
      },
    });
    return { number: p.number, url: p.html_url, state: p.state };
  }
  if (action === 'merge') {
    const r = await gh(`/repos/${owner}/${repo}/pulls/${input.number}/merge`, {
      method: 'PUT', tok,
      body: { merge_method: input.method || 'squash' },
    });
    return { merged: r.merged, sha: r.sha };
  }
  throw new Error(`Noma'lum action: ${action}`);
}
