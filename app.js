import * as finance from './shared/domain.mjs';
import { showBacklog, reserveControl, refreshData, doLogout, state, cats, api, $, fmtAbs, esc, isMobile, num, fmtK, upsert, idArg, isEditing, flash, catById, catColor, defaultCat, renderAll, activeModal, openModal, closeModal, openConfirm, renderBacklogTotal, setView, renderSummary, renderMandatoryTotal, renderMandatory, renderTabs, plannedTotals, remInfo, renderPlannedTotals, renderPlanned, patchPlannedRow, saveEntry, renderBacklog, saveBacklogEntry, localEntryToBacklog } from './shared/core.js';

// Cloud view: explicit implementation of the shared controller view port.
const MON_GEN = ['января','февраля','марта','апреля','мая','июня',
                 'июля','августа','сентября','октября','ноября','декабря'];
const MON_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

function periodTitle(y, m, h) {
  const yr = y === new Date().getFullYear() ? '' : ' ' + y;
  if (h === 1) return `10 – 24 ${MON_GEN[m - 1]}${yr}`;
  return `25 ${MON_SHORT[m - 1]} – 9 ${MON_SHORT[m % 12]}${yr}`;
}

// сколько дней спринта осталось, считая сегодня; null — спринт не текущий
function daysLeft() { return finance.periodDaysLeft(state, new Date()); }

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

// ── helpers ──────────────────────────────────────────────────────────────────

const { sumBy, used, isReserve, reserveLeft, isPaid, periodRange } = finance;
const money = n => (n < 0 ? '−' : '') + fmtAbs(Math.round(n));
const reserveRow = () => state.entries.filter(isReserve).sort((a, b) => a.id - b.id)[0] || null;
const curMonthRow = () => state.allMonths.find(m => m.id === state.monthId) || null;

