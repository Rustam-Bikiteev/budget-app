// Свой интерфейс версии с Supabase поверх shared/core.js: круговая сводка,
// оплата обязательных, траты строками с меню действий.
//
// Подключается после core.js и до скрипта index.html. Функции с теми же именами,
// что в core.js (renderSummary, renderPlanned, saveEntry...), заменяют общие:
// core вызывает их по имени. free/ подключает только core.js и этого не видит.
//
// Схема данных та же. «Оплачено» у обязательного платежа = actual >= planned
// (поле actual у обязательных раньше не использовалось).

const CAT_ORDER   = ['me', 'shared', 'nastya'];

coreConfig.copyPrevByDefault = true;

// ── период = спринт от выплаты до выплаты ───────────────────────────────────
// 1-я половина месяца M: 10–24 M. 2-я: 25 M – 9 следующего месяца.

const MON_GEN = ['января','февраля','марта','апреля','мая','июня',
                 'июля','августа','сентября','октября','ноября','декабря'];
const MON_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

// С 1 по 9 число ещё идёт спринт, начавшийся 25-го прошлого месяца.
// core ставит half = 2, но месяц текущий — сдвигаем на прошлый.
if (new Date().getDate() < 10) {
  state.month--;
  if (state.month < 1) { state.month = 12; state.year--; }
}

function periodRange(y, m, h) {
  return h === 1
    ? { start: new Date(y, m - 1, 10), end: new Date(y, m - 1, 24) }
    : { start: new Date(y, m - 1, 25), end: new Date(y, m, 9) };
}

function periodTitle(y, m, h) {
  const yr = y === new Date().getFullYear() ? '' : ' ' + y;
  if (h === 1) return `10 – 24 ${MON_GEN[m - 1]}${yr}`;
  return `25 ${MON_SHORT[m - 1]} – 9 ${MON_SHORT[m % 12]}${yr}`;
}

// сколько дней спринта осталось, считая сегодня; null — спринт не текущий
function daysLeft() {
  const { start, end } = periodRange(state.year, state.month, state.half);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (now < start || now > end) return null;
  return Math.round((end - now) / 864e5) + 1;
}

function periodSub() {
  const { start, end } = periodRange(state.year, state.month, state.half);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = daysLeft();
  if (d !== null) return `спринт · ещё ${d} дн.`;
  return now < start ? 'спринт · впереди' : 'спринт · прошёл';
}

function setPeriodLabel() {
  const { year, month, half } = state;
  $('month-label-text').textContent = periodTitle(year, month, half);
  $('period-sub').textContent = periodSub();
  if (!state.monthId) $('empty-title').textContent = `Спринт ${periodTitle(year, month, half)} не создан`;
}

const coreLoadCurrentMonth = loadCurrentMonth;
loadCurrentMonth = async function () {
  const p = coreLoadCurrentMonth();   // синхронная часть core уже написала свой ярлык
  setPeriodLabel();
  await p;
  setPeriodLabel();
};

// ── helpers ──────────────────────────────────────────────────────────────────

const sumBy = (list, f) => list.reduce((s, x) => s + f(x), 0);
const money = n => (n < 0 ? '−' : '') + fmtAbs(Math.round(n));
const used = e => Math.max(e.planned, e.actual);      // строка занимает большее из плана и факта
// «Непредвиденные» среди обязательных — резерв, а не платёж: actual = сколько из него уже взяли
// на перерасход. Взятое ушло в план траты, поэтому в обязательных считается только остаток.
const isReserve = e => e.type === 'mandatory' && /непредвид/i.test(e.name);
const reserveLeft = e => Math.max(0, e.planned - e.actual);
const reserveRow = () => state.entries.find(isReserve) || null;
const isPaid = e => !isReserve(e) && e.planned > 0 && e.actual >= e.planned;
const curMonthRow = () => state.allMonths.find(m => m.id === state.monthId) || null;

