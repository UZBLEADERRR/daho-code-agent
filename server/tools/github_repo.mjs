/** Repolar bilan ishlaydi. input: {action:"list"|"get"|"create"|"settings", repo?, name?, private?, description?, topics?} */
import { gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const action = input.action || 'list';

  if (action === 'list') {
    const list = await gh('/user/repos?per_page=100&sort=pushed', { tok: token(ctx) });
    return { repos: list.map((r) => ({ full_name: r.full_name, private: r.private, pushed_at: r.pushed_at, url: r.html_url })) };
  }
  if (action === 'get') {
    const { owner, repo } = target(input, ctx);
    const r = await gh(`/repos/${owner}/${repo}`, { tok: softToken(ctx) });
    return { full_name: r.full_name, default_branch: r.default_branch, private: r.private, url: r.html_url, description: r.description };
  }
  if (action === 'create') {
    const name = input.name || input.repo;
    if (!name) throw new Error('name majburiy');
    const r = await gh('/user/repos', {
      method: 'POST', tok: token(ctx),
      body: {
        name: name.split('/').pop(),
        private: input.private !== false,
        description: input.description || 'Daho miya yaratgan loyiha',
        auto_init: true,
      },
    });
    return { full_name: r.full_name, url: r.html_url, default_branch: r.default_branch };
  }
  if (action === 'settings') {
    const { owner, repo } = target(input, ctx);
    const tok = token(ctx);
    const out = {};
    if (input.description !== undefined || input.private !== undefined) {
      const r = await gh(`/repos/${owner}/${repo}`, {
        method: 'PATCH', tok,
        body: { description: input.description, private: input.private },
      });
      out.updated = r.full_name;
    }
    if (Array.isArray(input.topics)) {
      await gh(`/repos/${owner}/${repo}/topics`, { method: 'PUT', tok, body: { names: input.topics } });
      out.topics = input.topics;
    }
    return out;
  }
  throw new Error(`Noma'lum action: ${action}`);
}
