/**
 * Loyihani HAQIQATAN ishga tushirib sinaydi: headless brauzerda ochib, JS xatolarini,
 * sahifa bo'sh chiqqanini, qaysi tugma/maydon chizilganini qaytaradi.
 * input: {entry?: "index.html", dir?: "loyiha_papkasi", wait?: 2000}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
];

function findChrome() {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(pw)) {
    for (const d of readdirSync(pw)) {
      const p = join(pw, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const HARNESS = `<script>(function(){
  var box=document.createElement('script');
  box.type='application/json'; box.id='__daho_probe';
  var data={errors:[],warnings:[],logs:[]};
  function dump(){ try{ box.textContent=JSON.stringify(data); }catch(e){} }
  function push(list,m){ if(list.length<15) list.push(String(m).slice(0,400)); dump(); }
  window.onerror=function(m,s,l,c){ push(data.errors, m+(l?' ('+l+':'+c+')':'')); };
  window.addEventListener('unhandledrejection',function(e){
    push(data.errors,'Promise: '+((e.reason&&(e.reason.message||e.reason))||'nomalum'));
  });
  var ce=console.error, cw=console.warn, cl=console.log;
  console.error=function(){ push(data.errors,[].join.call(arguments,' ')); ce.apply(console,arguments); };
  console.warn=function(){ push(data.warnings,[].join.call(arguments,' ')); cw.apply(console,arguments); };
  console.log=function(){ push(data.logs,[].join.call(arguments,' ')); cl.apply(console,arguments); };
  document.addEventListener('DOMContentLoaded',function(){ document.documentElement.appendChild(box); dump(); });
  if(document.readyState!=='loading'){ document.documentElement.appendChild(box); dump(); }
})();</script>`;

/** style.css va app.js kabi mahalliy fayllarni sahifa ichiga singdiradi. */
function bundle(html, baseDir) {
  const readLocal = (src) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return null;
    const file = resolve(baseDir, src.split('?')[0]);
    const rel = relative(baseDir, file);
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) return null;
    return readFileSync(file, 'utf8');
  };
  let out = html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (m, src) => {
    const css = readLocal(src);
    return css ? `<style>\n${css}\n</style>` : m;
  });
  out = out.replace(/<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi, (m, a, src, b) => {
    const js = readLocal(src);
    if (!js) return m;
    const type = /type=["']module["']/.test(a + b) ? ' type="module"' : '';
    return `<script${type}>\n${js}\n</script>`;
  });
  return out;
}

const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const many = (dom, re, take = (m) => strip(m[1] || '')) => {
  const out = [];
  let m;
  while ((m = re.exec(dom)) && out.length < 20) {
    const v = take(m);
    if (v) out.push(v.slice(0, 80));
  }
  return [...new Set(out)];
};

export default async function run(input, ctx) {
  const root = resolve(ctx.workspace || process.cwd());
  const baseDir = input.dir ? resolve(root, input.dir) : root;
  const rel = relative(root, baseDir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Workspace tashqarisi taqiqlangan');

  const entry = input.entry || 'index.html';
  const entryFile = resolve(baseDir, entry);
  if (!existsSync(entryFile)) throw new Error(`Fayl topilmadi: ${entry} (${rel || '.'} ichida)`);

  const wait = Math.min(Math.max(Number(input.wait) || 1800, 500), 8000);
  const chrome = findChrome();

  if (!chrome) {
    // Brauzer yo'q — hech bo'lmasa JS sintaksisini tekshiramiz va nima yetishmayotganini aytamiz.
    const checked = [];
    for (const f of readdirSync(baseDir)) {
      if (!f.endsWith('.js')) continue;
      try {
        execFileSync(process.execPath, ['--check', join(baseDir, f)], { stdio: 'pipe' });
        checked.push({ file: f, ok: true });
      } catch (e) {
        checked.push({ file: f, ok: false, error: String(e.stderr || e.message).split('\n').slice(0, 3).join(' ') });
      }
    }
    return {
      rendered: false,
      reason: 'Serverda headless brauzer topilmadi — CHROME_PATH o\'rnating yoki chromium o\'rnating',
      syntaxCheck: checked,
      ok: checked.every((c) => c.ok),
    };
  }

  const bundled = bundle(readFileSync(entryFile, 'utf8'), dirname(entryFile));
  const prepared = /<head[^>]*>/i.test(bundled)
    ? bundled.replace(/<head[^>]*>/i, (m) => m + HARNESS)
    : HARNESS + bundled;

  const tmp = mkdtempSync(join(tmpdir(), 'daho-probe-'));
  const page = join(tmp, 'page.html');
  writeFileSync(page, prepared);

  let dom = '';
  let crash = null;
  try {
    dom = execFileSync(chrome, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--hide-scrollbars', '--no-first-run', '--disable-extensions',
      `--virtual-time-budget=${wait}`, '--dump-dom', `file://${page}`,
    ], { encoding: 'utf8', timeout: wait + 20000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    dom = String(e.stdout || '');
    crash = String(e.message || '').slice(0, 300);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  let probe = { errors: [], warnings: [], logs: [] };
  const raw = dom.match(/<script[^>]*id="__daho_probe"[^>]*>([\s\S]*?)<\/script>/i);
  if (raw) {
    try { probe = JSON.parse(raw[1]); } catch { /* buzilgan JSON */ }
  }

  const body = (dom.match(/<body[\s\S]*<\/body>/i) || [dom])[0];
  const text = strip(body);
  const nodes = (body.match(/<[a-z][^>]*>/gi) || []).length;

  return {
    ok: !crash && probe.errors.length === 0 && text.length > 0,
    rendered: true,
    title: (dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim(),
    errors: probe.errors,
    warnings: probe.warnings.slice(0, 5),
    logs: probe.logs.slice(0, 5),
    headings: many(body, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi),
    buttons: many(body, /<button[^>]*>([\s\S]*?)<\/button>/gi),
    inputs: many(body, /<(?:input|textarea|select)([^>]*)>/gi, (m) =>
      (m[1].match(/(?:placeholder|name|id)=["']([^"']+)["']/) || [, ''])[1]),
    text: text.slice(0, 600),
    nodes,
    empty: nodes < 3 || text.length === 0,
    crash,
  };
}
