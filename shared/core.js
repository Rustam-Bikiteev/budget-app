import * as finance from './domain.mjs';

// Shared controller and local view. Dependencies are configured by the entry point.
const MN = ['Январь','Февраль','Март','Апрель','Май','Июнь',
            'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const coreConfig = { copyPrevByDefault: false };

const initial = finance.initialPeriod(new Date());
const state = {
  ...initial,
  monthId: null,
  income: 0,
  saved: 0,
  entries: [],
  allMonths: [],
  catFilter: 'all',
  prevMonthId: null,
  backlog: [],
};

let cats = [];
let api = globalThis.api;
const lifecycle = { reload: null, escape: null, refresh: null, logout: null };
const viewHooks = { summary: () => {}, loaded: () => {}, modal: () => {} };
function configureViewHooks(hooks) { Object.assign(viewHooks, hooks); }
function setCategories(categories) { cats = categories; }
function configureCore({ storage, categories, reload = loadAll, escape = null, refresh = null, logout = null, mode = 'local' }) {
  api = storage; cats = categories; lifecycle.reload = reload; lifecycle.escape = escape; lifecycle.refresh = refresh; lifecycle.logout = logout;
  coreConfig.copyPrevByDefault = true;
  Object.assign(state, finance.initialPeriod(new Date(), mode));
}
function init() { return (lifecycle.reload || loadAll)(); }
function onEscape() { lifecycle.escape?.(); }
function refreshData() { return lifecycle.refresh ? lifecycle.refresh() : loadAll(); }
function doLogout() { return lifecycle.logout?.(); }


// ── helpers ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
const fmtAbs = n => Math.abs(n).toLocaleString('ru-RU') + ' ₽';
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const isMobile = () => window.innerWidth <= 640;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmtK = n => {
  const abs = Math.abs(n || 0);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1000) {
    const k = abs / 1000;
    const s = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '');
    return sign + s + 'К ₽';
  }
  return sign + abs + ' ₽';
};

// добавить или заменить по id: живая синхронизация может принести строку раньше ответа API
function upsert(list, row) {
  const i = list.findIndex(x => x.id === row.id);
  if (i === -1) list.push(row); else list[i] = row;
}

// id в onclick-атрибуте: числовые (Supabase) как есть, строковые (IndexedDB) в кавычках
const idArg = id => typeof id === 'number' ? id : `'${id}'`;

const isEditing = () =>
  !!document.activeElement && document.activeElement.matches('main input, main select');

function enterBlur(e) { if (e.key === 'Enter') e.target.blur(); }

function cellKeydown(e) {
  if (e.key === 'Enter') { e.target.blur(); return; }
}

// ── status indicator ─────────────────────────────────────────────────────────

let syncTimer = null;
function flash(text, isErr) {
  const el = $('sync-dot');
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => el.classList.remove('show'), isErr ? 5000 : 900);
}

// Await complete UI operations, including multi-write actions and confirmations.
let savePending = 0;
let saveFailed = false;
let contextToken = 0;
function renderSaveStatus() {
  const el = $('save-status');
  if (!el) return;
  el.dataset.state = saveFailed ? 'error' : savePending ? 'saving' : 'saved';
  el.textContent = saveFailed ? 'Не удалось сохранить' : savePending ? 'Сохраняется' : 'Сохранено';
}
async function runSaveAction(action) {
  const context = contextToken;
  // Some actions only open a confirmation. Their callback starts the write later.
  let task;
  try { task = action(); }
  catch (error) {
    saveFailed = true;
    renderSaveStatus();
    return false;
  }
  if (!task || typeof task.then !== 'function') return task;
  if (!savePending) saveFailed = false;
  savePending++;
  renderSaveStatus();
  try {
    const result = await task;
    if (context === contextToken && result === false) saveFailed = true;
    return result;
  } catch (error) {
    if (context === contextToken) saveFailed = true;
    return false;
  } finally {
    if (context === contextToken) { savePending--; renderSaveStatus(); }
  }
}

// ── navigation ───────────────────────────────────────────────────────────────

function shiftMonth(dir) {
  Object.assign(state, finance.shiftPeriod(state, dir));
  loadCurrentMonth();
}

