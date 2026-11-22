/* Reference-led presentation. Storage, mutations and calculations remain native. */
const lilacIcons={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  check:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="m8 12 3 3 5-6"/>',
  grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  chart:'<path d="M3 21h18M5 21V11h4v10m2 0V6h4v15m2 0V2h4v19"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  back:'<path d="m14 5-7 7 7 7"/>',
  arrow:'<path d="M6 18 18 6M6 6h12v12"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h2m4 0h2m-8 3h2m4 0h2"/>',
  wallet:'<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V6m19 7h-6v4h6"/>',
  swap:'<path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4"/>',
};
const lilacSVG=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lilacIcons[name]||lilacIcons.grid}</svg>`;
let lilacPage='home';
let lilacChartMode='entries';
const lilacLogin=document.querySelector('.login-box');
if(lilacLogin&&!lilacLogin.querySelector('.login-brand')){
  lilacLogin.querySelector('h2').insertAdjacentHTML('beforebegin','<span class="login-brand" aria-hidden="true">б.</span>');
  lilacLogin.querySelector('h2').insertAdjacentHTML('afterend','<p class="login-caption">Место, где деньги обретают план</p>');
}
const lilacTop=document.createElement('div');
lilacTop.className='lilac-only lilac-topbar';
lilacTop.innerHTML=`<button class="lilac-profile" onclick="lilacBack()" aria-label="Главная"><span>Р</span>${lilacSVG('back')}</button><span class="lilac-page-title"></span><div class="lilac-top-actions"><button class="lilac-add" aria-label="Добавить расход" onclick="openQuick()">${lilacSVG('plus')}</button><button class="lilac-calendar" aria-label="Выбрать спринт" onclick="toggleCalendar(event)">${lilacSVG('calendar')}</button></div>`;
$('app').prepend(lilacTop);
const lilacMain=document.querySelector('main');
const lilacOverview=document.createElement('section');lilacOverview.className='lilac-only lilac-overview';
lilacOverview.innerHTML=`
  <div class="lilac-shortcuts"><button onclick="lilacRoute('payments')">Платежи</button><button onclick="lilacRoute('planned')">Траты</button><button onclick="lilacRoute('backlog')">Бэклог</button></div>
  <div class="lilac-balance lilac-notch">
    <span class="lilac-small">Свободно в спринте</span>
    <button class="lilac-round-link" aria-label="Распределение бюджета" onclick="lilacRoute('analytics')">${lilacSVG('arrow')}</button>
    <strong id="lilac-free"></strong>
    <div class="lilac-balance-foot"><span id="lilac-income"></span><span id="lilac-free-share"></span></div>
  </div>
  <details class="lilac-goal" id="lilac-budget-editor">
    <summary><span>Отложить в спринте</span><span class="lilac-goal-badge" id="lilac-saved-share"></span><span class="lilac-saving-track"><i id="lilac-saving-fill"></i><b id="lilac-saved"></b><span id="lilac-income-goal"></span></span></summary>
  </details>
  <button class="lilac-asset lilac-mandatory lilac-notch" onclick="lilacRoute('payments')">
    <span class="lilac-asset-head"><i>${lilacSVG('wallet')}</i><span>Платежи <small id="lilac-mand-count"></small></span><span class="lilac-asset-arrow">${lilacSVG('arrow')}</span></span>
    <span class="lilac-asset-foot"><span><small>По плану</small><b id="lilac-mand"></b></span><span><small>Оплачено</small><b id="lilac-paid"></b></span><span class="lilac-chip" id="lilac-paid-share"></span></span>
  </button>
  <button class="lilac-asset lilac-expenses lilac-notch" onclick="lilacRoute('planned')">
    <span class="lilac-asset-head"><i>${lilacSVG('swap')}</i><span>Траты <small id="lilac-plan-count"></small></span><span class="lilac-asset-arrow">${lilacSVG('arrow')}</span></span>
    <span class="lilac-asset-foot"><span><small>По плану</small><b id="lilac-allocated"></b></span><span><small>Потрачено</small><b id="lilac-spent"></b></span><span class="lilac-chip" id="lilac-spent-share"></span></span>
  </button>`;
lilacMain.prepend(lilacOverview);
// Move the actual editable inputs, including their original save handlers.
$('lilac-budget-editor').append(document.querySelector('.budget-fields'));
const lilacAnalytics=document.createElement('section');lilacAnalytics.className='lilac-only lilac-analytics';
lilacAnalytics.innerHTML=`<h2>Ваш бюджет в деталях</h2><div class="lilac-stat-pills" id="lilac-stat-pills"></div><div class="lilac-chart-tabs"><button class="lilac-chart-calendar" aria-label="Выбрать спринт" onclick="toggleCalendar(event)">${lilacSVG('calendar')}</button><button data-chart="entries" onclick="lilacSetChart('entries')" aria-pressed="true">По тратам</button><button data-chart="categories" onclick="lilacSetChart('categories')" aria-pressed="false">По категориям</button></div><div class="lilac-bars" id="lilac-bars" role="group" aria-label="План и факт трат"></div><div class="lilac-chart-legend"><span><i></i>В плане</span><span><i></i>Перерасход</span><span><i></i>Осталось</span></div><div class="lilac-chart-total"><span>Осталось потратить</span><b id="lilac-left"></b></div>`;
lilacMain.append(lilacAnalytics);
const lilacAccount=document.createElement('section');lilacAccount.className='lilac-only lilac-account';
lilacAccount.innerHTML='<div class="lilac-account-action" data-account-action="refresh"><span>Обновить данные</span></div><div class="lilac-account-action" data-account-action="logout"><span>Выйти из аккаунта</span></div>';
lilacMain.append(lilacAccount);
const lilacOriginalHeaderActions=document.querySelector('.header-actions');
const lilacHeaderButtons=[...lilacOriginalHeaderActions.children];
for(const row of lilacAccount.querySelectorAll('.lilac-account-action'))row.addEventListener('click',event=>{if(!event.target.closest('button'))row.querySelector('button')?.click();});
const lilacNav=document.createElement('nav');lilacNav.className='lilac-only lilac-bottom-nav';lilacNav.setAttribute('aria-label','Разделы бюджета');
lilacNav.innerHTML=[['home','home','Главная'],['payments','check','Платежи'],['backlog','grid','Бэклог'],['analytics','chart','Аналитика']].map(([route,icon,title])=>`<button data-page="${route}" title="${title}" aria-label="${title}" onclick="lilacRoute('${route}')">${lilacSVG(icon)}</button>`).join('');
$('app').append(lilacNav);
document.querySelector('#budget-view>.section:nth-child(2)').dataset.lilacPanel='payments';
document.querySelector('#budget-view>.section:nth-child(4)').dataset.lilacPanel='planned';
document.querySelector('.backlog-header').closest('.section').dataset.lilacPanel='backlog';

function lilacRoute(page){
  if(!['home','payments','planned','analytics','backlog','account'].includes(page))page='home';
  lilacPage=page;document.documentElement.dataset.lilacPage=page;
  const titles={home:'',payments:'Платежи',planned:'Траты спринта',analytics:'',backlog:'Бэклог',account:'Аккаунт'};
  document.querySelector('.lilac-page-title').textContent=titles[page];
  document.querySelector('.lilac-profile').setAttribute('aria-label',page==='home'?'Аккаунт':'Главная');
  lilacNav.querySelectorAll('button').forEach(button=>{
    const active=button.dataset.page===page;
    button.setAttribute('aria-current',active?'page':'false');
  });
  if(page==='backlog'&&!backlogOpen)toggleBacklog();
  window.scrollTo(0,0);
}
function lilacBack(){lilacRoute(lilacPage==='home'?'account':'home');}
function lilacTheme(theme){
  // Restore the same inputs to the other variants' existing layout.
  const fields=document.querySelector('.budget-fields');
  if(theme==='lilac'){
    $('lilac-budget-editor').append(fields);lilacRoute(lilacPage);
    for(const button of lilacHeaderButtons)lilacAccount.querySelector(`[data-account-action="${button.classList.contains('refresh-btn')?'refresh':'logout'}"]`).append(button);
    lilacOperatorMenu.querySelector('.lilac-operator-chips').append($('pad-chips'));
    lilacOperatorMenu.querySelector('.lilac-operator-info').append($('pad-preview'));
    for(const button of lilacOriginalKeys.filter(button=>['+','-','000'].includes(button.dataset.key)))lilacOperatorMenu.querySelector('.lilac-operator-actions').append(button);
    $('pad-ok').textContent='Сохранить сумму';
  }else{
    document.querySelector('#budget-view>.hero:first-child').append(fields);
    for(const button of lilacHeaderButtons)lilacOriginalHeaderActions.append(button);
    document.querySelector('.pad-keys').before($('pad-chips'));
    $('pad-display').after($('pad-preview'));
    for(const button of lilacOriginalKeys)document.querySelector('.pad-keys').append(button);
    $('pad-ok').textContent='✓';
  }
}
function lilacPercent(value,total){return total>0?Math.round(value/total*100):0;}
function lilacRender(){
  const k=calc();
  const set=(id,value)=>$(id).textContent=value;
  set('lilac-free',money(k.free));set('lilac-income',`Доход ${money(state.income)}`);
  set('lilac-free-share',`${lilacPercent(k.free,state.income)}% дохода`);
  set('lilac-saved-share',`${lilacPercent(state.saved,state.income)}% дохода`);
  set('lilac-saved',money(state.saved));set('lilac-income-goal',money(state.income));
  $('lilac-saving-fill').style.width=`${Math.min(100,Math.max(0,lilacPercent(state.saved,state.income)))}%`;
  set('lilac-mand',money(k.mand));set('lilac-paid',money(k.mandPaid));set('lilac-allocated',money(k.allocated));set('lilac-spent',money(k.spent));
  set('lilac-paid-share',`${lilacPercent(k.mandPaid,k.mand)}%`);set('lilac-spent-share',`${lilacPercent(k.spent,k.allocated)}%`);
  set('lilac-mand-count',`${state.entries.filter(e=>e.type==='mandatory').length}`);
  set('lilac-plan-count',`${state.entries.filter(e=>e.type==='planned').length}`);
  set('lilac-left',money(k.allocated-k.spent));
  $('lilac-stat-pills').innerHTML=[['Доход',state.income],['Отложить',state.saved],['Платежи',k.mand],['Потрачено',k.spent]].map(([label,value])=>`<div><span>${label}</span><b>${money(value)}</b></div>`).join('');
  lilacRenderBars();
  document.documentElement.dataset.lilacEmpty=String(!state.monthId);
}
function lilacSetChart(mode){lilacChartMode=mode;lilacRenderBars();}
function lilacRenderBars(){
  const entries=state.entries.filter(e=>e.type==='planned');
  const points=entries.map(row=>({...row,total:used(row),within:Math.min(row.actual,row.planned),over:Math.max(0,row.actual-row.planned),left:Math.max(0,row.planned-row.actual)}));
  const bars=lilacChartMode==='categories'?cats.map(category=>{
    const rows=points.filter(row=>row.category===category.id);
    const bar={name:category.name};
    for(const field of ['planned','actual','total','within','over','left'])bar[field]=sumBy(rows,row=>row[field]);
    return bar;
  }):points;
  const maximum=Math.max(1,...bars.map(row=>row.total));
  $('lilac-bars').style.setProperty('--bar-count',Math.max(bars.length,1));
  $('lilac-bars').innerHTML=bars.length?bars.map(row=>{
    return `<button class="lilac-bar" title="${esc(row.name)}: план ${money(row.planned)}, факт ${money(row.actual)}" aria-label="${esc(row.name)}: план ${money(row.planned)}, факт ${money(row.actual)}. Открыть траты" onclick="lilacRoute('planned')"><span class="lilac-bar-track"><i class="lilac-bar-left" style="height:${row.left/maximum*100}%"></i><i class="lilac-bar-over" style="height:${row.over/maximum*100}%"></i><i class="lilac-bar-actual" style="height:${row.within/maximum*100}%"></i></span><span class="lilac-bar-name">${esc(row.name)}</span><b>${money(row.total)}</b></button>`;
  }).join(''):'<p class="lilac-chart-empty">Добавьте траты, чтобы увидеть график</p>';
  document.querySelectorAll('[data-chart]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chart===lilacChartMode)));
}

// New composition around the native keypad; every key keeps its original handler.
const lilacPadTop=document.createElement('div');lilacPadTop.className='lilac-only lilac-pad-top';
lilacPadTop.innerHTML=`<button onclick="closePad()" aria-label="Закрыть ввод суммы">${lilacSVG('back')}</button><span>Изменить сумму</span><span></span>`;
document.querySelector('.pad').prepend(lilacPadTop);
const lilacPadCards=document.createElement('div');lilacPadCards.className='lilac-only lilac-pad-cards';
lilacPadCards.innerHTML=`<button class="lilac-pad-panel" data-pad-field="planned" onclick="padField('planned')"><span class="lilac-pad-card-head"><i>${lilacSVG('wallet')}</i><span>План</span><small>Вы планируете</small></span><b class="lilac-pad-number"></b></button><span class="lilac-pad-connector">${lilacSVG('swap')}</span><button class="lilac-pad-panel" data-pad-field="actual" onclick="padField('actual')"><span class="lilac-pad-card-head"><i>${lilacSVG('check')}</i><span>Факт</span><small>Вы потратили</small></span><b class="lilac-pad-number"></b></button>`;
document.querySelector('.pad-head').after(lilacPadCards);
const lilacOriginalKeys=[...document.querySelectorAll('.pad-keys>button')];
for(const button of lilacOriginalKeys)button.dataset.key=button.id==='pad-ok'?'done':button.getAttribute('onclick').match(/padKey\('([^']+)'\)/)?.[1];
const lilacOperatorMenu=document.createElement('details');lilacOperatorMenu.className='lilac-only lilac-operator-menu';
lilacOperatorMenu.innerHTML='<summary aria-label="Суммы и операции" title="Суммы и операции">···</summary><div class="lilac-operator-content"><div class="lilac-operator-info"></div><div class="lilac-operator-chips"></div><div class="lilac-operator-actions"></div></div>';
document.querySelector('.pad-preview').after(lilacOperatorMenu);
function lilacRenderPad(){
  if(!pad)return;
  const row=padItem();if(!row)return;
  const both=pad.kind==='entry'&&row.type==='planned';
  lilacPadCards.dataset.both=String(both);
  for(const panel of lilacPadCards.querySelectorAll('[data-pad-field]')){
    const field=panel.dataset.padField;const active=field===pad.field;
    panel.setAttribute('aria-pressed',String(active));
    panel.querySelector('.lilac-pad-number').textContent=active?$('pad-display').textContent:money(row[field]||0);
  }
}
const lilacNativeSummary=renderSummary;
renderSummary=function(){lilacNativeSummary();lilacRender();};
const lilacNativePad=renderPad;
renderPad=function(){lilacNativePad();lilacRenderPad();};
const lilacNativeLoad=loadCurrentMonth;
loadCurrentMonth=async function(){await lilacNativeLoad();lilacRender();};
const lilacNativeModalBackground=updateModalBackground;
updateModalBackground=function(){lilacNativeModalBackground();const active=!!activeModal();lilacTop.inert=active;lilacNav.inert=active;};
lilacRoute('home');
lilacTheme(document.documentElement.dataset.theme);
