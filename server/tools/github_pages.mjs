/** Loyihani GitHub Pages orqali internetga chiqaradi. input: {repo, branch?, path?, domain?} */
import { gh, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo, branch } = target(input, ctx);
  const tok = token(ctx);
  const source = { branch, path: input.path === '/docs' ? '/docs' : '/' };

  let pages = await gh(`/repos/${owner}/${repo}/pages`, { tok }).catch(() => null);
  if (!pages) {
    pages = await gh(`/repos/${owner}/${repo}/pages`, {
      method: 'POST', tok, body: { source },
    });
  } else {
    await gh(`/repos/${owner}/${repo}/pages`, { method: 'PUT', tok, body: { source } }).catch(() => {});
  }

  if (input.domain) {
    await gh(`/repos/${owner}/${repo}/pages`, {
      method: 'PUT', tok, body: { cname: input.domain, source },
    }).catch(() => {});
  }

  const fresh = await gh(`/repos/${owner}/${repo}/pages`, { tok }).catch(() => pages);
  return {
    url: fresh?.html_url || `https://${owner}.github.io/${repo}/`,
    status: fresh?.status || 'building',
    branch: source.branch,
    domain: input.domain || fresh?.cname || null,
    note: 'Pages qurilishi 1-2 daqiqa oladi',
  };
}