// ── load ─────────────────────────────────────────────────────────────────────

async function loadAll() {
  const context = contextToken;
  if (state.catFilter !== 'all' && !catById(state.catFilter)) state.catFilter = 'all';
  const [months, backlog] = await Promise.all([api.listMonths(), api.listBacklog()]);
  if (context !== contextToken) return;
  state.allMonths = months;
  state.backlog = backlog;
  renderTabs();
  await loadCurrentMonth();
}

let loadToken = 0;
function resetContext() {
  contextToken++;
  loadToken++;
  Object.assign(state, { monthId: null, income: 0, saved: 0, entries: [], allMonths: [], backlog: [], catFilter: 'all', prevMonthId: null });
  savePending = 0; saveFailed = false; renderSaveStatus();
  clearTimeout(syncTimer);
  $('sync-dot')?.classList.remove('show', 'err');
  view.contextChanged?.();
  for (const id of ['planned-body', 'mandatory-body', 'backlog-body']) { const el = $(id); if (el) el.replaceChildren(); }
}

async function loadCurrentMonth() {
  const token = ++loadToken;
  const { year, month, half } = state;
  $('month-label-text').textContent = `${MN[month-1]} ${year} · ${half === 1 ? '1-я пол.' : '2-я пол.'}`;

  view.periodChanged?.();

  const found = state.allMonths.find(m => m.year === year && m.month === month && m.half === half);

  if (!found) {
    const prev = findPrev(year, month, half);
    state.prevMonthId = prev ? prev.id : null;
    $('empty-title').textContent = `Бюджет на ${MN[month-1].toLowerCase()} ${year} (${half === 1 ? '1-я пол.' : '2-я пол.'}) не создан`;
    $('copy-option').style.display = prev ? 'flex' : 'none';
    $('copy-cb').checked = !!prev && coreConfig.copyPrevByDefault;
    $('empty-state').classList.remove('hidden');
    $('budget-view').classList.add('hidden');
    state.monthId = null; state.entries = [];
    renderBacklog();
    viewHooks.loaded();
    return;
  }

  const data = await api.getMonth(found.id);
  if (token !== loadToken) return; // пока читали, пользователь переключил период

  $('empty-state').classList.add('hidden');
  $('budget-view').classList.remove('hidden');

  state.monthId = found.id;
  state.income  = data.month.income;
  state.saved   = data.month.saved;
  state.entries = data.entries;

  $('income-inp').value = state.income || '';
  $('saved-inp').value  = state.saved  || '';

  renderAll();
  renderBacklog();
  viewHooks.loaded();
}

function findPrev(year, month, half) {
  const prev = finance.shiftPeriod({ year, month, half }, -1);
  return state.allMonths.find(row => row.year === prev.year && row.month === prev.month && row.half === prev.half) || null;
}

// ── create month ─────────────────────────────────────────────────────────────

async function createCurrentMonth() {
  const copyId = $('copy-cb').checked ? state.prevMonthId : null;
  const res = await api.createMonth(state.year, state.month, state.half, copyId);
  // период уже создан в другой вкладке или на другом устройстве
  if (res.error) { await init(); return; }
  upsert(state.allMonths, res);
  await loadCurrentMonth();
}

// ── save income / saved ───────────────────────────────────────────────────────

async function saveMonthFields() {
  if (!state.monthId) return;
  const monthId = state.monthId;
  const income = num($('income-inp').value);
  const saved  = num($('saved-inp').value);
  if (income === state.income && saved === state.saved) return;
  await api.updateMonth(monthId, { income, saved });
  if (state.monthId !== monthId) return;
  state.income = income; state.saved = saved;
  renderSummary();
}

// ── categories ────────────────────────────────────────────────────────────────

const catById = id => cats.find(c => c.id === id);
const catColor = id => (catById(id) || {}).color || '#94a3b8';
const defaultCat = () => (cats.find(category => category.default) || cats[cats.length - 1])?.id;

