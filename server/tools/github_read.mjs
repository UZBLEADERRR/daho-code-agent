/** Repodagi fayl yoki papkani o'qiydi. input: {repo:"owner/repo", path?, branch?} */
import { gh, softToken, target } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo, branch } = target(input, ctx);
  const path = (input.path || '').replace(/^\/+/, '');
  const tok = softToken(ctx);
  const data = await gh(
    `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`,
    { tok }
  );
  if (Array.isArray(data)) {
    return { type: 'dir', path, entries: data.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })) };
  }
  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf8') : '';
  return { type: 'file', path: data.path, size: data.size, sha: data.sha, content: content.slice(0, 200000) };
}
