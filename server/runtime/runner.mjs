// Tool jarayoni: alohida Node protsessida ishlaydi, natijani stdout'ga JSON qilib chiqaradi.
const [, , toolPath] = process.argv;

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

const payload = input ? JSON.parse(input) : {};
const finish = (obj) => {
  process.stdout.write('\n__DAHO_RESULT__' + JSON.stringify(obj));
  process.exit(0);
};

try {
  const mod = await import(toolPath);
  const run = mod.default || mod.run;
  if (typeof run !== 'function') throw new Error("Tool 'default' funksiyani eksport qilmaydi");
  const ctx = {
    env: payload.env || {},
    workspace: payload.workspace,
    log: (...a) => console.log(...a),
  };
  const value = await run(payload.input ?? {}, ctx);
  finish({ ok: true, value });
} catch (error) {
  finish({ ok: false, error: String(error?.stack || error?.message || error) });
}