function catSelect(cat, handler) {
  const opts = (catById(cat) ? '' : `<option value="${esc(cat)}" selected>—</option>`)
    + cats.map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<select aria-label="Категория" class="cat-sel" style="--cat:${catColor(cat)}" onchange="runSaveAction(() => ${handler})">${opts}</select>`;
}

function paintSelect(sel) { sel.style.setProperty('--cat', catColor(sel.value)); }

function filterCat(cat) {
  state.catFilter = cat;
  renderTabs();
  renderPlanned();
}

function localRenderTabs() {
  const tabs = [{ id: 'all', name: 'Все', color: 'var(--text)' }, ...cats];
  $('cat-tabs').innerHTML = tabs.map(c => `
    <button class="cat-tab ${state.catFilter === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="filterCat('${c.id}')">${esc(c.name)}</button>`).join('');
}

// ── render ────────────────────────────────────────────────────────────────────

function renderAll() { renderSummary(); renderMandatory(); renderPlanned(); }

function localRenderSummary() {
  const { mandatory, spent, allowed, remain } = finance.localSummary(state);

  $('s-income').textContent    = fmt(state.income);
  $('s-mandatory').textContent = fmt(mandatory);
  $('s-spent').textContent     = fmt(spent);
  $('s-saved').textContent     = fmt(state.saved);
  $('s-allowed').textContent   = (allowed < 0 ? '−' : '') + fmtAbs(allowed);
  $('s-allowed-card').classList.toggle('negative', allowed < 0);
  $('s-remain').textContent    = (remain < 0 ? '−' : '') + fmtAbs(remain);

  $('s-remain-card').classList.toggle('red-accent', remain < 0);
}

function localRenderMandatoryTotal() {
  const rows = state.entries.filter(e => e.type === 'mandatory');
  $('mandatory-total').textContent = rows.length ? fmt(rows.reduce((s, e) => s + e.planned, 0)) : '';
  return rows;
}

function localRenderMandatory() {
  const rows = renderMandatoryTotal();
  $('mandatory-body').innerHTML = rows.map(e => {
    const id = idArg(e.id);
    return `
    <tr role="row" data-eid="${e.id}">
      <td role="cell" class="col-cat">${catSelect(e.category, `onCatChange(${id},this)`)}</td>
      <td role="cell" class="col-name">
        <input class="ci" type="text" aria-label="Название записи" value="${esc(e.name)}" placeholder="Название"
          onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="cellKeydown(event)">
      </td>
      <td role="cell" class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          aria-label="Плановая сумма" data-field="planned" onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="cellKeydown(event)">
      </td>
      <td role="cell" class="col-del"><button class="del-btn" aria-label="Удалить запись" onclick="deleteEntry(${id})">×</button></td>
    </tr>`;
  }).join('');
}

function reserveControl(entry) {
  const unavailable = api.capabilities?.reserveColumn === false;
  return `<label><input type="checkbox" aria-label="Резерв: ${esc(entry.name || 'Без названия')}" ${entry.is_reserve ? 'checked' : ''}
    ${unavailable ? 'disabled title="Сохранение признака резерва требует обновления облачной БД"' : ''}
    onchange="runSaveAction(() => setReserve(${idArg(entry.id)},this.checked))"> Резерв</label>`;
}

async function setReserve(id, value) {
  if (api.capabilities?.reserveColumn === false) throw new Error('Требуется обновление облачной БД');
  const row = state.entries.find(entry => entry.id === id);
  if (!row || row.type !== 'mandatory') return;
  await api.updateEntry(id, { is_reserve: value });
  row.is_reserve = value;
  renderMandatory(); renderSummary();
}

function localPlannedTotals() {
  return finance.plannedTotalsFor(state.entries, state.catFilter);
}

function localRemInfo(e) {
  const rem = e.planned - e.actual;
  return {
    cls: rem > 0 ? 'rem-pos' : rem < 0 ? 'rem-neg' : 'rem-zero',
    text: e.planned > 0 ? ((rem < 0 ? '−' : '') + fmtAbs(rem)) : '—',
  };
}

