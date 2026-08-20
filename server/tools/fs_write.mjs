/** Workspace ichiga fayl yozadi. input: {path, content, append?} */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

export default async function run(input, ctx) {
  const root = resolve(ctx.workspace || process.cwd());
  const target = resolve(root, input.path || '');
  const rel = relative(root, target);
  if (!input.path || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Workspace tashqarisiga yozish taqiqlangan');
  mkdirSync(dirname(target), { recursive: true });
  const content = typeof input.content === 'string' ? input.content : JSON.stringify(input.content, null, 2);
  if (input.append) appendFileSync(target, content);
  else writeFileSync(target, content);
  return { path: rel, bytes: Buffer.byteLength(content) };
}