function catSort(list) {
  return finance.sortCategories(list, cats);
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
  return `<select class="cloud-category" style="--cat:${catColor(cat)}" title="${esc(catById(cat)?.name || 'Категория')}" aria-label="Категория: ${esc(name || 'Без названия')}" onchange="runSaveAction(() => ${handler})">
    ${cats.map(c => `<option value="${esc(c.id)}" ${c.id === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
  </select>`;
}
function rowActions(id, backlog, name, disabled = '') {
  const label = esc(name || 'Без названия');
  return `<button type="button" class="mini-btn back" aria-label="${backlog ? 'В спринт' : 'В будущие покупки'}: ${label}" title="${backlog ? 'В спринт' : 'В будущие покупки'}"
      onclick="runSaveAction(() => ${backlog ? 'moveBacklogEntry' : 'entryToBacklog'}(${id}))" ${disabled}>${backlog ? '↑' : '↓'}</button>
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
  return finance.cloudSummary(state);
}

// ── круговая сводка ──────────────────────────────────────────────────────────

function cloudRenderSummary() {
  const k = calc();

  $('h-income').textContent = money(state.income);
  $('h-free').textContent = money(k.free);
  $('h-free').classList.toggle('neg', k.free < 0);
  $('h-free-label').textContent = k.free < 0 ? 'Дефицит' : 'Свободно';
  $('h-left').textContent = money(k.allocated - k.spent);
  $('h-forecast').textContent = money(state.saved + Math.max(k.free, 0));

  renderBudgetChart('h-ring', 'h-legend', [
    { label: 'Обязательные', value: k.mand, color: 'var(--viz-mandatory)' },
    { label: 'Отложено', value: state.saved, color: 'var(--viz-saved)' },
    { label: 'Выделено на траты', value: k.allocated, color: 'var(--viz-plan)' },
    { label: k.free < 0 ? 'Дефицит' : 'Свободно', value: k.free, color: k.free < 0 ? 'var(--viz-over)' : 'var(--viz-left)' },
  ], `Распределение бюджета${k.free < 0 ? `. Дефицит: ${money(-k.free)}` : ''}`);

  renderBudgetChart('h-spending-ring', 'h-spending-legend', [
    { label: 'Потрачено', value: k.spent, color: 'var(--viz-actual)' },
    { label: 'Осталось без перерасходов', value: k.allocated - k.spent, color: 'var(--viz-left)' },
  ], 'Выделено на траты с учётом перерасхода');
}

function chartShare(value, total) {
  const percent = total > 0 ? value / total * 100 : 0;
  return percent.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
}

let chartPalette = (ringId, parts) => parts;
function setChartPalette(map) { chartPalette = map; }
function renderBudgetChart(ringId, legendId, parts, label) {
  parts = chartPalette(ringId, parts);
  const total = sumBy(parts, p => Math.max(0, p.value));
  const showShares = ringId === 'h-ring';
  let angle = 0;
  const visible = parts.filter(p => p.value > 0);
  const stops = visible.map(p => {
    const start = angle;
    angle += p.value / total * 360;
    const gap = visible.length > 1 ? Math.min(1.5, (angle - start) / 4) : 0;
    return `${p.color} ${start}deg ${angle - gap}deg, var(--surface) ${angle - gap}deg ${angle}deg`;
  });
  const ring = $(ringId);
  ring.style.background = total > 0 ? `conic-gradient(${stops.join(',')})` : 'var(--border)';
  ring.setAttribute('aria-label', `${label}. ${parts.map(p => `${p.label}: ${money(p.value)}${showShares ? `, ${chartShare(p.value, total)}` : ''}`).join('. ')}`);
  $(legendId).innerHTML =
    parts.map(p => `<div><dt><i aria-hidden="true" style="background:${p.color}"></i>${p.label}</dt><dd>${money(p.value)}${showShares ? `<small class="chart-share">${chartShare(p.value, total)}</small>` : ''}</dd></div>`).join('');
}

// ── обязательные ─────────────────────────────────────────────────────────────

function cloudRenderMandatoryTotal() {
  const rows = state.entries.filter(e => e.type === 'mandatory');
  const k = calc();
  $('mandatory-total').textContent = rows.length
    ? `оплачено ${money(k.mandPaid)} · впереди ${money(k.mand - k.mandPaid)}` : '';
  return rows;
}

function cloudRenderMandatory() {
  const rows = catSort(renderMandatoryTotal());
  $('mandatory-body').innerHTML = rows.map(e => {
    const id = idArg(e.id);
    const res = isReserve(e);
    return `
    <div class="row-wrap">
      <div class="row r-mand ${isPaid(e) ? 'is-paid' : ''}" data-eid="${e.id}">
        ${res ? '<div></div>' : `<label class="paid" title="Оплачено"><input aria-label="Оплачено: ${esc(e.name || 'Без названия')}" type="checkbox" ${isPaid(e) ? 'checked' : ''} onchange="runSaveAction(() => setPaid(${id},this.checked))"></label>`}
        ${catDot(e.category, `cycleEntryCat(${id},this.value)`, e.name)}
        <div class="name-cell">
          <input class="ci" aria-label="Название: ${esc(e.name || 'Без названия')}" data-f="name" value="${esc(e.name)}" placeholder="Название"
            onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="enterBlur(event)">
          ${reserveControl(e)}
          ${res ? `<span class="badge reserve" title="Резерв на перерасход">${e.actual ? 'осталось ' + money(reserveLeft(e)) : 'резерв'}</span>` : ''}
        </div>
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(e.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="enterBlur(event)">
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

function cloudRenderTabs() {
  const tabs = [{ id: 'all', name: 'Все', color: 'var(--text)' },
    ...cats];
  $('cat-tabs').innerHTML = '<span class="lbl">Фильтр трат:</span>' + tabs.map(c => `
    <button class="cat-tab ${state.catFilter === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="filterCat('${c.id}')">${esc(c.name)}</button>`).join('');
}

function cloudPlannedTotals() {
  return finance.plannedTotalsFor(state.entries, state.catFilter, cats);
}

function cloudRemInfo(e) {
  const rem = e.planned - e.actual;
  return {
    // у траты вне плана весь факт — перерасход: красным, чтобы можно было покрыть
    cls: rem > 0 ? 'pos' : rem < 0 ? 'neg' : 'zero',
    text: e.planned > 0 || e.actual > 0 ? money(rem) : '—',
  };
}
const offPlan = e => e.planned === 0 && e.actual > 0;

function entryProgress(e) {
  const remaining = Math.max(0, e.planned - e.actual);
  const total = remaining > 0 ? e.planned + e.actual + remaining : Math.max(e.planned, e.actual, 1);
  const plan = remaining > 0 ? e.planned / total * 100 : 0;
  const within = Math.max(0, Math.min(e.planned, e.actual)) / total * 100;
  const over = Math.max(0, e.actual - e.planned) / total * 100;
  const left = remaining / total * 100;
  return `<div class="entry-progress" role="img" aria-label="План: ${money(e.planned)}. Факт: ${money(e.actual)}. Осталось: ${money(e.planned - e.actual)}" title="${esc(e.name || 'Трата')}: ${money(e.actual)} из ${money(e.planned)}">
    <i class="progress-plan" style="width:${plan}%"></i><i class="progress-actual" style="width:${within}%"></i><i class="progress-over" style="width:${over}%"></i><i class="progress-left" style="width:${left}%"></i>
  </div>`;
}

function remainingText(e) {
  const r = remInfo(e);
  return `<span class="remaining-full">${r.text}</span><span class="remaining-short">${e.planned || e.actual ? fmtK(e.planned - e.actual) : '—'}</span>`;
}

function cloudRenderPlannedTotals() {
  const { filtered, totPlan, totActual, totRem } = plannedTotals();
  $('planned-total').textContent = filtered.length ? `потрачено ${money(totActual)} · план ${money(totPlan)}` : '';
  const f = isMobile() ? fmtK : money;
  $('planned-foot').innerHTML = filtered.length > 1 ? `
    <div></div><div>Итого (${filtered.length})</div>
    <div class="r">${f(totPlan)}</div><div class="r">${f(totActual)}</div>
    <div class="r ${totRem >= 0 ? 'pos' : 'neg'}">${f(totRem)}</div><div></div><div></div>` : '';
  $('planned-foot').classList.toggle('hidden', filtered.length < 2);
}

function cloudRenderPlanned() {
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
            onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="enterBlur(event)">
          <span class="badge ${offPlan(e) ? '' : 'hidden'}">вне плана</span>
        </div>
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(e.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} aria-label="Факт: ${esc(e.name || 'Без названия')}" data-f="actual" inputmode="tel" value="${e.actual || ''}" placeholder="0"
          onblur="runSaveAction(() => saveEntry(${id}))" onkeydown="enterBlur(event)">
        <button type="button" class="rem ${r.cls}" title="Осталось: ${r.text}" aria-label="Остаток: ${esc(e.name || 'Без названия')}. ${esc(r.text)}${e.actual > e.planned ? '. Покрыть перерасход' : ''}" ${e.actual > e.planned ? '' : 'disabled'} onclick="openCover(${id})">${remainingText(e)}</button>
        ${rowActions(id, false, e.name)}
      </div>
      ${entryProgress(e)}
    </div>`;
  }).join('');
  renderPlannedTotals();
}

function cloudPatchPlannedRow(eid) {
  const e = state.entries.find(x => x.id === eid);
  const row = document.querySelector(`.row[data-eid="${eid}"]`);
  if (!e || !row) return;
  const r = remInfo(e);
  const rem = row.querySelector('.rem');
  rem.className = `rem ${r.cls}`;
  rem.innerHTML = remainingText(e);
  rem.title = `Осталось: ${r.text}`;
  rem.disabled = e.actual <= e.planned;
  rem.setAttribute('aria-label', `Остаток: ${e.name || 'Без названия'}. ${r.text}${rem.disabled ? '' : '. Покрыть перерасход'}`);
  row.querySelector('.badge').classList.toggle('hidden', !offPlan(e));
  row.parentElement.querySelector('.entry-progress').outerHTML = entryProgress(e);
  renderPlannedTotals();
}

async function cloudSaveEntry(eid) {
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

async function cloudAddEntry(type) {
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

// у будущих покупок нет факта: потраченное по строке при переносе пропадёт — спрашиваем
function cloudEntryToBacklog(eid) {
  const e = state.entries.find(x => x.id === eid);
  if (!e || !e.actual) return localEntryToBacklog(eid);
  openConfirm('Перенести в будущие покупки?',
    `По «${e.name || 'строке'}» уже потрачено ${money(e.actual)}. В списке будущих покупок факта нет, эта сумма пропадёт из спринта.`,
    'Перенести', () => localEntryToBacklog(eid));
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
    return `<button type="button" class="cover-opt" ${amt <= 0 ? 'disabled' : ''} onclick="runSaveAction(() => coverFrom('${s.id}'))">
      <b>${s.title}</b><span>${sub}</span></button>`;
  }).join('');
  openModal($('cover-overlay'));
}

function closeCover() { closeModal($('cover-overlay')); coverId = null; }

async function coverFrom(src) {
  const e = state.entries.find(x => x.id === coverId);
  if (!e) return;
  if (api.coverOverrun) {
    await api.coverOverrun({ month_id: state.monthId, id: e.id, source: src });
    closeCover();
    try { await refreshData(); } catch { flash('Записано. Не удалось перечитать данные. Обновите вручную.', true); }
    return;
  }
  closeCover();
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

let quickCat = null;
let quickMonthId = null;
let quickSaving = false;
let quickBlocked = false;
let cloudContext = 0;
function resetCloudContext() {
  cloudContext++;
  quickCat = quickMonthId = coverId = pad = null;
  quickSaving = quickBlocked = false;
  $('q-error').textContent = '';
  for (const id of ['q-name', 'q-sum', 'q-actual']) $(id).value = '';
}

function quickSources() {
  return [{ id: 'free', title: 'Из свободных', avail: Math.max(0, calc().free) }, ...coverSources()];
}

function updateQuickSource() {
  const outsidePlan = $('q-offplan').checked;
  $('q-source-fields').classList.toggle('hidden', !outsidePlan);
  $('q-actual-field').classList.toggle('hidden', outsidePlan);
  $('q-sum-label').textContent = outsidePlan ? 'Сумма, ₽' : 'План, ₽';
  const source = quickSources().find(s => s.id === $('q-source').value);
  const amount = parseSum($('q-sum').value, 0);
  const shortage = source && amount > 0 ? Math.max(0, amount - source.avail) : 0;
  $('q-source-note').textContent = outsidePlan && shortage
    ? source.id === 'free' ? `Не хватает ${money(shortage)}: появится дефицит.` : `Не хватает ${money(shortage)}. Выбери другой источник.`
    : '';
  $('q-save').disabled = quickSaving || quickBlocked || (outsidePlan && (!source || (source.id !== 'free' && shortage > 0)));
}

function openQuick(outsidePlan = false) {
  if (!state.monthId || quickSaving) return;
  quickMonthId = state.monthId;
  quickCat = state.catFilter !== 'all' ? state.catFilter : defaultCat();
  $('q-sum').value = '';
  $('q-actual').value = '';
  $('q-offplan').checked = outsidePlan;
  $('q-name').value = '';
  if (!quickBlocked) $('q-error').textContent = '';
  $('q-source').innerHTML = quickSources().map(s =>
    `<option value="${s.id}" ${s.id !== 'free' && s.avail <= 0 ? 'disabled' : ''}>${s.title} · ${money(s.avail)}</option>`
  ).join('');
  $('q-source').value = 'free';
  updateQuickSource();
  renderWho();
  openModal($('sheet-overlay'));
  $('q-name').focus();
}

function closeQuick() { if (!quickSaving) closeModal($('sheet-overlay')); }

function initPullToRefresh() {
  const indicator = $('pull-refresh');
  const label = $('pull-refresh-text');
  const threshold = 72;
  let start = null;
  let distance = 0;
  let refreshing = false;
  const reset = () => {
    start = null;
    distance = 0;
    delete indicator.dataset.state;
    indicator.style.removeProperty('--pull');
    label.textContent = '';
  };
  document.addEventListener('touchstart', event => {
    if (refreshing) return;
    reset();
    if (window.scrollY > 0 || event.touches.length !== 1 || activeModal() || isEditing()
      || $('app').classList.contains('hidden') || $('refresh-btn').disabled
      || event.target.closest('input,select,textarea,button,a,summary,[contenteditable]')) return;
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    distance = 0;
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!start || refreshing) return;
    if (event.touches.length !== 1 || activeModal() || window.scrollY > 0) { reset(); return; }
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (dy < 0 || Math.abs(dx) > Math.abs(dy)) { reset(); return; }
    if (dy <= 8) return;
    if (event.cancelable) event.preventDefault();
    distance = Math.min(100, dy * .55);
    indicator.style.setProperty('--pull', `${distance}px`);
    indicator.dataset.state = distance >= threshold ? 'ready' : 'pulling';
    label.textContent = distance >= threshold ? 'Отпустите, чтобы обновить' : 'Потяните для обновления';
  }, { passive: false });
  document.addEventListener('touchcancel', () => { if (!refreshing) reset(); }, { passive: true });
  document.addEventListener('touchend', async event => {
    if (!start || refreshing) return;
    if (event.touches.length || activeModal() || isEditing() || window.scrollY > 0) { reset(); return; }
    start = null;
    if (distance < threshold) { reset(); return; }
    refreshing = true;
    indicator.dataset.state = 'refreshing';
    label.textContent = 'Обновляю…';
    try { await refreshData(); }
    catch { flash('Не удалось обновить. Потяните ещё раз.'); }
    finally { refreshing = false; reset(); }
  }, { passive: true });
}

function pickQuickCategory(category) { quickCat = category; renderWho(); }

function renderWho() {
  $('q-who').innerHTML = cats.map(c => `
    <button type="button" class="cat-tab ${quickCat === c.id ? 'active' : ''}" style="--cat:${c.color}"
      onclick="pickQuickCategory('${c.id}')">${esc(c.name)}</button>`).join('');
}

async function saveQuick(ev) {
  ev.preventDefault();
  if (quickSaving || quickBlocked) return;
  if (!quickMonthId || state.monthId !== quickMonthId) { closeQuick(); return; }
  const outsidePlan = $('q-offplan').checked;
  const v = parseSum($('q-sum').value, 0);
  const actual = outsidePlan ? v : parseSum($('q-actual').value, 0);
  if (v === null || v < 0 || (outsidePlan && v === 0)) { $('q-sum').focus(); return; }
  if (actual === null || actual < 0) { $('q-actual').focus(); return; }
  const source = outsidePlan ? quickSources().find(s => s.id === $('q-source').value) : { id: 'free' };
  if (!source || (source.id !== 'free' && source.avail < v)) { updateQuickSource(); return; }
  const monthId = quickMonthId;
  const name = $('q-name').value.trim() || 'Без названия';
  const ex = outsidePlan && state.entries.find(e => e.type === 'planned' && e.category === quickCat
    && e.name.trim().toLowerCase() === name.toLowerCase());
  const category = quickCat;
  const patch = outsidePlan ? { planned: (ex ? used(ex) : 0) + v, actual: (ex ? ex.actual : 0) + v } : { planned: v, actual };
  if (api.quickExpense) {
    const context = cloudContext;
    quickSaving = true; updateQuickSource();
    try {
      if (outsidePlan) await api.quickExpense({ month_id: monthId, source: source.id, amount: v, ...(ex ? { id: ex.id } : { category, name }) });
      else await api.createEntry({ month_id: monthId, type: 'planned', category, name, planned: v, actual, is_reserve: false });
      if (context !== cloudContext) return false;
      quickSaving = false; closeQuick();
      try { await refreshData(); } catch { flash('Записано. Не удалось перечитать данные. Обновите вручную.', true); }
      return;
    } catch (error) { if (context === cloudContext) $('q-error').textContent = error.message || 'Не удалось записать расход. Повторите попытку.'; return false; }
    finally { if (context === cloudContext) { quickSaving = false; updateQuickSource(); } }
  }
  const reserve = source.id === 'reserve' ? reserveRow() : null;
  const before = source.id === 'saved' ? state.saved : reserve ? reserve.actual : 0;
  const after = source.id === 'saved' ? before - v : before + v;
  const writeSource = value => source.id === 'saved'
    ? api.updateMonth(monthId, { saved: value }) : api.updateEntry(reserve.id, { actual: value });
  const applySource = (value = after) => {
    if (source.id === 'saved') {
      const row = state.allMonths.find(m => m.id === monthId);
      if (row) upsert(state.allMonths, { ...row, saved: value });
      if (state.monthId === monthId) { state.saved = value; $('saved-inp').value = value || ''; }
    } else if (reserve && state.monthId === monthId) {
      const row = state.entries.find(e => e.id === reserve.id);
      if (row) row.actual = value;
    }
  };
  const controls = [...$('sheet-overlay').querySelectorAll('input, select, button')];
  quickSaving = true;
  controls.forEach(el => { el.disabled = true; });
  $('q-error').textContent = '';
  let debited = false;
  let saved = false;
  let entry;
  try {
    if (source.id !== 'free') { await writeSource(after); debited = true; }
    if (ex) {
      await api.updateEntry(ex.id, patch);
      entry = { ...ex, ...patch };
    } else {
      entry = await api.createEntry({ month_id: monthId, type: 'planned', category, name, ...patch });
    }
    saved = true;
  } catch {
    let message = 'Не удалось записать расход. Попробуй ещё раз.';
    if (debited) {
      try { await writeSource(before); applySource(before); }
      catch {
        applySource();
        quickBlocked = true;
        message = 'Расход не записан, но источник уменьшен. Проверь бюджет и обнови страницу перед повтором.';
      }
    }
    if (state.monthId === monthId) renderAll();
    $('q-error').textContent = message;
  } finally {
    quickSaving = false;
    controls.forEach(el => { el.disabled = false; });
    updateQuickSource();
  }
  if (!saved) return false;
  if (saved) {
    applySource();
    if (state.monthId === monthId) { upsert(state.entries, entry); renderAll(); }
    closeQuick();
    flash(outsidePlan ? `${name}: ${money(v)} · ${source.title.toLowerCase()}` : `${name}: добавлено в траты`);
  }
}

function onEscape() {
  const active = activeModal();
  if (active === $('pad-overlay')) closePad();
  else if (active === $('sheet-overlay')) closeQuick();
  else if (active === $('cover-overlay')) closeCover();
}

// ── будущие покупки ───────────────────────────────────────────────────────────────────

function cloudRenderBacklog() {
  renderBacklogTotal();
  $('backlog-body').innerHTML = catSort(state.backlog).map(b => {
    const id = idArg(b.id);
    const dis = !state.monthId ? 'disabled' : '';
    return `
    <div class="row-wrap">
      <div class="row r-back" data-bid="${b.id}">
        ${catDot(b.category, `cycleBacklogCat(${id},this.value)`, b.name)}
        <input class="ci" aria-label="Название: ${esc(b.name || 'Без названия')}" data-f="name" value="${esc(b.name)}" placeholder="Название"
          onblur="runSaveAction(() => saveBacklogEntry(${id}))" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} aria-label="План: ${esc(b.name || 'Без названия')}" data-f="planned" inputmode="decimal" value="${b.planned || ''}" placeholder="0"
          onblur="runSaveAction(() => saveBacklogEntry(${id}))" onkeydown="enterBlur(event)">
        ${rowActions(id, true, b.name, dis)}
      </div>
    </div>`;
  }).join('');
}

async function cloudSaveBacklogEntry(bid) {
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

async function cloudAddBacklogEntry() {
  const item = await api.createBacklog({ category: defaultCat(), name: '', planned: 0 });
  upsert(state.backlog, item);
  showBacklog();
  renderBacklog();
  const input = document.querySelector(`.row[data-bid="${item.id}"] [data-f=name]`);
  if (input) input.focus();
}

// ── выход с подтверждением ───────────────────────────────────────────────────

function confirmLogout() {
  openConfirm('Выйти из аккаунта?', 'Чтобы зайти снова, понадобятся почта и пароль.', 'Выйти', doLogout);
}

// ── цифровая панель для сумм на телефоне ────────────────────────────────────
// Всплывающая панель редактирует нажатую сумму. На компьютере поля печатаются как обычно.

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
  const fieldLabel = isPlan ? (pad.field === 'planned' ? 'План' : 'Факт')
    : pad.kind === 'backlog' ? 'Сумма' : 'Сумма платежа';
  $('pad-tabs').innerHTML = `<span class="pad-tab active">${fieldLabel}</span>`;
  const v = pad.expr === '' ? null : parseSum(pad.expr, old);
  $('pad-display').innerHTML = pad.expr === ''
    ? `<span class="pad-ph">${old ? fmtAbs(old) : '0 ₽'}</span>`
    : esc(pad.expr.replace(/([+\-])/g, ' $1 ').trim());
  $('pad-preview').textContent = pad.expr === '' || v === null ? ''
    : v < 0 ? `было ${money(old)} → меньше нуля нельзя`
    : `было ${money(old)} → станет ${money(v)}`;
  $('pad-chips').innerHTML = padChips().map(c =>
    `<button type="button" class="pad-chip" onclick="padChip('${c.expr}')">${c.label}</button>`).join('');
  $('pad-ok').disabled = pad.expr !== '' && (v === null || v < 0);
}

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
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); runSaveAction(() => padDone()); }
});

function installCloudView() { setView({ renderSummary: cloudRenderSummary, renderMandatoryTotal: cloudRenderMandatoryTotal, renderMandatory: cloudRenderMandatory, renderTabs: cloudRenderTabs, plannedTotals: cloudPlannedTotals, remInfo: cloudRemInfo, renderPlannedTotals: cloudRenderPlannedTotals, renderPlanned: cloudRenderPlanned, patchPlannedRow: cloudPatchPlannedRow, saveEntry: cloudSaveEntry, addEntry: cloudAddEntry, renderBacklog: cloudRenderBacklog, saveBacklogEntry: cloudSaveBacklogEntry, addBacklogEntry: cloudAddBacklogEntry, entryToBacklog: cloudEntryToBacklog, periodChanged: setPeriodLabel, contextChanged: resetCloudContext }); }
const cloudInlineHandlers = { setPaid, cycleEntryCat, cycleBacklogCat, openCover, closeCover, coverFrom, openQuick, closeQuick, updateQuickSource, saveQuick, confirmLogout, openPad, closePad, padKey, padDone, padChip, pickQuickCategory };

export { cloudInlineHandlers, setChartPalette, sumBy, used, installCloudView, money, calc, chartShare, openCover, closeCover, openQuick, closeQuick, initPullToRefresh, renderWho, onEscape, openPad, closePad };