function localRenderPlannedTotals() {
  const { filtered, totPlan, totActual, totRem } = plannedTotals();
  $('planned-total').textContent = filtered.length ? `${fmt(totActual)} из ${fmt(totPlan)}` : '';
  const foot = $('planned-foot');
  if (filtered.length > 1) {
    const cls = totRem >= 0 ? 'rem-pos' : 'rem-neg';
    const f = isMobile() ? fmtK : fmt;
    const fA = isMobile() ? n => fmtK(Math.abs(n)) : fmtAbs;
    foot.innerHTML = `
      <tr class="totals-row">
        <td colspan="2">Итого (${filtered.length})</td>
        <td role="cell" class="r">${f(totPlan)}</td>
        <td role="cell" class="r">${f(totActual)}</td>
        <td role="cell" class="r ${cls}">${(totRem < 0 ? '−' : '') + fA(totRem)}</td>
        <td></td><td></td>
      </tr>`;
  } else {
    foot.innerHTML = '';
  }
}

function localRenderPlanned() {
  const { filtered } = plannedTotals();
  $('planned-body').innerHTML = filtered.map(e => {
    const r = remInfo(e);
    const id = idArg(e.id);
    return `
    <tr role="row" data-eid="${e.id}">
      <td role="cell" class="col-cat">${catSelect(e.category, `onCatChange(${id},this)`)}</td>
      <td role="cell" class="col-name">
        <input class="ci" type="text" aria-label="Название записи" value="${esc(e.name)}" placeholder="Название"
          onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="cellKeydown(event)">
      </td>
      <td role="cell" class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          aria-label="Плановая сумма" data-field="planned" onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="cellKeydown(event)">
      </td>
      <td role="cell" class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.actual || ''}" placeholder="0"
          aria-label="Фактическая сумма" data-field="actual" onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="cellKeydown(event)">
      </td>
      <td role="cell" class="col-num"><span class="rem-cell ${r.cls}">${r.text}</span></td>
      <td role="cell" class="col-move"><button class="tobacklog-btn" aria-label="В будущие покупки" title="В будущие покупки" onclick="runSaveAction(() => entryToBacklog(${id}))">↓</button></td>
      <td role="cell" class="col-del"><button class="del-btn" aria-label="Удалить запись" onclick="deleteEntry(${id})">×</button></td>
    </tr>`;
  }).join('');
  renderPlannedTotals();
}

// ── entry CRUD ────────────────────────────────────────────────────────────────

function getRowValues(eid) {
  const row = document.querySelector(`tr[data-eid="${eid}"]`);
  const entry = state.entries.find(e => e.id === eid);
  if (!row || !entry) return null;
  const data = { ...entry };
  const nameInp = row.querySelector('input[type=text]');
  if (nameInp) data.name = nameInp.value;
  row.querySelectorAll('input[type=number]').forEach(inp => {
    data[inp.dataset.field] = num(inp.value);
  });
  const sel = row.querySelector('select');
  if (sel) data.category = sel.value;
  return data;
}

async function localSaveEntry(eid) {
  const monthId = state.monthId;
  const d = getRowValues(eid);
  if (!d) return;
  const idx = state.entries.findIndex(e => e.id === eid);
  const cur = state.entries[idx];
  const patch = { category: d.category, name: d.name, planned: d.planned || 0, actual: d.actual || 0 };
  if (Object.keys(patch).every(k => cur[k] === patch[k])) return;
  await api.updateEntry(eid, patch);
  if (state.monthId !== monthId) return;
  const currentIndex = state.entries.findIndex(e => e.id === eid);
  if (currentIndex === -1) return;
  state.entries[currentIndex] = { ...state.entries[currentIndex], ...patch };
  renderSummary();
  if (d.type === 'mandatory') renderMandatoryTotal();
  else patchPlannedRow(eid);
}

function localPatchPlannedRow(eid) {
  const entry = state.entries.find(e => e.id === eid);
  if (!entry) return;
  const span = document.querySelector(`tr[data-eid="${eid}"] .rem-cell`);
  if (span) {
    const r = remInfo(entry);
    span.className = `rem-cell ${r.cls}`;
    span.textContent = r.text;
  }
  renderPlannedTotals();
}

