/** Reliz. input: {repo, action:"list"|"create"|"latest", tag?, name?, body?, draft?} */
import { gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo } = target(input, ctx);
  const action = input.action || 'list';

  if (action === 'list') {
    const list = await gh(`/repos/${owner}/${repo}/releases?per_page=20`, { tok: softToken(ctx) });
    return { releases: list.map((r) => ({ tag: r.tag_name, name: r.name, url: r.html_url, assets: r.assets.map((a) => a.name) })) };
  }
  if (action === 'latest') {
    const r = await gh(`/repos/${owner}/${repo}/releases/latest`, { tok: softToken(ctx) });
    return { tag: r.tag_name, name: r.name, url: r.html_url, assets: r.assets.map((a) => ({ name: a.name, url: a.browser_download_url })) };
  }
  if (action === 'create') {
    if (!input.tag) throw new Error('tag majburiy');
    const r = await gh(`/repos/${owner}/${repo}/releases`, {
      method: 'POST', tok: token(ctx),
      body: { tag_name: input.tag, name: input.name || input.tag, body: input.body || '', draft: Boolean(input.draft) },
    });
    return { tag: r.tag_name, url: r.html_url };
  }
  throw new Error(`Noma'lum action: ${action}`);
}
