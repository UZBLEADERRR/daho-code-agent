/** Workspace ichidagi faylni yoki papkani o'qiydi. input: {path} */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export default async function run(input, ctx) {
  const root = resolve(ctx.workspace || process.cwd());
  const target = resolve(root, input.path || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Workspace tashqarisini o\'qish taqiqlangan');
  if (!existsSync(target)) throw new Error('Topilmadi: ' + (rel || '.'));
  if (statSync(target).isDirectory()) {
    return { type: 'dir', entries: readdirSync(target, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() })) };
  }
  return { type: 'file', content: readFileSync(target, 'utf8').slice(0, 200000) };
}
