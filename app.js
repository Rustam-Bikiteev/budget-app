// Свой интерфейс версии с Supabase поверх shared/core.js: главная цифра «Свободно»,
// кошельки «Я + Общие» и «Насте», оплата обязательных, траты строками со свайпом.
//
// Подключается после core.js и до скрипта index.html. Функции с теми же именами,
// что в core.js (renderSummary, renderPlanned, saveEntry...), заменяют общие:
// core вызывает их по имени. free/ подключает только core.js и этого не видит.
//
// Схема данных та же. «Оплачено» у обязательного платежа = actual >= planned
// (поле actual у обязательных раньше не использовалось). Отметка перевода Насте
// живёт в months.transferred; пока колонки нет, кнопка перевода скрыта.

const CAT_ORDER   = ['me', 'shared', 'nastya'];
const MY_CATS     = ['me', 'shared'];   // мой кошелёк: личное и общее трачу я
const NASTYA      = 'nastya';           // её план переводится ей целиком
const NASTYA_LIMIT = 40000;
const MY_LIMIT_DEFAULT = 40000;

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

function myLimit() {
  try { return num(localStorage.getItem('budget.myLimit')) || MY_LIMIT_DEFAULT; }
  catch { return MY_LIMIT_DEFAULT; }
}
function setMyLimit(v) {
  try { localStorage.setItem('budget.myLimit', String(num(v) || MY_LIMIT_DEFAULT)); } catch {}
  renderSummary();
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

function catDot(cat, handler) {
  const c = catById(cat);
  return `<button class="catdot" tabindex="-1" style="background:${catColor(cat)}"
    title="${esc(c ? c.name : '—')}: нажми, чтобы сменить" onclick="${handler}"></button>`;
}
const nextCat = cat => CAT_ORDER[(CAT_ORDER.indexOf(cat) + 1) % CAT_ORDER.length];

// ── расчёт ───────────────────────────────────────────────────────────────────

function calc() {
  const mandRows = state.entries.filter(e => e.type === 'mandatory');
  const plan     = state.entries.filter(e => e.type === 'planned');
  const mand     = sumBy(mandRows, e => isReserve(e) ? reserveLeft(e) : e.planned);
  const mandPaid = sumBy(mandRows.filter(isPaid), e => e.planned);
  const life     = state.income - mand - state.saved;
  const allocated = sumBy(plan, used);
  const spent    = sumBy(plan, e => e.actual);
  const mine     = plan.filter(e => MY_CATS.includes(e.category));
  const nastya   = sumBy(plan.filter(e => e.category === NASTYA), used);
  return {
    mand, mandPaid, life, allocated, spent, free: life - allocated,
    mySpent: sumBy(mine, e => e.actual), myPlan: sumBy(mine, used), nastya,
  };
}

// ── сводка и кошельки ────────────────────────────────────────────────────────

let formulaOpen = false;
function toggleFormula() {
  formulaOpen = !formulaOpen;
  $('formula').classList.toggle('hidden', !formulaOpen);
  $('f-arrow').textContent = formulaOpen ? '▾' : '▸';
}

function renderSummary() {
  const k = calc();

  $('h-free').textContent = money(k.free);
  $('h-free').classList.toggle('neg', k.free < 0);
  $('h-forecast').textContent = money(state.saved + Math.max(k.free, 0));

  const base = Math.max(k.life, k.allocated, 1);
  const pct = v => Math.max(0, v / base * 100) + '%';
  $('h-bar').innerHTML =
    `<div style="width:${pct(k.spent)};background:var(--blue)"></div>` +
    `<div style="width:${pct(k.allocated - k.spent)};background:#bfdbfe"></div>` +
    `<div style="width:${pct(k.free)};background:var(--green)"></div>`;
  $('h-legend').innerHTML =
    `<span><i style="background:var(--blue)"></i>потрачено ${money(k.spent)}</span>` +
    `<span><i style="background:#bfdbfe"></i>в планах, ещё не потрачено ${money(k.allocated - k.spent)}</span>` +
    `<span><i style="background:var(--green)"></i>свободно ${money(k.free)}</span>` +
    `<span>из ${money(k.life)} на жизнь</span>`;

  $('f-mand').textContent = money(-k.mand);
  $('f-mand-sub').textContent = `оплачено ${money(k.mandPaid)}, впереди ${money(k.mand - k.mandPaid)}`;
  $('f-life').textContent = money(k.life);
  $('f-alloc').textContent = money(-k.allocated);
  $('f-alloc-sub').textContent = `по каждой строке берётся большее из плана и факта; уже потрачено ${money(k.spent)}`;
  $('f-free').textContent = money(k.free);
  $('f-free').classList.toggle('neg', k.free < 0);

  renderPockets(k);
}

function renderPockets(k) {
  const limit = myLimit();
  const left = limit - k.mySpent;
  const d = daysLeft();
  $('p-me-left').textContent = money(left);
  $('p-me-left').style.color = left < 0 ? 'var(--red)' : '';
  $('p-me-cap').textContent = left < 0 ? 'лимит превышен'
    : d ? `осталось из лимита · ~${money(left / d)} в день` : 'осталось из лимита';
  const mp = Math.min(100, limit ? k.mySpent / limit * 100 : 0);
  $('p-me-bar').style.width = mp + '%';
  $('p-me-bar').style.background = k.mySpent > limit ? 'var(--red)' : mp > 85 ? 'var(--amber)' : 'var(--c-me)';
  $('p-me-spent').textContent = money(k.mySpent);
  $('p-me-plan').textContent = money(k.myPlan) + (k.myPlan > limit ? ' · больше лимита' : '');
  const inp = $('p-me-limit');
  if (document.activeElement !== inp) inp.value = limit;

  $('p-n-sum').textContent = money(k.nastya);
  $('p-n-bar').style.width = Math.min(100, k.nastya / NASTYA_LIMIT * 100) + '%';
  $('p-n-limit').textContent = money(NASTYA_LIMIT);

  const row = curMonthRow();
  const btn = $('p-n-btn');
  const hasCol = !!row && 'transferred' in row;
  btn.classList.toggle('hidden', !hasCol);
  if (!hasCol) { $('p-n-warn').innerHTML = ''; return; }
  const sent = row.transferred;
  const diff = sent == null ? 0 : k.nastya - sent;
  $('p-n-warn').innerHTML = diff
    ? `<div class="warn">План изменился после перевода: ${diff > 0
        ? 'доперевести ' + money(diff) : 'переведено больше на ' + money(-diff)}</div>`
    : '';
  if (sent == null) { btn.className = 'transfer-btn'; btn.textContent = `Отметить: перевёл ${money(k.nastya)}`; }
  else { btn.className = 'transfer-btn done'; btn.textContent = `✓ Переведено ${money(sent)} (отменить)`; }
}

async function toggleTransfer() {
  const row = curMonthRow();
  if (!row) return;
  const value = row.transferred == null ? calc().nastya : null;
  await api.updateMonth(row.id, { transferred: value });
  upsert(state.allMonths, { ...row, transferred: value });
  renderSummary();
  flash(value == null ? 'Отметка перевода снята' : 'Перевод Насте отмечен');
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
        ${res ? '<div></div>' : `<label class="paid" title="Оплачено"><input type="checkbox" ${isPaid(e) ? 'checked' : ''} onchange="setPaid(${id},this.checked)"></label>`}
        ${catDot(e.category, `cycleEntryCat(${id})`)}
        <div class="name-cell">
          <input class="ci" data-f="name" value="${esc(e.name)}" placeholder="Название"
            onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
          ${res ? `<span class="badge reserve" title="Резерв на перерасход">${e.actual ? 'осталось ' + money(reserveLeft(e)) : 'резерв'}</span>` : ''}
        </div>
        <input class="ci r" ${padAttrs()} data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <button class="mini-btn del" tabindex="-1" onclick="deleteEntry(${id})">×</button>
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
      <div class="swipe-actions">
        <button class="sa-back" onclick="entryToBacklog(${id})">В бэклог</button>
        <button class="sa-del" onclick="deleteEntry(${id})">Удалить</button>
      </div>
      <div class="row r-plan" data-eid="${e.id}" data-swipe="160">
        ${catDot(e.category, `cycleEntryCat(${id})`)}
        <div class="name-cell">
          <input class="ci" data-f="name" value="${esc(e.name)}" placeholder="Название"
            onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
          <span class="badge ${offPlan(e) ? '' : 'hidden'}">вне плана</span>
        </div>
        <input class="ci r" ${padAttrs()} data-f="planned" inputmode="decimal" value="${e.planned || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} data-f="actual" inputmode="tel" value="${e.actual || ''}" placeholder="0"
          onblur="saveEntry(${id})" onkeydown="enterBlur(event)">
        <div class="rem ${r.cls}" onclick="openCover(${id})">${r.text}</div>
        <button class="mini-btn back" tabindex="-1" title="В бэклог" onclick="entryToBacklog(${id})">↓</button>
        <button class="mini-btn del" tabindex="-1" title="Удалить" onclick="deleteEntry(${id})">×</button>
      </div>
    </div>`;
  }).join('');
  renderPlannedTotals();
  bindSwipes();
}

function patchPlannedRow(eid) {
  const e = state.entries.find(x => x.id === eid);
  const row = document.querySelector(`.row[data-eid="${eid}"]`);
  if (!e || !row) return;
  const r = remInfo(e);
  const rem = row.querySelector('.rem');
  rem.className = `rem ${r.cls}`;
  rem.textContent = r.text;
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

async function cycleEntryCat(eid) {
  const e = state.entries.find(x => x.id === eid);
  if (!e) return;
  const category = nextCat(e.category);
  await api.updateEntry(eid, { category });
  e.category = category;
  renderAll();
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
  $('cover-overlay').classList.remove('hidden');
}

function closeCover() { $('cover-overlay').classList.add('hidden'); coverId = null; }

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
  $('sheet-overlay').classList.remove('hidden');
  setTimeout(() => $('q-sum').focus(), 50);
}

function closeQuick() { $('sheet-overlay').classList.add('hidden'); }

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

function onEscape() { closeQuick(); closeCover(); if (pad) closePad(); }

// ── бэклог ───────────────────────────────────────────────────────────────────

function renderBacklog() {
  renderBacklogTotal();
  $('backlog-body').innerHTML = catSort(state.backlog).map(b => {
    const id = idArg(b.id);
    const dis = !state.monthId ? 'disabled' : '';
    return `
    <div class="row-wrap">
      <div class="swipe-actions">
        <button class="sa-plan" onclick="moveBacklogEntry(${id})" ${dis}>В спринт</button>
        <button class="sa-del" onclick="deleteBacklogEntry(${id})">Удалить</button>
      </div>
      <div class="row r-back" data-bid="${b.id}" data-swipe="160">
        ${catDot(b.category, `cycleBacklogCat(${id})`)}
        <input class="ci" data-f="name" value="${esc(b.name)}" placeholder="Название"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
        <input class="ci r" ${padAttrs()} data-f="planned" inputmode="decimal" value="${b.planned || ''}" placeholder="0"
          onblur="saveBacklogEntry(${id})" onkeydown="enterBlur(event)">
        <button class="mini-btn plus" tabindex="-1" title="Запланировать в этот спринт"
          onclick="moveBacklogEntry(${id})" ${dis}>+</button>
        <button class="mini-btn del" tabindex="-1" title="Удалить" onclick="deleteBacklogEntry(${id})">×</button>
      </div>
    </div>`;
  }).join('');
  bindSwipes();
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

async function cycleBacklogCat(bid) {
  const item = state.backlog.find(b => b.id === bid);
  if (!item) return;
  const category = nextCat(item.category);
  await api.updateBacklog(bid, { category });
  item.category = category;
  renderBacklog();
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

// ── свайп влево открывает действия строки; кнопки в строке остаются ──────────

function bindSwipes() {
  document.querySelectorAll('.row[data-swipe]').forEach(row => {
    if (row._swipe) return;
    row._swipe = true;
    const max = +row.dataset.swipe;
    let x0 = null, y0 = 0, dx = 0, open = false, axis = null;
    row.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.target.closest('button, input')) return;
      open = !!row.style.transform;   // соседний свайп мог закрыть эту строку
      x0 = e.clientX; y0 = e.clientY; dx = open ? -max : 0; axis = null;
    });
    row.addEventListener('pointermove', e => {
      if (x0 === null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (axis === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis === 'x') {
          row.setPointerCapture(e.pointerId);
          if (document.activeElement && row.contains(document.activeElement)) document.activeElement.blur();
        }
      }
      if (axis !== 'x') return;
      row.classList.add('dragging');
      row.parentElement.classList.add('swiping');
      dx = Math.min(0, Math.max(-max - 30, mx + (open ? -max : 0)));
      row.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (x0 === null) return;
      x0 = null;
      row.classList.remove('dragging');
      if (axis !== 'x') return;
      row.style.transform = dx < -max / 2 ? `translateX(${-max}px)` : '';
      if (row.style.transform) closeOtherSwipes(row);
      else hideActionsAfterSlide(row);
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  });
}

function closeOtherSwipes(keep) {
  document.querySelectorAll('.row[data-swipe]').forEach(r => {
    if (r !== keep && r.style.transform) { r.style.transform = ''; hideActionsAfterSlide(r); }
  });
}

// кнопки под строкой прячем, когда она доехала обратно, иначе край просвечивает
function hideActionsAfterSlide(row) {
  setTimeout(() => { if (!row.style.transform) row.parentElement.classList.remove('swiping'); }, 220);
}

// ── цифровая панель для сумм на телефоне ────────────────────────────────────
// Вместо системной клавиатуры: + и − рядом с цифрами, подсказки по плану,
// переключение План/Факт без закрытия. На компьютере поля печатаются как обычно.

const touchUI = () => window.matchMedia('(pointer: coarse)').matches;
function padAttrs() { return touchUI() ? 'readonly onclick="openPad(this)"' : 'inputmode="decimal"'; }

let pad = null;   // { kind: 'entry'|'backlog', id, field, expr }

const padItem = () => pad.kind === 'entry'
  ? state.entries.find(e => e.id === pad.id)
  : state.backlog.find(b => b.id === pad.id);
const padOld = () => { const it = padItem(); return it ? it[pad.field] : 0; };

function openPad(inp) {
  const row = inp.closest('.row');
  if (!row) return;
  inp.blur();
  const kind = row.dataset.eid ? 'entry' : 'backlog';
  const raw = row.dataset.eid || row.dataset.bid;
  const id = /^\d+$/.test(raw) ? Number(raw) : raw;
  pad = { kind, id, field: inp.dataset.f, expr: '' };
  renderPad();
  $('pad-overlay').classList.remove('hidden');
}

function closePad() { $('pad-overlay').classList.add('hidden'); pad = null; }

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
  else if (e.key === 'Enter') padDone();
});
