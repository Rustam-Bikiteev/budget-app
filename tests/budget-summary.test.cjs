const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function setup(income = 1000) {
  const fields = {};
  const field = id => fields[id] ||= {
    textContent: '', innerHTML: '', style: {}, classList: { toggle() {} },
    setAttribute(name, value) { this[name] = value; },
  };
  const context = vm.createContext({ document: { addEventListener() {}, getElementById: field } });
  for (const path of ['shared/core.js', 'app.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', path), 'utf8'), context);
  }
  const run = code => vm.runInContext(code, context);
  run(`
    state.income = ${income}; state.saved = 200;
    state.entries = [
      {type:'mandatory',name:'Ипотека',planned:300,actual:300},
      {type:'mandatory',name:'Непредвиденные',planned:100,actual:20},
      {type:'planned',name:'Продукты',planned:150,actual:50},
      {type:'planned',name:'Транспорт',planned:50,actual:70},
    ];
    const charts = {};
    const nativeChart = renderBudgetChart;
    renderBudgetChart = (ring, legend, parts, label) => {
      charts[ring] = parts;
      nativeChart(ring, legend, parts, label);
    };
    renderSummary();
  `);
  return { fields, run, parts: id => JSON.parse(run(`JSON.stringify(charts['${id}'])`)) };
}

test('budget sectors reconcile to income without including income as a sector', () => {
  const app = setup();
  const parts = app.parts('h-ring');
  assert.deepEqual(parts.map(p => [p.label, p.value]), [
    ['Обязательные', 380], ['Отложено', 200], ['Запланировано', 220], ['Свободно', 200],
  ]);
  assert.equal(parts.reduce((sum, p) => sum + p.value, 0), 1000);
  assert.match(app.fields['h-income'].textContent, /1\s*000/);
});

test('spending sectors count overspending once and retain unspent allocations', () => {
  const app = setup();
  assert.deepEqual(app.parts('h-spending-ring').map(p => [p.label, p.value]), [
    ['Потрачено', 120], ['Осталось', 100],
  ]);
  assert.match(app.fields['h-left'].textContent, /100/);
});

test('only the budget infographic shows percentages of its whole circle', () => {
  const app = setup();
  const shares = () => [...app.fields['h-legend'].innerHTML.matchAll(/class="chart-share">([^<]+)/g)].map(match => match[1]);
  assert.deepEqual(shares(), ['38%', '20%', '22%', '20%']);
  assert.match(app.fields['h-ring']['aria-label'], /Обязательные:.*38%/);
  assert.doesNotMatch(app.fields['h-spending-legend'].innerHTML, /%/);
  assert.doesNotMatch(app.fields['h-spending-ring']['aria-label'], /%/);

  app.run('state.income = 700; renderSummary()');
  assert.deepEqual(shares(), ['47,5%', '25%', '27,5%', '-12,5%']);
  app.run('state.income = state.saved = 0; state.entries = []; renderSummary()');
  assert.deepEqual(shares(), ['0%', '0%', '0%', '0%']);
});

test('deficit remains explicit and empty charts have no invalid gradient', () => {
  const app = setup(700);
  assert.deepEqual(app.parts('h-ring').at(-1).value, -100);
  assert.equal(app.parts('h-ring').reduce((sum, p) => sum + p.value, 0), 700);
  assert.match(app.fields['h-ring']['aria-label'], /Дефицит/);
  app.run('state.entries = []; state.income = state.saved = 0; renderSummary()');
  for (const id of ['h-ring', 'h-spending-ring']) {
    assert.equal(app.fields[id].style.background, 'var(--border)');
  }
});

test('row bars show plan, fact and remaining in order, preserving overspent rows', () => {
  const app = setup();
  const widths = code => [...app.run(code).matchAll(/width:([\d.]+)%/g)].map(match => Number(match[1]));
  assert.deepEqual(widths('entryProgress({planned:6000,actual:2400})'), [50, 20, 0, 30]);
  assert.deepEqual(widths('entryProgress({planned:100,actual:25})'), [50, 12.5, 0, 37.5]);
  const over = widths('entryProgress({planned:100,actual:150})');
  assert.equal(over[0], 0);
  assert.ok(Math.abs(over[1] - 200 / 3) < 1e-9);
  assert.ok(Math.abs(over[2] - 100 / 3) < 1e-9);
  assert.equal(over[3], 0);
  assert.deepEqual(widths('entryProgress({planned:100,actual:100})'), [0, 100, 0, 0]);
  assert.deepEqual(widths('entryProgress({planned:100,actual:0})'), [50, 0, 0, 50]);
  assert.deepEqual(widths('entryProgress({planned:0,actual:50})'), [0, 0, 100, 0]);
  assert.deepEqual(widths('entryProgress({planned:0,actual:0})'), [0, 0, 0, 0]);
});
