/** Issue. input: {repo, action:"list"|"create"|"comment"|"close", number?, title?, body?, labels?} */
import { gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo } = target(input, ctx);
  const action = input.action || 'list';

  if (action === 'list') {
    const list = await gh(`/repos/${owner}/${repo}/issues?state=${input.state || 'open'}&per_page=30`, { tok: softToken(ctx) });
    return { issues: list.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })) };
  }
  const tok = token(ctx);
  if (action === 'create') {
    const i = await gh(`/repos/${owner}/${repo}/issues`, {
      method: 'POST', tok,
      body: { title: input.title || 'Daho: yangi vazifa', body: input.body || '', labels: input.labels },
    });
    return { number: i.number, url: i.html_url };
  }
  if (action === 'comment') {
    const c = await gh(`/repos/${owner}/${repo}/issues/${input.number}/comments`, {
      method: 'POST', tok, body: { body: input.body || '' },
    });
    return { id: c.id, url: c.html_url };
  }
  if (action === 'close') {
    const i = await gh(`/repos/${owner}/${repo}/issues/${input.number}`, {
      method: 'PATCH', tok, body: { state: 'closed', state_reason: input.reason || 'completed' },
    });
    return { number: i.number, state: i.state };
  }
  throw new Error(`Noma'lum action: ${action}`);
}
