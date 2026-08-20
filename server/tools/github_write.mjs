/** Fayllarni bitta commit bilan repoga yozadi/o'chiradi.
 *  input: {repo, branch?, message?, files:[{path, content}|{path, delete:true}]} */
import { commitFiles, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo, branch } = target(input, ctx);
  const files = Array.isArray(input.files) ? input.files : (input.path ? [{ path: input.path, content: input.content }] : []);
  if (!files.length) throw new Error('files bo\'sh — nima yozilishini ko\'rsating');
  for (const f of files) if (!f.path) throw new Error('har bir faylda path bo\'lishi shart');
  return commitFiles({ owner, repo, branch, files, message: input.message, tok: token(ctx) });
}
