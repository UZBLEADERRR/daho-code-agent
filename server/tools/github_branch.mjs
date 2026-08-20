/** Tarmoqlar. input: {repo, action:"list"|"create", name?, from?} */
import { gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo } = target(input, ctx);
  if ((input.action || 'list') === 'list') {
    const list = await gh(`/repos/${owner}/${repo}/branches?per_page=100`, { tok: softToken(ctx) });
    return { branches: list.map((b) => ({ name: b.name, sha: b.commit.sha })) };
  }
  const tok = token(ctx);
  const name = input.name;
  if (!name) throw new Error('name majburiy');
  const info = await gh(`/repos/${owner}/${repo}`, { tok });
  const from = input.from || info.default_branch;
  const head = await gh(`/repos/${owner}/${repo}/git/ref/heads/${from}`, { tok });
  await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST', tok,
    body: { ref: `refs/heads/${name}`, sha: head.object.sha },
  });
  return { created: name, from, sha: head.object.sha };
}
