/* Daho · Miya klienti — API kalitlar bu yerda saqlanmaydi, hammasi miya serverida. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const time = (t) => new Date(t).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

const cfg = {
  endpoint: '',
  token: '',
  ...JSON.parse(localStorage.getItem('daho.cfg') || '{}'),
};
const saveCfg = () => localStorage.setItem('daho.cfg', JSON.stringify(cfg));

let state = null;          // serverdan kelgan snapshot
let activeMissionId = null;
let online = false;
let events = null;

/* ------------------------------------------------------------------ helpers */

function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = 'toast ' + kind), 3000);
}

const base = () => cfg.endpoint.replace(/\/+$/, '');

async function api(path, { method = 'GET', body } = {}) {
  if (!cfg.endpoint) throw new Error('Backend endpoint kiritilmagan');
  const res = await fetch(base() + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { 'X-Daho-Token': cfg.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server xatosi ${res.status}`);
  return data;
}

function setOnline(ok) {
  online = ok;
  $('#linkChip').classList.toggle('on', ok);
  $('#linkState').textContent = ok ? 'online' : 'offline';
}

function setBrainMode(mode, label) {
  const orb = $('#orb');
  orb.className = 'orb ' + (mode || '');
  $('#orbMini').classList.toggle('busy', mode === 'busy');
  $('#brandState').textContent = label;
}

function navigate(target) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === target));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.target === target));
  $('.composer-zone').classList.toggle('hidden', target !== 'brain');
}

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<span class="av">${role === 'user' ? 'S' : '✦'}</span><div class="bubble">${esc(text)}</div>`;
  $('#feed').append(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/* ------------------------------------------------------------------- render */

const statusMap = {
  queued: ['wait', 'navbatda'],
  planning: ['run', 'reja'],
  running: ['run', 'ishlamoqda'],
  waiting_input: ['wait', 'javob kutmoqda'],
  done: ['done', 'tayyor'],
  failed: ['fail', 'to\'xtadi'],
};

function renderAll() {
  if (!state) return;
  renderHeader();
  renderMissions();
  renderTools();
  renderProviders();
  renderRouting();
  renderSettings();
  renderBlocker();
}

function renderHeader() {
  const tgOn = state.settings?.telegram?.enabled;
  $('#tgChip').classList.toggle('on', !!tgOn);
  $('#tgState').textContent = tgOn ? 'on' : 'off';
  $('#tgBadge').textContent = tgOn ? 'ulangan' : 'off';
  $('#tgBadge').className = 'badge ' + (tgOn ? 'done' : '');
}

function activeMission() {
  const list = state?.missions || [];
  return list.find((m) => m.id === activeMissionId) || list[0] || null;
}

function renderMissions() {
  const list = state.missions || [];
  const sel = $('#missionPick');
  sel.innerHTML = list.length
    ? list.map((m) => `<option value="${m.id}">${esc(m.goal.slice(0, 40))}</option>`).join('')
    : '<option>Topshiriq yo\'q</option>';
  const m = activeMission();
  if (m) sel.value = m.id;

  const live = list.find((x) => ['running', 'planning', 'queued'].includes(x.status));
  const wait = list.find((x) => x.status === 'waiting_input');
  if (live) {
    setBrainMode('busy', 'ishlamoqda');
    $('#liveCard').classList.remove('hidden');
    $('#liveGoal').textContent = live.goal;
    $('#livePct').textContent = (live.progress || 0) + '%';
    $('#liveBar').style.width = (live.progress || 0) + '%';
    $('#liveStep').textContent = live.logs?.at(-1)?.text || 'Boshlanmoqda...';
  } else if (wait) {
    setBrainMode('wait', 'javob kutmoqda');
    $('#liveCard').classList.add('hidden');
  } else {
    setBrainMode(list[0]?.status === 'done' ? 'done' : '', list.length ? 'tayyor' : 'miya kutmoqda');
    $('#liveCard').classList.add('hidden');
  }

  if (!m) return;
  const [cls, label] = statusMap[m.status] || ['', m.status];
  $('#flowGoal').textContent = m.goal;
  $('#flowStatus').textContent = label;
  $('#flowStatus').className = 'badge ' + cls;
  $('#flowBar').style.width = (m.progress || 0) + '%';
  $('#flowType').textContent = '⌗ ' + (m.taskType || '—');
  $('#flowModel').textContent = '🤖 ' + (m.modelsUsed?.join(', ') || '—');
  $('#flowTime').textContent = '🕐 ' + time(m.createdAt);
  $('#flowUnderstanding').textContent = m.understanding || '';

  const steps = m.steps || [];
  $('#stepCount').textContent = steps.length ? `${steps.filter((s) => s.status === 'done').length}/${steps.length}` : '';
  $('#steps').innerHTML = steps.length
    ? steps.map((s) => `
      <li class="step ${s.status}">
        <span class="idx">${s.status === 'done' ? '✓' : s.n}</span>
        <div class="step-body">
          <strong>${esc(s.title)}</strong>
          <span class="step-tool">${esc(s.tool || 'llm')}${s.attempts > 1 ? ` · ${s.attempts} urinish` : ''}</span>
          ${s.result !== undefined ? `<p class="step-out">${esc(typeof s.result === 'string' ? s.result.slice(0, 400) : JSON.stringify(s.result).slice(0, 400))}</p>` : ''}
          ${s.error && s.status !== 'done' ? `<p class="step-out">⚠ ${esc(String(s.error).slice(0, 200))}</p>` : ''}
        </div>
      </li>`).join('')
    : '<li class="empty">Reja tuzilmoqda...</li>';

  $('#resultCard').classList.toggle('hidden', !m.result);
  $('#resultBody').textContent = m.result || '';

  const logs = m.logs || [];
  $('#logs').innerHTML = logs.length
    ? [...logs].reverse().map((l) => `<div class="log ${l.level}"><i>${l.level === 'ok' ? '✓' : l.level === 'error' ? '!' : l.level === 'warn' ? '⏸' : '›'}</i><p>${esc(l.text)}</p><time>${time(l.t)}</time></div>`).join('')
    : '<div class="empty">Loglar yo\'q</div>';
}

function renderBlocker() {
  const b = (state.blockers || [])[0];
  $('#blockerCard').classList.toggle('hidden', !b);
  if (!b) return;
  $('#blockerTitle').textContent = b.title;
  $('#blockerWhy').textContent = b.why || '';
  $('#blockerCard').dataset.id = b.id;
}

function renderTools() {
  const tools = state.tools || [];
  $('#statTools').textContent = tools.length;
  $('#statGenerated').textContent = tools.filter((t) => t.kind === 'generated').length;
  $('#statRuns').textContent = tools.reduce((a, t) => a + (t.runs || 0), 0);
  $('#toolList').innerHTML = tools.map((t) => `
    <div class="tool ${t.kind === 'generated' ? 'gen' : ''}" data-tool="${esc(t.name)}">
      <span class="tool-ico">${t.kind === 'generated' ? '✦' : '◈'}</span>
      <div class="tool-body">
        <strong>${esc(t.name)}</strong>
        <p>${esc(t.description)}</p>
        <div class="tool-tags">
          <span class="v">v${t.version}</span>
          ${t.kind === 'generated' ? '<span class="v">miya yozgan</span>' : '<span>builtin</span>'}
          <span>${t.runs || 0} marta</span>
          ${t.failures ? `<span class="err">${t.failures} xato</span>` : ''}
        </div>
      </div>
    </div>`).join('') || '<div class="empty">Tool yo\'q</div>';
}

function renderProviders() {
  $('#providerList').innerHTML = (state.providers || []).map((p) => `
    <div class="provider" data-provider="${p.id}">
      <div class="provider-top">
        <strong>${esc(p.label)}</strong>
        <span class="badge ${p.hasKey ? 'done' : ''}">${p.hasKey ? `${p.modelCount} model` : 'kalit yo\'q'}</span>
      </div>
      <div class="provider-row">
        <input type="password" placeholder="${p.hasKey ? esc(p.keyPreview) : 'API kalitni qo\'ying'}" autocomplete="off" />
        <button class="primary-btn slim" data-act="save">${p.hasKey ? 'Yangilash' : 'Qo\'shish'}</button>
        ${p.hasKey ? '<button class="mini-btn" data-act="del">O\'chirish</button>' : ''}
      </div>
      <small>Kalitni olish: <a href="${p.docs}" target="_blank" rel="noopener">${esc(p.docs.replace('https://', ''))}</a></small>
    </div>`).join('');

  const filter = $('#providerFilter');
  const cur = filter.value;
  filter.innerHTML = '<option value="">Hammasi</option>' +
    (state.providers || []).filter((p) => p.hasKey).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  filter.value = cur;
  $('#keyHint').textContent = state.modelCount ? `${state.modelCount} model topildi` : 'kalit kiriting → modellar chiqadi';
}

async function renderModels() {
  if (!online) return;
  const q = $('#modelSearch').value.trim();
  const provider = $('#providerFilter').value;
  const approved = $('#onlyApproved').checked ? '1' : '';
  try {
    const data = await api(`/api/models?q=${encodeURIComponent(q)}&provider=${provider}&approved=${approved}`);
    const list = data.models || [];
    $('#modelCount').textContent = `${list.filter((m) => m.approved).length} / ${list.length}`;
    $('#modelList').innerHTML = list.length
      ? list.slice(0, 200).map((m) => `
        <div class="model ${m.approved ? 'on' : ''}" data-model="${esc(m.id)}">
          <div class="model-info">
            <strong>${esc(m.model)}</strong>
            <span>${esc(m.provider)} · ${m.tags.join(' · ')}</span>
          </div>
          <span class="tick">✓</span>
        </div>`).join('')
      : '<div class="empty">Model topilmadi</div>';
  } catch (e) {
    $('#modelList').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderRouting() {
  const approvedIds = state.approved || [];
  $('#routing').innerHTML = (state.taskTypes || []).map((t) => `
    <div class="route">
      <label>${t}</label>
      <select data-route="${t}">
        <option value="">avtomatik</option>
        ${approvedIds.map((id) => `<option value="${esc(id)}" ${state.routing?.[t] === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}
      </select>
    </div>`).join('') || '<p class="muted small">Avval model ruxsat bering</p>';
}

function renderSettings() {
  const s = state.settings || {};
  $('#setAutoImprove').checked = s.autoImprove !== false;
  $('#setNotify').checked = s.notifyOnFinish !== false;
  $('#setRepair').value = s.maxSelfRepair ?? 3;
  $('#tgChat').value = s.telegram?.chatId || '';
  if (s.telegram?.hasToken) $('#tgToken').placeholder = '•••••• saqlangan';
}

/* --------------------------------------------------------------- connection */

async function refresh() {
  if (!cfg.endpoint) {
    setOnline(false);
    return;
  }
  try {
    state = await api('/api/state');
    setOnline(true);
    renderAll();
    renderModels();
  } catch (e) {
    setOnline(false);
    throw e;
  }
}

function connectEvents() {
  if (!cfg.endpoint || typeof EventSource === 'undefined') return;
  events?.close();
  const url = base() + '/api/events' + (cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : '');
  events = new EventSource(url);
  events.addEventListener('hello', () => setOnline(true));
  events.addEventListener('mission', () => scheduleRefresh());
  events.addEventListener('tool', () => scheduleRefresh());
  events.addEventListener('blocker', () => scheduleRefresh());
  events.onerror = () => setOnline(false);
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 350);
}

/* ------------------------------------------------------------------ actions */

async function sendTask() {
  const input = $('#prompt');
  const goal = input.value.trim();
  if (!goal) return;
  input.value = '';
  input.style.height = 'auto';
  addMsg('user', goal);

  if (!cfg.endpoint) {
    addMsg('ai',
      'Miya serveriga ulanmaganman. Sozlamalar → "Miya serveri" bo\'limiga Railway endpointni yozing.\n\n' +
      'Shundan keyin: API kalit qo\'yasiz → modellar ro\'yxati chiqadi → ruxsat berasiz → men topshiriqni mos modelga o\'zim yuklayman.');
    navigate('settings');
    return;
  }

  try {
    const { mission } = await api('/api/missions', { method: 'POST', body: { goal } });
    activeMissionId = mission.id;
    addMsg('ai', 'Qabul qildim. Reja tuzyapman — jarayonni "Jarayon" bo\'limida kuzatishingiz mumkin. Tugagach shu yerda va Telegram\'da xabar beraman.');
    setBrainMode('busy', 'ishlamoqda');
    scheduleRefresh();
  } catch (e) {
    addMsg('ai', `Serverga yuborolmadim: ${e.message}\n\nEndpoint to'g'riligini tekshiring — men urinishda davom etaman.`);
  }
}

async function saveKey(provider, value, btn) {
  btn.disabled = true;
  btn.textContent = 'Tekshirilmoqda...';
  try {
    const r = await api('/api/keys', { method: 'POST', body: { provider, apiKey: value } });
    state = r.state;
    renderAll();
    renderModels();
    toast(`${provider}: ${r.models} ta model topildi`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yangilash';
  }
}

/* -------------------------------------------------------------------- wiring */

$$('.nav-item').forEach((b) => (b.onclick = () => navigate(b.dataset.target)));
$$('[data-prompt]').forEach((b) => (b.onclick = () => {
  $('#prompt').value = b.dataset.prompt;
  $('#prompt').focus();
}));

$('#send').onclick = sendTask;
$('#prompt').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
});
$('#prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTask();
  }
});

$('#openMission').onclick = () => navigate('flow');
$('#missionPick').onchange = (e) => {
  activeMissionId = e.target.value;
  renderMissions();
};
$('#clearLogs').onclick = () => ($('#logs').innerHTML = '<div class="empty">Loglar yo\'q</div>');
$('#copyResult').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#resultBody').textContent);
    toast('Nusxa olindi', 'ok');
  } catch { toast('Nusxa olinmadi', 'err'); }
};

$('#blockerSend').onclick = async () => {
  const value = $('#blockerValue').value.trim();
  if (!value) return toast('Qiymat kiriting', 'err');
  try {
    await api('/api/blockers/answer', { method: 'POST', body: { id: $('#blockerCard').dataset.id, value } });
    $('#blockerValue').value = '';
    toast('Qabul qilindi — ish davom etmoqda', 'ok');
    scheduleRefresh();
  } catch (e) { toast(e.message, 'err'); }
};

$('#reloadTools').onclick = () => refresh().then(() => toast('Registr yangilandi', 'ok')).catch((e) => toast(e.message, 'err'));

$('#forgeBtn').onclick = async () => {
  const request = $('#forgeInput').value.trim();
  if (!request) return toast('Nima kerakligini yozing', 'err');
  const btn = $('#forgeBtn');
  btn.disabled = true;
  btn.textContent = 'Yozilmoqda...';
  try {
    const { tool } = await api('/api/tools', { method: 'POST', body: { request } });
    $('#forgeInput').value = '';
    toast(`Tool tayyor: ${tool.name}`, 'ok');
    scheduleRefresh();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yasash';
  }
};

$('#toolList').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-tool]');
  if (!card) return;
  const tool = (state?.tools || []).find((t) => t.name === card.dataset.tool);
  if (!tool) return;
  const last = tool.lastError ? `\n\nOxirgi xato: ${tool.lastError.slice(0, 200)}` : '';
  toast(`${tool.name} · ${tool.input || '{...}'}${last}`);
});

$('#refreshModels').onclick = async () => {
  try {
    const r = await api('/api/models/refresh', { method: 'POST' });
    state = r.state;
    renderAll();
    renderModels();
    toast(r.failed?.length ? `Xato: ${r.failed[0].provider}` : 'Modellar yangilandi', r.failed?.length ? 'err' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

let searchTimer = null;
$('#modelSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderModels, 220);
});
$('#providerFilter').onchange = renderModels;
$('#onlyApproved').onchange = renderModels;

$('#modelList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-model]');
  if (!row) return;
  const id = row.dataset.model;
  const approved = !row.classList.contains('on');
  row.classList.toggle('on', approved);
  try {
    const r = await api('/api/models/approve', { method: 'POST', body: { id, approved } });
    state.approved = r.approved;
    renderRouting();
    toast(approved ? `Ruxsat berildi: ${id}` : `Olib tashlandi: ${id}`, 'ok');
  } catch (err) {
    row.classList.toggle('on', !approved);
    toast(err.message, 'err');
  }
});

$('#routing').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-route]');
  if (!sel) return;
  try {
    await api('/api/models/route', { method: 'POST', body: { taskType: sel.dataset.route, modelId: sel.value } });
    toast('Yo\'naltirish saqlandi', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});

$('#providerList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const box = btn.closest('[data-provider]');
  const provider = box.dataset.provider;
  if (btn.dataset.act === 'del') {
    try {
      const r = await api('/api/keys', { method: 'DELETE', body: { provider } });
      state = r.state;
      renderAll();
      renderModels();
      toast(`${provider} kaliti o'chirildi`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  const value = box.querySelector('input').value.trim();
  if (!value) return toast('Kalitni kiriting', 'err');
  await saveKey(provider, value, btn);
});

$('#connectBtn').onclick = async () => {
  cfg.endpoint = $('#endpoint').value.trim();
  cfg.token = $('#appToken').value.trim();
  saveCfg();
  const btn = $('#connectBtn');
  btn.disabled = true;
  btn.textContent = 'Ulanmoqda...';
  try {
    await refresh();
    connectEvents();
    toast('Miya bilan ulandim', 'ok');
    navigate('brain');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ulanish va tekshirish';
  }
};

$('#tgSave').onclick = async () => {
  try {
    await api('/api/telegram', {
      method: 'POST',
      body: {
        botToken: $('#tgToken').value.trim() || undefined,
        chatId: $('#tgChat').value.trim(),
        enabled: true,
      },
    });
    $('#tgToken').value = '';
    toast('Telegram saqlandi', 'ok');
    scheduleRefresh();
  } catch (e) { toast(e.message, 'err'); }
};

$('#tgTest').onclick = async () => {
  try {
    await api('/api/telegram/test', { method: 'POST' });
    toast('Test xabari yuborildi', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

$('#saveSettings').onclick = async () => {
  try {
    const r = await api('/api/settings', {
      method: 'POST',
      body: {
        autoImprove: $('#setAutoImprove').checked,
        notifyOnFinish: $('#setNotify').checked,
        maxSelfRepair: Number($('#setRepair').value) || 3,
      },
    });
    state.settings = r.settings;
    toast('Saqlandi', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

$('#tgChip').onclick = () => navigate('settings');
$('#linkChip').onclick = () => navigate('settings');

/* --------------------------------------------------------------------- boot */

$('#endpoint').value = cfg.endpoint;
$('#appToken').value = cfg.token;

if (cfg.endpoint) {
  refresh().then(connectEvents).catch(() => {
    addMsg('ai', 'Miya serveri javob bermayapti. Endpoint to\'g\'riligini tekshiring — ulanishim bilan hamma narsa joyida bo\'ladi.');
  });
} else {
  addMsg('ai',
    'Salom. Men Daho — sizning yagona miyangiz.\n\n' +
    '1) Sozlamalarga miya serveri endpointini yozing\n' +
    '2) Modellar bo\'limida API kalit qo\'ying — mavjud modellar ro\'yxati chiqadi\n' +
    '3) Qaysi modellarga ruxsat berishni belgilang\n\n' +
    'Keyin faqat topshiriq berasiz: rejani men tuzaman, kerakli toolni o\'zim yozaman, xatoni o\'zim tuzataman va tugagach Telegram\'ga xabar beraman.');
}

setInterval(() => {
  if (cfg.endpoint) refresh().catch(() => {});
}, 12000);
