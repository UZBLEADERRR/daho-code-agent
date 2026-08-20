/** Kod qidiradi. input: {q, repo?} */
import { gh, softToken, target } from './_gh.mjs';

export default async function run(input, ctx) {
  if (!input.q) throw new Error('q majburiy');
  let q = input.q;
  if (input.repo) {
    const { owner, repo } = target(input, ctx);
    q += ` repo:${owner}/${repo}`;
  }
  const d = await gh(`/search/code?q=${encodeURIComponent(q)}&per_page=20`, { tok: softToken(ctx) });
  return {
    total: d.total_count,
    items: (d.items || []).map((i) => ({ path: i.path, repo: i.repository.full_name, url: i.html_url })),
  };
}