async function onCatChange(eid, sel) {
  paintSelect(sel);
  const entry = state.entries.find(e => e.id === eid);
  if (!entry) return;
  await api.updateEntry(eid, { category: sel.value });
  entry.category = sel.value;
  if (entry.type === 'planned' && state.catFilter !== 'all') renderPlanned();
  else if (entry.type === 'planned') renderPlannedTotals();
}

function deleteEntry(eid) {
  const entry = state.entries.find(e => e.id === eid);
  openConfirm('Удалить запись?', entry && entry.name ? `«${entry.name}»` : '', 'Удалить', async () => {
    await api.deleteEntry(eid);
    state.entries = state.entries.filter(e => e.id !== eid);
    renderAll();
  });
}

async function localAddEntry(type) {
  if (!state.monthId) return;
  const monthId = state.monthId;
  const cat = (state.catFilter !== 'all' && type === 'planned') ? state.catFilter : defaultCat();
  const entry = await api.createEntry({
    month_id: monthId, type, category: cat, name: '', planned: 0, actual: 0,
  });
  if (state.monthId !== monthId) return;
  upsert(state.entries, entry);
  if (type === 'mandatory') renderMandatory();
  else renderPlanned();
  const input = document.querySelector(`tr[data-eid="${entry.id}"] input[type=text]`);
  if (input) input.focus();
}

async function localEntryToBacklog(eid) {
  const item = await api.entryToBacklog(eid);
  state.entries = state.entries.filter(e => e.id !== eid);
  upsert(state.backlog, item);
  renderPlanned();
  renderSummary();
  renderBacklog();
  flash('Перенесено в будущие покупки');
}

// ── calendar ─────────────────────────────────────────────────────────────────

let calYear = new Date().getFullYear();
let calOpen = false;

function isCalendarOpen() { return calOpen; }
function closeCalendar() { calOpen = false; $('cal-popup').classList.add('hidden'); }

function toggleCalendar(e) {
  e.stopPropagation();
  calOpen = !calOpen;
  if (calOpen) {
    calYear = state.year;
    renderCalendar();
    $('cal-popup').classList.remove('hidden');
  } else {
    $('cal-popup').classList.add('hidden');
  }
}

document.addEventListener('click', e => {
  if (calOpen && !e.target.closest('.cal-wrapper')) {
    calOpen = false;
    $('cal-popup').classList.add('hidden');
  }
});

function calPickYear(dir) {
  calYear += dir;
  renderCalendar();
}

function renderCalendar() {
  $('cal-year-display').textContent = calYear;
  const short = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  $('cal-months-grid').innerHTML = short.map((mn, i) => {
    const m = i + 1;
    const has = h => state.allMonths.some(x => x.year === calYear && x.month === m && x.half === h);
    const cur = h => state.year === calYear && state.month === m && state.half === h;
    const btn = h => `<button class="cal-half ${has(h) ? 'has-data' : ''} ${cur(h) ? 'is-current' : ''}"
          aria-label="${MN[m-1]} ${calYear}, период ${h}" onclick="pickPeriod(${calYear},${m},${h})">${h}</button>`;
    return `<div class="cal-month">
      <div class="cal-month-name">${mn}</div>
      <div class="cal-halves">${btn(1)}${btn(2)}</div>
    </div>`;
  }).join('');
}

function pickPeriod(y, m, h) {
  state.year = y; state.month = m; state.half = h;
  calOpen = false;
  $('cal-popup').classList.add('hidden');
  loadCurrentMonth();
}

// ── confirm modal ─────────────────────────────────────────────────────────────

let confirmCallback = null;
const modalFocus = new WeakMap();

function activeModal() {
  const confirm = $('confirm-overlay');
  if (confirm && !confirm.classList.contains('hidden')) return confirm;
  return [...document.querySelectorAll('.modal-overlay')].reverse().find(el => !el.classList.contains('hidden'));
}

function updateModalBackground() {
  const active = activeModal();
  document.querySelectorAll('header, main, .modal-overlay').forEach(el => {
    el.inert = !!active && el !== active;
  });
  viewHooks.modal(!!active);
}

function openModal(overlay) {
  modalFocus.set(overlay, document.activeElement);
  overlay.classList.remove('hidden');
  updateModalBackground();
  const first = overlay.querySelector('input:not([disabled]), button:not([disabled]), [tabindex="-1"]');
  if (first) first.focus();
}