function catSort(list) {
  return [...list].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
}

// «1200+800» — новая сумма; «+500» и «-300» в начале — к текущему значению. null — не разобрали.
function parseSum(str, cur) {
  const s = String(str).replace(/\s/g, '').replace(/,/g, '.').replace(/−/g, '-');
  if (s === '') return 0;
  if (!/^[+\-]?\d+(\.\d+)?([+\-]\d+(\.\d+)?)*$/.test(s)) return null;
  const total = s.match(/[+\-]?\d+(\.\d+)?/g).map(Number).reduce((a, b) => a + b, 0);
  const v = /^[+\-]/.test(s) ? cur + total : total;
  return Math.round(v * 100) / 100;
}

function catDot(cat, handler, name) {
  return `<select class="cloud-category" style="--cat:${catColor(cat)}" title="${esc(catById(cat)?.name || 'Категория')}" aria-label="Категория: ${esc(name || 'Без названия')}" onchange="${handler}">
    ${CAT_ORDER.map(catById).filter(Boolean).map(c => `<option value="${esc(c.id)}" ${c.id === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
  </select>`;
}
function rowActions(id, backlog, name, disabled = '') {
  const label = esc(name || 'Без названия');
  return `<button type="button" class="mini-btn back" aria-label="${backlog ? 'В спринт' : 'В бэклог'}: ${label}" title="${backlog ? 'В спринт' : 'В бэклог'}"
      onclick="${backlog ? 'moveBacklogEntry' : 'entryToBacklog'}(${id})" ${disabled}>${backlog ? '↑' : '↓'}</button>
    <button type="button" class="mini-btn del" aria-label="Удалить: ${label}" title="Удалить"
      onclick="${backlog ? 'deleteBacklogEntry' : 'deleteEntry'}(${id})">×</button>`;
}

function followCategoryRow(kind, id) {
  const row = [...document.querySelectorAll(`.row[data-${kind}]`)].find(el => el.dataset[kind] === String(id));
  if (!row) return;
  row.querySelector('.cloud-category')?.focus({ preventScroll: true });
  row.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  row.classList.add('category-moved');
}

// ── расчёт ───────────────────────────────────────────────────────────────────

function calc() {
  const mandRows = state.entries.filter(e => e.type === 'mandatory');
  const plan     = state.entries.filter(e => e.type === 'planned');
  const mand     = sumBy(mandRows, e => isReserve(e) ? reserveLeft(e) : e.planned);
  const mandPaid = sumBy(mandRows.filter(isPaid), e => e.planned);
  const life     = state.income - mand - state.saved;
  const allocated = sumBy(plan, used);
  const spent    = sumBy(plan, e => e.actual);
  return { mand, mandPaid, life, allocated, spent, free: life - allocated };
}

// ── круговая сводка ──────────────────────────────────────────────────────────

function renderSummary() {
  const k = calc();

  $('h-free').textContent = money(k.free);
  $('h-free').classList.toggle('neg', k.free < 0);
  $('h-free-label').textContent = k.free < 0 ? 'Дефицит' : 'Свободно';
  $('h-left').textContent = money(k.allocated - k.spent);
  $('h-forecast').textContent = money(state.saved + Math.max(k.free, 0));

  renderBudgetChart('h-ring', 'h-legend', [
    { label: 'Обязательные', value: k.mand, color: '#64748b' },
    { label: 'Отложить', value: state.saved, color: '#7c3aed' },
    { label: 'Запланировано', value: k.allocated, color: 'var(--blue)' },
    { label: 'Свободно', value: Math.max(0, k.free), color: 'var(--green)' },
  ], `Распределение бюджета${k.free < 0 ? `. Дефицит: ${money(-k.free)}` : ''}`);

  renderBudgetChart('h-spending-ring', 'h-spending-legend', [
    { label: 'Потрачено', value: k.spent, color: 'var(--blue)' },
    { label: 'Осталось потратить', value: k.allocated - k.spent, color: '#93c5fd' },
  ], 'Запланированные траты');
}

function renderBudgetChart(ringId, legendId, parts, label) {
  const total = sumBy(parts, p => Math.max(0, p.value));
  let angle = 0;
  const stops = parts.filter(p => p.value > 0).map(p => {
    const start = angle;
    angle += p.value / total * 360;
    return `${p.color} ${start}deg ${angle}deg`;
  });
  const ring = $(ringId);
  ring.style.background = total > 0 ? `conic-gradient(${stops.join(',')})` : 'var(--border)';
  ring.setAttribute('aria-label', `${label}. ${parts.map(p => `${p.label}: ${money(p.value)}`).join('. ')}`);
  $(legendId).innerHTML =
    parts.map(p => `<div><dt><i aria-hidden="true" style="background:${p.color}"></i>${p.label}</dt><dd>${money(p.value)}</dd></div>`).join('');
}

// ── обязательные ─────────────────────────────────────────────────────────────

function renderMandatoryTotal() {
  const rows = state.entries.filter(e => e.type === 'mandatory');
  const k = calc();
  $('mandatory-total').textContent = rows.length
    ? `оплачено ${money(k.mandPaid)} · впереди ${money(k.mand - k.mandPaid)}` : '';
  return rows;
}

function renderMandatory() {
  const rows = catSort(renderMandatoryTotal());
  $('mandatory-body').innerHTML = rows.map(e => {
    const id = idArg(e.id);
    const res = isReserve(e);
    return `
    <div class="row-wrap">
      <div class="row r-mand ${isPaid(e) ? 'is-paid' : ''}" data-eid="${e.id}">
        ${res ? '<div></div>' : `<label class="paid" title="Оплачено"><input aria-label="Оплачено: ${esc(e.name || 'Без названия')}" type="checkbox" ${isPaid(e) ? 'checked' : ''} onchange="setPaid(${id},this.checked)"></label>`}
        ${catDot(e.category, `cycleEntryCat(${id},this.value)`, e.name)}
        <div class="name-cell">
          <input class="ci" aria-label="Название: ${esc(e.name || 'Без названия')}" data-f="name" value="${esc(e.name)}" placeholder="Название"
            onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
          ${res ? `<span class="badge reserve" title="Резерв на перерасход">${e.actual ? 'осталось ' + money(reserveLeft(e)) : 'резерв'}</span>` : ''}
        </div>
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(e.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <button class="mini-btn del" aria-label="Удалить: ${esc(e.name || 'Без названия')}" onclick="deleteEntry(${id})">×</button>
      </div>
    </div>`;
  }).join('');
}

async function setPaid(eid, paid) {
  const idx = state.entries.findIndex(e => e.id === eid);
  if (idx === -1) return;
  const cur = state.entries[idx];
  const actual = paid ? cur.planned : 0;
  await api.updateEntry(eid, { actual });
  state.entries[idx] = { ...cur, actual };
  renderSummary();
  renderMandatory();
  flash(paid ? 'Оплачено' : 'Отметка снята');
}

// ── траты спринта ────────────────────────────────────────────────────────────

function renderTabs() {
  const tabs = [{ id: 'all', name: 'Все', color: 'var(--text)' },
    ...CAT_ORDER.map(catById).filter(Boolean)];
  $('cat-tabs').innerHTML = '<span class="lbl">Фильтр трат:</span>' + tabs.map(c => `
    <button class="cat-tab ${state.catFilter === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="filterCat('${c.id}')">${esc(c.name)}</button>`).join('');
}

function plannedTotals() {
  const all = state.entries.filter(e => e.type === 'planned');
  const filtered = catSort(state.catFilter === 'all' ? all : all.filter(e => e.category === state.catFilter));
  const totPlan = sumBy(filtered, e => e.planned);
  const totActual = sumBy(filtered, e => e.actual);
  return { filtered, totPlan, totActual, totRem: totPlan - totActual };
}

function remInfo(e) {
  const rem = e.planned - e.actual;
  return {
    // у траты вне плана весь факт — перерасход: красным, чтобы можно было покрыть
    cls: rem > 0 ? 'pos' : rem < 0 ? 'neg' : 'zero',
    text: e.planned > 0 || e.actual > 0 ? money(rem) : '—',
  };
}
const offPlan = e => e.planned === 0 && e.actual > 0;

function renderPlannedTotals() {
  const { filtered, totPlan, totActual, totRem } = plannedTotals();
  $('planned-total').textContent = filtered.length ? `потрачено ${money(totActual)} из ${money(totPlan)}` : '';
  const f = isMobile() ? fmtK : money;
  $('planned-foot').innerHTML = filtered.length > 1 ? `
    <div></div><div>Итого (${filtered.length})</div>
    <div class="r">${f(totPlan)}</div><div class="r">${f(totActual)}</div>
    <div class="r ${totRem >= 0 ? 'pos' : 'neg'}">${f(totRem)}</div><div></div><div></div>` : '';
  $('planned-foot').classList.toggle('hidden', filtered.length < 2);
}

function renderPlanned() {
  const { filtered } = plannedTotals();
  $('planned-body').innerHTML = filtered.map(e => {
    const r = remInfo(e);
    const id = idArg(e.id);
    return `
    <div class="row-wrap">
      <div class="row r-plan" data-eid="${e.id}">
        ${catDot(e.category, `cycleEntryCat(${id},this.value)`, e.name)}
        <div class="name-cell">
          <input class="ci" aria-label="Название: ${esc(e.name || 'Без названия')}" data-f="name" value="${esc(e.name)}" placeholder="Название"
            onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
          <span class="badge ${offPlan(e) ? '' : 'hidden'}">вне плана</span>
        </div>
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(e.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} aria-label="Факт: ${esc(e.name || 'Без названия')}" data-f="actual" inputmode="tel" value="${e.actual || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <button type="button" class="rem ${r.cls}" aria-label="Остаток: ${esc(e.name || 'Без названия')}. ${esc(r.text)}${e.actual > e.planned ? '. Покрыть перерасход' : ''}" ${e.actual > e.planned ? '' : 'disabled'} onclick="openCover(${id})">${r.text}</button>
        ${rowActions(id, false, e.name)}
      </div>
    </div>`;
  }).join('');
  renderPlannedTotals();
}

function patchPlannedRow(eid) {
  const e = state.entries.find(x => x.id === eid);
  const row = document.querySelector(`.row[data-eid="${eid}"]`);
  if (!e || !row) return;
  const r = remInfo(e);
  const rem = row.querySelector('.rem');
  rem.className = `rem ${r.cls}`;
  rem.textContent = r.text;
  rem.disabled = e.actual <= e.planned;
  rem.setAttribute('aria-label', `Остаток: ${e.name || 'Без названия'}. ${r.text}${rem.disabled ? '' : '. Покрыть перерасход'}`);
  row.querySelector('.badge').classList.toggle('hidden', !offPlan(e));
  renderPlannedTotals();
}

async function saveEntry(eid) {
  const row = document.querySelector(`.row[data-eid="${eid}"]`);
  const idx = state.entries.findIndex(e => e.id === eid);
  if (!row || idx === -1) return;
  const cur = state.entries[idx];
  const patch = {
    name: row.querySelector('[data-f=name]').value,
    planned: num(row.querySelector('[data-f=planned]').value),
  };
  const factInp = row.querySelector('[data-f=actual]');
  const raw = factInp ? factInp.value : '';
  if (factInp) {
    const v = parseSum(raw, cur.actual);
    if (v === null) { factInp.classList.add('bad'); flash('Не понял сумму: ' + raw, true); return; }
    factInp.classList.remove('bad');
    patch.actual = v;
  } else if (isPaid(cur)) {
    patch.actual = patch.planned;   // оплаченный платёж остаётся оплаченным при правке суммы
  }
  if (Object.keys(patch).every(k => cur[k] === patch[k])) {
    if (factInp) factInp.value = cur.actual || '';
    return;
  }
  await api.updateEntry(eid, patch);
  state.entries[idx] = { ...cur, ...patch };
  if (factInp) {
    factInp.value = patch.actual || '';
    if (/\d[+\-]|^[+\-]/.test(raw.replace(/\s/g, '')) && patch.actual !== cur.actual) {
      flash(`${cur.name || 'Строка'}: ${money(cur.actual)} → ${money(patch.actual)}`);
    }
  }
  renderSummary();
  if (cur.type !== 'mandatory') patchPlannedRow(eid);
  else if (isReserve(cur) !== isReserve(state.entries[idx]) || isReserve(cur)) renderMandatory();
  else renderMandatoryTotal();
}

async function cycleEntryCat(eid, category) {
  const e = state.entries.find(x => x.id === eid);
  if (!e) return;
  const monthId = state.monthId;
  await api.updateEntry(eid, { category });
  e.category = category;
  if (state.monthId !== monthId) return;
  if (e.type === 'planned' && state.catFilter !== 'all' && state.catFilter !== category) {
    state.catFilter = 'all';
    renderTabs();
  }
  renderAll();
  followCategoryRow('eid', eid);
  flash('Категория: ' + catById(category).name);
}

async function addEntry(type) {
  if (!state.monthId) return;
  const cat = (state.catFilter !== 'all' && type === 'planned') ? state.catFilter : defaultCat();
  const entry = await api.createEntry({
    month_id: state.monthId, type, category: cat, name: '', planned: 0, actual: 0,
  });
  upsert(state.entries, entry);
  if (type === 'mandatory') renderMandatory(); else renderPlanned();
  const input = document.querySelector(`.row[data-eid="${entry.id}"] [data-f=name]`);
  if (input) input.focus();
}

// у бэклога нет факта: потраченное по строке при переносе пропадёт — спрашиваем
const coreEntryToBacklog = entryToBacklog;
entryToBacklog = function (eid) {
  const e = state.entries.find(x => x.id === eid);
  if (!e || !e.actual) return coreEntryToBacklog(eid);
  openConfirm('Перенести в бэклог?',
    `По «${e.name || 'строке'}» уже потрачено ${money(e.actual)}. В бэклоге факта нет, эта сумма пропадёт из спринта.`,
    'Перенести', () => coreEntryToBacklog(eid));
};

// ── перерасход: покрыть из отложенных или непредвиденных ─────────────────────
// План строки растёт до факта, источник уменьшается на ту же сумму. Перерасход до этого
// съедал «Свободно», теперь его оплачивает источник, и «Свободно» возвращается.
// Если в источнике меньше перерасхода, берём сколько есть.

let coverId = null;

function coverSources() {
  const r = reserveRow();
  return [
    { id: 'saved', title: 'Из отложенных', avail: state.saved,
      empty: 'отложенных нет' },
    { id: 'reserve', title: 'Из непредвиденных', avail: r ? reserveLeft(r) : 0,
      empty: r ? 'резерв исчерпан' : 'нет строки «Непредвиденные» в обязательных' },
  ];
}

function openCover(eid) {
  const e = state.entries.find(x => x.id === eid);
  if (!e || e.actual <= e.planned) return;
  coverId = eid;
  const over = e.actual - e.planned;
  $('cover-title').textContent = offPlan(e) ? `Вне плана ${money(over)}` : `Перерасход ${money(over)}`;
  $('cover-text').textContent = offPlan(e)
    ? `«${e.name || 'Строка'}»: потрачено ${money(e.actual)} без плана. План станет равен факту, а сумму возьмём из:`
    : `«${e.name || 'Строка'}»: план ${money(e.planned)}, факт ${money(e.actual)}. План вырастет до факта, а сумму возьмём из:`;
  $('cover-opts').innerHTML = coverSources().map(s => {
    const amt = Math.min(over, s.avail);
    const sub = amt <= 0 ? s.empty
      : `${money(s.avail)} → ${money(s.avail - amt)}${amt < over ? ` · покроет только ${money(amt)}` : ''}`;
    return `<button type="button" class="cover-opt" ${amt <= 0 ? 'disabled' : ''} onclick="coverFrom('${s.id}')">
      <b>${s.title}</b><span>${sub}</span></button>`;
  }).join('');
  openModal($('cover-overlay'));
}

function closeCover() { closeModal($('cover-overlay')); coverId = null; }

async function coverFrom(src) {
  const e = state.entries.find(x => x.id === coverId);
  closeCover();
  if (!e) return;
  const s = coverSources().find(x => x.id === src);
  const amt = Math.min(e.actual - e.planned, s.avail);
  if (amt <= 0) return;

  const planned = e.planned + amt;
  await api.updateEntry(e.id, { planned });
  e.planned = planned;

  if (src === 'saved') {
    const saved = state.saved - amt;
    await api.updateMonth(state.monthId, { saved });
    state.saved = saved;
    const row = curMonthRow();
    if (row) upsert(state.allMonths, { ...row, saved });
    $('saved-inp').value = saved || '';
  } else {
    const r = reserveRow();
    const actual = r.actual + amt;
    await api.updateEntry(r.id, { actual });
    r.actual = actual;
  }
  renderAll();
  flash(`${e.name || 'Строка'}: +${money(amt)} к плану ${src === 'saved' ? 'из отложенных' : 'из непредвиденных'}`);
}

// ── потратил вне плана ───────────────────────────────────────────────────────

let quickCat = 'shared';

function openQuick() {
  if (!state.monthId) return;
  quickCat = state.catFilter !== 'all' ? state.catFilter : 'shared';
  $('q-sum').value = '';
  $('q-name').value = '';
  $('q-names').innerHTML = [...new Set(state.entries.filter(e => e.type === 'planned' && e.name).map(e => e.name))]
    .map(n => `<option value="${esc(n)}">`).join('');
  renderWho();
  openModal($('sheet-overlay'));
  $('q-sum').focus();
}

function closeQuick() { closeModal($('sheet-overlay')); }

function renderWho() {
  $('q-who').innerHTML = CAT_ORDER.map(catById).filter(Boolean).map(c => `
    <button type="button" class="cat-tab ${quickCat === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="quickCat='${c.id}';renderWho()">${esc(c.name)}</button>`).join('');
}

async function saveQuick(ev) {
  ev.preventDefault();
  const v = parseSum($('q-sum').value, 0);
  if (!v) { $('q-sum').focus(); return; }
  const name = $('q-name').value.trim() || 'Без названия';
  const ex = state.entries.find(e => e.type === 'planned' && e.category === quickCat
    && e.name.trim().toLowerCase() === name.toLowerCase());
  if (ex) {
    const actual = ex.actual + v;
    await api.updateEntry(ex.id, { actual });
    ex.actual = actual;
    flash(`${ex.name}: +${money(v)} к факту`);
  } else {
    const entry = await api.createEntry({
      month_id: state.monthId, type: 'planned', category: quickCat, name, planned: 0, actual: v,
    });
    upsert(state.entries, entry);
    flash('Записано вне плана');
  }
  closeQuick();
  renderAll();
}

function onEscape() {
  const active = activeModal();
  if (active === $('pad-overlay')) closePad();
  else if (active === $('sheet-overlay')) closeQuick();
  else if (active === $('cover-overlay')) closeCover();
}

// ── бэклог ───────────────────────────────────────────────────────────────────

function renderBacklog() {
  renderBacklogTotal();
  $('backlog-body').innerHTML = catSort(state.backlog).map(b => {
    const id = idArg(b.id);
    const dis = !state.monthId ? 'disabled' : '';
    return `
    <div class="row-wrap">
      <div class="row r-back" data-bid="${b.id}">
        ${catDot(b.category, `cycleBacklogCat(${id},this.value)`, b.name)}
        <input class="ci" aria-label="Название: ${esc(b.name || 'Без названия')}" data-f="name" value="${esc(b.name)}" placeholder="Название"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(b.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${b.planned || ''}" placeholder="0"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
        ${rowActions(id, true, b.name, dis)}
      </div>
    </div>`;
  }).join('');
}

async function saveBacklogEntry(bid) {
  const row = document.querySelector(`.row[data-bid="${bid}"]`);
  const item = state.backlog.find(b => b.id === bid);
  if (!row || !item) return;
  const patch = {
    name: row.querySelector('[data-f=name]').value,
    planned: num(row.querySelector('[data-f=planned]').value),
  };
  if (patch.name === item.name && patch.planned === item.planned) return;
  await api.updateBacklog(bid, patch);
  Object.assign(item, patch);
  renderBacklogTotal();
}

async function cycleBacklogCat(bid, category) {
  const item = state.backlog.find(b => b.id === bid);
  if (!item) return;
  await api.updateBacklog(bid, { category });
  item.category = category;
  renderBacklog();
  followCategoryRow('bid', bid);
}

async function addBacklogEntry() {
  const item = await api.createBacklog({ category: defaultCat(), name: '', planned: 0 });
  upsert(state.backlog, item);
  if (!backlogOpen) toggleBacklog();
  renderBacklog();
  const input = document.querySelector(`.row[data-bid="${item.id}"] [data-f=name]`);
  if (input) input.focus();
}

// ── выход с подтверждением ───────────────────────────────────────────────────

function confirmLogout() {
  openConfirm('Выйти из аккаунта?', 'Чтобы зайти снова, понадобятся почта и пароль.', 'Выйти', doLogout);
}

// ── цифровая панель для сумм на телефоне ────────────────────────────────────
// Вместо системной клавиатуры: + и − рядом с цифрами, подсказки по плану,
// переключение План/Факт без закрытия. На компьютере поля печатаются как обычно.

const touchUI = () => window.matchMedia('(pointer: coarse)').matches;
function padAttrs() { return touchUI() ? `readonly onclick="openPad(this)" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPad(this); }"` : 'inputmode="decimal"'; }

let pad = null;   // { kind: 'entry'|'backlog', id, field, expr }

const padItem = () => pad.kind === 'entry'
  ? state.entries.find(e => e.id === pad.id)
  : state.backlog.find(b => b.id === pad.id);
const padOld = () => { const it = padItem(); return it ? it[pad.field] : 0; };

function openPad(inp) {
  const row = inp.closest('.row');
  if (!row) return;
  inp.focus();
  const kind = row.dataset.eid ? 'entry' : 'backlog';
  const raw = row.dataset.eid || row.dataset.bid;
  const id = /^\d+$/.test(raw) ? Number(raw) : raw;
  pad = { kind, id, field: inp.dataset.f, expr: '' };
  renderPad();
  openModal($('pad-overlay'));
}

function closePad() { closeModal($('pad-overlay')); pad = null; }

// четверть суммы, округлённая до круглого: до 1000 — до сотен, до 10К — до 500, дальше — до тысяч
function roundNice(x) {
  const step = x < 1000 ? 100 : x < 10000 ? 500 : 1000;
  return Math.round(x / step) * step;
}
function quarterSteps(total) {
  if (!(total > 0)) return [];
  return [...new Set([1, 2, 3].map(k => roundNice(total * k / 4)))].filter(v => v > 0 && v < total);
}

function padChips() {
  const it = padItem();
  if (!it || pad.kind !== 'entry') return [];
  const chips = [];
  if (pad.field === 'actual') {
    if (it.planned > it.actual) chips.push({ label: `Закрыть всё · ${money(it.planned)}`, expr: String(it.planned) });
    quarterSteps(it.planned).filter(v => v < it.planned - it.actual)
      .forEach(v => chips.push({ label: '+' + money(v), expr: '+' + v }));
  } else if (it.type === 'planned') {
    if (it.actual > 0 && it.actual !== it.planned) chips.push({ label: `= факт · ${money(it.actual)}`, expr: String(it.actual) });
    quarterSteps(it.planned).forEach(v => chips.push({ label: '+' + money(v), expr: '+' + v }));
  }
  return chips;
}

function renderPad() {
  const it = padItem();
  if (!it) { closePad(); return; }
  const old = padOld();
  const isPlan = pad.kind === 'entry' && it.type === 'planned';
  $('pad-title').textContent = it.name || 'Без названия';
  $('pad-tabs').innerHTML = isPlan
    ? ['planned', 'actual'].map(f => `<button type="button" class="pad-tab ${pad.field === f ? 'active' : ''}"
        onclick="padField('${f}')">${f === 'planned' ? 'План' : 'Факт'}</button>`).join('')
    : `<span class="pad-tab active">${pad.kind === 'backlog' ? 'Сумма' : 'Сумма платежа'}</span>`;
  const v = pad.expr === '' ? null : parseSum(pad.expr, old);
  $('pad-display').innerHTML = pad.expr === ''
    ? `<span class="pad-ph">${old ? fmtAbs(old) : '0 ₽'}</span>`
    : esc(pad.expr.replace(/([+\-])/g, ' $1 ').trim());
  $('pad-preview').textContent = pad.expr === '' ? 'введи новую сумму или +сколько добавить'
    : v === null ? 'допиши число'
    : v < 0 ? `было ${money(old)} → меньше нуля нельзя`
    : `было ${money(old)} → станет ${money(v)}`;
  $('pad-chips').innerHTML = padChips().map(c =>
    `<button type="button" class="pad-chip" onclick="padChip('${c.expr}')">${c.label}</button>`).join('');
  $('pad-ok').disabled = pad.expr !== '' && (v === null || v < 0);
}

function padField(f) { pad.field = f; pad.expr = ''; renderPad(); }
function padChip(expr) { pad.expr = expr; renderPad(); }

function padKey(k) {
  if (!pad) return;
  if (navigator.vibrate) navigator.vibrate(5);
  let s = pad.expr;
  if (k === 'back') s = s.slice(0, -1);
  else if (k === 'clear') s = '';
  else if (k === '+' || k === '-') s = /[+\-]$/.test(s) ? s.slice(0, -1) + k : s + k;
  else if (s.length < 24) s += k;
  pad.expr = s;
  renderPad();
}

async function padDone() {
  if (!pad) return;
  if (pad.expr === '') { closePad(); return; }
  const old = padOld();
  const v = parseSum(pad.expr, old);
  if (v === null || v < 0) return;
  const { kind, id, field } = pad;
  const it = padItem();
  const row = document.querySelector(`.row[data-${kind === 'entry' ? 'eid' : 'bid'}="${id}"]`);
  closePad();
  if (!row || v === old) return;
  row.querySelector(`[data-f=${field}]`).value = v;
  if (kind === 'entry') await saveEntry(id); else await saveBacklogEntry(id);
  flash(`${it.name || 'Строка'}: ${money(old)} → ${money(v)}`);
}

document.addEventListener('keydown', e => {
  if (!pad) return;
  if (/^\d$/.test(e.key) || e.key === '+' || e.key === '-') padKey(e.key);
  else if (e.key === 'Backspace') padKey('back');
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); padDone(); }
});
