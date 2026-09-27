// Общая логика обеих версий бюджета: корневой index.html (Supabase, общий с Настей)
// и free/index.html (IndexedDB, для всех). Правка здесь меняет обе версии сразу.
//
// Подключается обычным <script> до скрипта версии. Версия обязана определить:
//   api    — хранилище: listMonths, getMonth, createMonth, updateMonth,
//            createEntry, updateEntry, deleteEntry, entryToBacklog,
//            listBacklog, createBacklog, updateBacklog, deleteBacklog, backlogToEntry
//   init() — полная перезагрузка данных (вызывает loadAll)
//   cats   — список категорий [{ id, name, color }], последняя — категория по умолчанию
// Необязательно: onEscape() — Esc, когда подтверждение закрыто;
//   coreConfig.copyPrevByDefault — галочка «скопировать план» включена сразу.

const MN = ['Январь','Февраль','Март','Апрель','Май','Июнь',
            'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const coreConfig = { copyPrevByDefault: false };

const _today = new Date().getDate();
const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  half: (_today >= 10 && _today <= 24) ? 1 : 2,
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
  if (e.key !== 'Tab' || e.shiftKey) return;
  const tbody = e.target.closest('tbody');
  if (!tbody) return;
  const lastRow = [...tbody.querySelectorAll('tr[data-eid]')].at(-1);
  if (!lastRow || e.target.closest('tr') !== lastRow) return;
  const focusables = [...lastRow.querySelectorAll('input, select')];
  if (focusables.at(-1) !== e.target) return;
  e.preventDefault();
  addEntry(tbody.id === 'mandatory-body' ? 'mandatory' : 'planned');
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

// ── navigation ───────────────────────────────────────────────────────────────

function shiftMonth(dir) {
  if (dir > 0) {
    if (state.half === 1) { state.half = 2; }
    else { state.half = 1; state.month++; if (state.month > 12) { state.month = 1; state.year++; } }
  } else {
    if (state.half === 2) { state.half = 1; }
    else { state.half = 2; state.month--; if (state.month < 1) { state.month = 12; state.year--; } }
  }
  loadCurrentMonth();
}

// ── load ─────────────────────────────────────────────────────────────────────

async function loadAll() {
  if (state.catFilter !== 'all' && !catById(state.catFilter)) state.catFilter = 'all';
  const [months, backlog] = await Promise.all([api.listMonths(), api.listBacklog()]);
  state.allMonths = months;
  state.backlog = backlog;
  renderTabs();
  await loadCurrentMonth();
}

let loadToken = 0;
async function loadCurrentMonth() {
  const token = ++loadToken;
  const { year, month, half } = state;
  $('month-label-text').textContent = `${MN[month-1]} ${year} · ${half === 1 ? '1-я пол.' : '2-я пол.'}`;

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
}

function findPrev(year, month, half) {
  let py = year, pm = month, ph = half - 1;
  if (ph < 1) { ph = 2; pm--; if (pm < 1) { pm = 12; py--; } }
  return state.allMonths.find(m => m.year === py && m.month === pm && m.half === ph) || null;
}

// ── create month ─────────────────────────────────────────────────────────────

async function createCurrentMonth() {
  const copyId = $('copy-cb').checked ? state.prevMonthId : null;
  const res = await api.createMonth(state.year, state.month, state.half, copyId);
  // период уже создан в другой вкладке или на другом устройстве
  if (res.error) { await init(); return; }
  upsert(state.allMonths, res);
  loadCurrentMonth();
}

// ── save income / saved ───────────────────────────────────────────────────────

async function saveMonthFields() {
  if (!state.monthId) return;
  const income = num($('income-inp').value);
  const saved  = num($('saved-inp').value);
  if (income === state.income && saved === state.saved) return;
  state.income = income; state.saved = saved;
  await api.updateMonth(state.monthId, { income, saved });
  flash('Сохранено');
  renderSummary();
}

// ── categories ────────────────────────────────────────────────────────────────

const catById = id => cats.find(c => c.id === id);
const catColor = id => (catById(id) || {}).color || '#94a3b8';
const defaultCat = () => cats[cats.length - 1].id;

function catSelect(cat, handler) {
  const opts = (catById(cat) ? '' : `<option value="${esc(cat)}" selected>—</option>`)
    + cats.map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<select class="cat-sel" style="--cat:${catColor(cat)}" onchange="${handler}">${opts}</select>`;
}

function paintSelect(sel) { sel.style.setProperty('--cat', catColor(sel.value)); }

function filterCat(cat) {
  state.catFilter = cat;
  renderTabs();
  renderPlanned();
}

function renderTabs() {
  const tabs = [{ id: 'all', name: 'Все', color: 'var(--text)' }, ...cats];
  $('cat-tabs').innerHTML = tabs.map(c => `
    <button class="cat-tab ${state.catFilter === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="filterCat('${c.id}')">${esc(c.name)}</button>`).join('');
}

// ── render ────────────────────────────────────────────────────────────────────

function renderAll() { renderSummary(); renderMandatory(); renderPlanned(); }

function renderSummary() {
  const mandatory = state.entries.filter(e => e.type === 'mandatory').reduce((s, e) => s + e.planned, 0);
  const spent     = state.entries.filter(e => e.type === 'planned').reduce((s, e) => s + e.actual, 0);
  const remain    = state.income - mandatory - spent - state.saved;

  $('s-income').textContent    = fmt(state.income);
  $('s-mandatory').textContent = fmt(mandatory);
  $('s-spent').textContent     = fmt(spent);
  $('s-saved').textContent     = fmt(state.saved);
  $('s-remain').textContent    = (remain < 0 ? '−' : '') + fmtAbs(remain);

  $('s-remain-card').classList.toggle('red-accent', remain < 0);
}

function renderMandatoryTotal() {
  const rows = state.entries.filter(e => e.type === 'mandatory');
  $('mandatory-total').textContent = rows.length ? fmt(rows.reduce((s, e) => s + e.planned, 0)) : '';
  return rows;
}

function renderMandatory() {
  const rows = renderMandatoryTotal();
  $('mandatory-body').innerHTML = rows.map(e => {
    const id = idArg(e.id);
    return `
    <tr data-eid="${e.id}">
      <td class="col-cat">${catSelect(e.category, `onCatChange(${id},this)`)}</td>
      <td class="col-name">
        <input class="ci" type="text" value="${esc(e.name)}" placeholder="Название"
          onblur="saveEntry(${id})" onkeydown="cellKeydown(event)">
      </td>
      <td class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          data-field="planned" onblur="saveEntry(${id})" onkeydown="cellKeydown(event)">
      </td>
      <td class="col-del"><button class="del-btn" tabindex="-1" onclick="deleteEntry(${id})">×</button></td>
    </tr>`;
  }).join('');
}

function plannedTotals() {
  const all      = state.entries.filter(e => e.type === 'planned');
  const filtered = state.catFilter === 'all' ? all : all.filter(e => e.category === state.catFilter);
  const totPlan   = filtered.reduce((s, e) => s + e.planned, 0);
  const totActual = filtered.reduce((s, e) => s + e.actual, 0);
  return { filtered, totPlan, totActual, totRem: totPlan - totActual };
}

function remInfo(e) {
  const rem = e.planned - e.actual;
  return {
    cls: rem > 0 ? 'rem-pos' : rem < 0 ? 'rem-neg' : 'rem-zero',
    text: e.planned > 0 ? ((rem < 0 ? '−' : '') + fmtAbs(rem)) : '—',
  };
}

function renderPlannedTotals() {
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
        <td class="r">${f(totPlan)}</td>
        <td class="r">${f(totActual)}</td>
        <td class="r ${cls}">${(totRem < 0 ? '−' : '') + fA(totRem)}</td>
        <td></td><td></td>
      </tr>`;
  } else {
    foot.innerHTML = '';
  }
}

function renderPlanned() {
  const { filtered } = plannedTotals();
  $('planned-body').innerHTML = filtered.map(e => {
    const r = remInfo(e);
    const id = idArg(e.id);
    return `
    <tr data-eid="${e.id}">
      <td class="col-cat">${catSelect(e.category, `onCatChange(${id},this)`)}</td>
      <td class="col-name">
        <input class="ci" type="text" value="${esc(e.name)}" placeholder="Название"
          onblur="saveEntry(${id})" onkeydown="cellKeydown(event)">
      </td>
      <td class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          data-field="planned" onblur="saveEntry(${id})" onkeydown="cellKeydown(event)">
      </td>
      <td class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${e.actual || ''}" placeholder="0"
          data-field="actual" onblur="saveEntry(${id})" onkeydown="cellKeydown(event)">
      </td>
      <td class="col-num"><span class="rem-cell ${r.cls}">${r.text}</span></td>
      <td class="col-move"><button class="tobacklog-btn" tabindex="-1" title="В бэклог" onclick="entryToBacklog(${id})">↓</button></td>
      <td class="col-del"><button class="del-btn" tabindex="-1" onclick="deleteEntry(${id})">×</button></td>
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

async function saveEntry(eid) {
  const d = getRowValues(eid);
  if (!d) return;
  const idx = state.entries.findIndex(e => e.id === eid);
  const cur = state.entries[idx];
  const patch = { category: d.category, name: d.name, planned: d.planned || 0, actual: d.actual || 0 };
  if (Object.keys(patch).every(k => cur[k] === patch[k])) return;
  await api.updateEntry(eid, patch);
  state.entries[idx] = { ...cur, ...patch };
  renderSummary();
  if (d.type === 'mandatory') renderMandatoryTotal();
  else patchPlannedRow(eid);
}

function patchPlannedRow(eid) {
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

async function addEntry(type) {
  if (!state.monthId) return;
  const cat = (state.catFilter !== 'all' && type === 'planned') ? state.catFilter : defaultCat();
  const entry = await api.createEntry({
    month_id: state.monthId, type, category: cat, name: '', planned: 0, actual: 0,
  });
  upsert(state.entries, entry);
  if (type === 'mandatory') renderMandatory();
  else renderPlanned();
  const input = document.querySelector(`tr[data-eid="${entry.id}"] input[type=text]`);
  if (input) input.focus();
}

async function entryToBacklog(eid) {
  const item = await api.entryToBacklog(eid);
  state.entries = state.entries.filter(e => e.id !== eid);
  upsert(state.backlog, item);
  renderPlanned();
  renderSummary();
  renderBacklog();
  flash('Перенесено в бэклог');
}

// ── calendar ─────────────────────────────────────────────────────────────────

let calYear = new Date().getFullYear();
let calOpen = false;

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
          onclick="pickPeriod(${calYear},${m},${h})">${h}</button>`;
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

function openConfirm(title, text, okLabel, callback) {
  confirmCallback = callback;
  $('confirm-title').textContent = title;
  $('confirm-name').textContent = text || '';
  $('confirm-ok').textContent = okLabel;
  $('confirm-overlay').classList.remove('hidden');
}

function closeConfirm() {
  $('confirm-overlay').classList.add('hidden');
  confirmCallback = null;
}

function execConfirm() {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('confirm-overlay').classList.contains('hidden')) closeConfirm();
  else if (typeof onEscape === 'function') onEscape();
});

// ── backlog ───────────────────────────────────────────────────────────────────

let backlogOpen = false;

function toggleBacklog() {
  backlogOpen = !backlogOpen;
  $('backlog-content').classList.toggle('hidden', !backlogOpen);
  $('backlog-arrow').textContent = backlogOpen ? '▾' : '▸';
}

function renderBacklogTotal() {
  $('backlog-total').textContent = state.backlog.length
    ? fmt(state.backlog.reduce((s, b) => s + b.planned, 0)) : '';
}

function renderBacklog() {
  renderBacklogTotal();
  $('backlog-body').innerHTML = state.backlog.map(b => {
    const id = idArg(b.id);
    return `
    <tr data-bid="${b.id}">
      <td class="col-cat">${catSelect(b.category, `onBacklogCatChange(${id},this)`)}</td>
      <td class="col-name">
        <input class="ci" type="text" value="${esc(b.name)}" placeholder="Название"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
      </td>
      <td class="col-num" onclick="this.querySelector('input')?.focus()">
        <input class="ci r" type="number" inputmode="decimal" value="${b.planned || ''}" placeholder="0"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
      </td>
      <td class="col-move">
        <button class="move-btn" tabindex="-1" title="Перенести в планируемые"
          onclick="moveBacklogEntry(${id})" ${!state.monthId ? 'disabled' : ''}>+</button>
      </td>
      <td class="col-del">
        <button class="del-btn" tabindex="-1" onclick="deleteBacklogEntry(${id})">×</button>
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

async function saveBacklogEntry(bid) {
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

async function addBacklogEntry() {
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
  const entry = await api.backlogToEntry(bid, state.monthId);
  state.backlog = state.backlog.filter(b => b.id !== bid);
  upsert(state.entries, entry);
  renderBacklog();
  renderPlanned();
  renderSummary();
  flash('Перенесено в планируемые');
}