function closeModal(overlay) {
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  updateModalBackground();
  const previous = modalFocus.get(overlay);
  if (previous && previous.isConnected && !previous.closest('[inert]')) previous.focus();
}

document.addEventListener('keydown', e => {
  const overlay = activeModal();
  if (!overlay || e.key !== 'Tab') return;
  const controls = [...overlay.querySelectorAll('button, input, select, a[href], [tabindex="0"]')]
    .filter(el => !el.disabled && el.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (!first) { e.preventDefault(); return; }
  if (!controls.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function openConfirm(title, text, okLabel, callback) {
  confirmCallback = callback;
  $('confirm-title').textContent = title;
  $('confirm-name').textContent = text || '';
  $('confirm-ok').textContent = okLabel;
  openModal($('confirm-overlay'));
}

function closeConfirm() {
  closeModal($('confirm-overlay'));
  confirmCallback = null;
}

function execConfirm() {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) return cb();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('confirm-overlay').classList.contains('hidden')) closeConfirm();
  else if (typeof onEscape === 'function') onEscape();
});

// ── backlog ───────────────────────────────────────────────────────────────────

let backlogOpen = false;

function showBacklog() { if (!backlogOpen) toggleBacklog(); }

function toggleBacklog() {
  backlogOpen = !backlogOpen;
  document.querySelector('.backlog-header').setAttribute('aria-expanded', String(backlogOpen));
  $('backlog-content').classList.toggle('hidden', !backlogOpen);
  $('backlog-arrow').textContent = backlogOpen ? '▾' : '▸';
}

function renderBacklogTotal() {
  $('backlog-total').textContent = state.backlog.length
    ? fmt(state.backlog.reduce((s, b) => s + b.planned, 0)) : '';
}

function localRenderBacklog() {
  renderBacklogTotal();
  $('backlog-body').innerHTML = state.backlog.map(b => {
    const id = idArg(b.id);
    return `
    <tr role="row" data-bid="${b.id}">
      <td role="cell" class="col-cat">${catSelect(b.category, `onBacklogCatChange(${id},this)`)}</td>
      <td role="cell" class="col-name">
        <input class="ci" type="text" aria-label="Название покупки" value="${esc(b.name)}" placeholder="Название"
          onblur="runSaveAction(() => saveBacklogEntry(${id}))" onkeydown="enterBlur(event)">
      </td>
      <td role="cell" class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" aria-label="Плановая сумма" type="number" inputmode="decimal" value="${b.planned || ''}" placeholder="0"
          onblur="runSaveAction(() => saveBacklogEntry(${id}))" onkeydown="enterBlur(event)">
      </td>
      <td role="cell" class="col-move">
        <button class="move-btn" aria-label="Перенести в планируемые" title="Перенести в планируемые"
          onclick="runSaveAction(() => moveBacklogEntry(${id}))" ${!state.monthId ? 'disabled' : ''}>+</button>
      </td>
      <td role="cell" class="col-del">
        <button class="del-btn" aria-label="Удалить запись" onclick="deleteBacklogEntry(${id})">×</button>
      </td>
    </tr>`;
  }).join('');
}

async function onBacklogCatChange(bid, sel) {
  paintSelect(sel);
  const item = state.backlog.find(b => b.id === bid);
  if (!item) return;
  await api.updateBacklog(bid, { category: sel.value });
  item.category = sel.value;
}

async function localSaveBacklogEntry(bid) {
  const row = document.querySelector(`tr[data-bid="${bid}"]`);
  const item = state.backlog.find(b => b.id === bid);
  if (!row || !item) return;
  const patch = {
    name: row.querySelector('input[type=text]').value,
    planned: num(row.querySelector('input[type=number]').value),
  };
  if (patch.name === item.name && patch.planned === item.planned) return;
  await api.updateBacklog(bid, patch);
  Object.assign(item, patch);
  renderBacklogTotal();
}

async function localAddBacklogEntry() {
  const item = await api.createBacklog({ category: defaultCat(), name: '', planned: 0 });
  upsert(state.backlog, item);
  if (!backlogOpen) toggleBacklog();
  renderBacklog();
  const input = document.querySelector(`tr[data-bid="${item.id}"] input[type=text]`);
  if (input) input.focus();
}

function deleteBacklogEntry(bid) {
  const item = state.backlog.find(b => b.id === bid);
  openConfirm('Удалить запись?', item && item.name ? `«${item.name}»` : '', 'Удалить', async () => {
    await api.deleteBacklog(bid);
    state.backlog = state.backlog.filter(b => b.id !== bid);
    renderBacklog();
  });
}

async function moveBacklogEntry(bid) {
  if (!state.monthId) return;
  const monthId = state.monthId;
  const entry = await api.backlogToEntry(bid, monthId);
  state.backlog = state.backlog.filter(b => b.id !== bid);
  if (state.monthId === monthId) upsert(state.entries, entry);
  renderBacklog();
  renderPlanned();
  renderSummary();
  flash('Перенесено в планируемые');
}

// Explicit view port: cloud installs implementations once during composition.
const view = { renderSummary: localRenderSummary, renderMandatoryTotal: localRenderMandatoryTotal, renderMandatory: localRenderMandatory, renderTabs: localRenderTabs, plannedTotals: localPlannedTotals, remInfo: localRemInfo, renderPlannedTotals: localRenderPlannedTotals, renderPlanned: localRenderPlanned, patchPlannedRow: localPatchPlannedRow, saveEntry: localSaveEntry, addEntry: localAddEntry, renderBacklog: localRenderBacklog, saveBacklogEntry: localSaveBacklogEntry, addBacklogEntry: localAddBacklogEntry, entryToBacklog: localEntryToBacklog };
function setView(implementation) { Object.assign(view, implementation); }
function renderSummary(...args) { const result = view.renderSummary(...args); viewHooks.summary(); return result; }
function renderMandatoryTotal(...args) { return view.renderMandatoryTotal(...args); }
function renderMandatory(...args) { return view.renderMandatory(...args); }
function renderTabs(...args) { return view.renderTabs(...args); }
function plannedTotals(...args) { return view.plannedTotals(...args); }
function remInfo(...args) { return view.remInfo(...args); }
function renderPlannedTotals(...args) { return view.renderPlannedTotals(...args); }
function renderPlanned(...args) { return view.renderPlanned(...args); }
function patchPlannedRow(...args) { return view.patchPlannedRow(...args); }
function saveEntry(...args) { return view.saveEntry(...args); }
function addEntry(...args) { return view.addEntry(...args); }
function renderBacklog(...args) { return view.renderBacklog(...args); }
function saveBacklogEntry(...args) { return view.saveBacklogEntry(...args); }
function addBacklogEntry(...args) { return view.addBacklogEntry(...args); }
function entryToBacklog(...args) { return view.entryToBacklog(...args); }

const inlineHandlers = { runSaveAction, shiftMonth, createCurrentMonth, saveMonthFields, filterCat, enterBlur, cellKeydown, onCatChange, deleteEntry, saveEntry, addEntry, toggleCalendar, calPickYear, pickPeriod, closeConfirm, execConfirm, toggleBacklog, onBacklogCatChange, saveBacklogEntry, addBacklogEntry, deleteBacklogEntry, entryToBacklog, moveBacklogEntry, setReserve };

export { resetContext, isCalendarOpen, inlineHandlers, closeCalendar, showBacklog, reserveControl, refreshData, doLogout, localEntryToBacklog, state, cats, api, configureViewHooks, setCategories, configureCore, $, fmtAbs, esc, isMobile, num, fmtK, upsert, idArg, isEditing, enterBlur, flash, runSaveAction, loadAll, loadCurrentMonth, catById, catColor, defaultCat, renderAll, deleteEntry, renderCalendar, activeModal, openModal, closeModal, openConfirm, closeConfirm, renderBacklogTotal, setView, renderSummary, renderMandatoryTotal, renderMandatory, renderTabs, plannedTotals, remInfo, renderPlannedTotals, renderPlanned, patchPlannedRow, saveEntry, renderBacklog, saveBacklogEntry, entryToBacklog };
