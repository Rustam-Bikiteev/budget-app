import * as finance from '../shared/domain.mjs';
import * as core from '../shared/core.js';
import { closeCalendar, showBacklog, state, configureCore, $, flash, loadAll, loadCurrentMonth, renderAll, deleteEntry, closeConfirm, renderBacklog, entryToBacklog } from '../shared/core.js';
import * as cloudView from '../app.js?v=2';
import { openCover, closeCover, openQuick, closeQuick, renderWho, openPad, closePad } from '../app.js?v=2';
import { installLilacView } from '../ui/lilac.js?v=2';
import { registerInlineHandlers } from '../shared/inline-bridge.mjs';
/* In-memory implementation of the existing storage contract. No production API. */
const initialCategories = [
  {id:'me',name:'Рустам',color:'#95b3cb'},
  {id:'shared',name:'Общие',default:true,color:'#98c4aa'},
  {id:'nastya',name:'Настя',color:'#c49bd0'},
];
const demoPeriod = finance.initialPeriod(new Date(), 'cloud');
const demoCopy = value => structuredClone(value);
let demoID=100;
const demoMonths=[{id:1,...demoPeriod,income:165000,saved:34500,transferred:null}];
const demoEntries=[
  {id:11,month_id:1,type:'mandatory',category:'shared',name:'Ипотека',planned:28500,actual:28500},
  {id:12,month_id:1,type:'mandatory',category:'shared',name:'Коммунальные услуги',planned:4500,actual:0},
  {id:13,month_id:1,type:'mandatory',category:'me',name:'Подписки',planned:1800,actual:1800},
  {id:14,month_id:1,type:'mandatory',category:'shared',name:'Непредвиденные',planned:8000,actual:0,is_reserve:true},
  {id:21,month_id:1,type:'planned',category:'shared',name:'Продукты',planned:18000,actual:12450},
  {id:22,month_id:1,type:'planned',category:'me',name:'Кафе и рестораны',planned:6000,actual:2400},
  {id:23,month_id:1,type:'planned',category:'nastya',name:'Личные покупки',planned:12000,actual:4200},
  {id:24,month_id:1,type:'planned',category:'me',name:'Транспорт',planned:3500,actual:4100},
  {id:25,month_id:1,type:'planned',category:'shared',name:'Выходные вместе',planned:7000,actual:0},
];
const demoBacklog=[
  {id:31,category:'shared',name:'Кофемашина',planned:32000},
  {id:32,category:'me',name:'Беговые кроссовки',planned:14500},
  {id:33,category:'nastya',name:'Поездка на выходные',planned:20000},
];
function demoFind(list,id){const row=list.find(row=>row.id===id);if(!row)throw new Error('Тестовая запись не найдена');return row;}
function demoInsert(list,row){const added={id:++demoID,...demoCopy(row)};list.push(added);return demoCopy(added);}
function demoUpdate(list,id,patch){const row=demoFind(list,id);Object.assign(row,demoCopy(patch));return demoCopy(row);}
function demoDelete(list,id){const index=list.findIndex(row=>row.id===id);if(index!==-1)list.splice(index,1);}
const api={
  listMonths:async()=>demoCopy(demoMonths),
  getMonth:async id=>({month:demoCopy(demoFind(demoMonths,id)),entries:demoCopy(demoEntries.filter(row=>row.month_id===id))}),
  createMonth:async(year,month,half,copyFromId)=>{
    if(demoMonths.some(row=>row.year===year&&row.month===month&&row.half===half))return {error:'exists'};
    const created=demoInsert(demoMonths,{year,month,half,income:0,saved:0,transferred:null});
    if(copyFromId)demoEntries.filter(row=>row.month_id===copyFromId).forEach(row=>{
      demoInsert(demoEntries,{month_id:created.id,type:row.type,category:row.category,name:row.name,planned:row.planned,actual:0,is_reserve:row.is_reserve});
    });
    return created;
  },
  updateMonth:async(id,patch)=>demoUpdate(demoMonths,id,patch),
  createEntry:async row=>demoInsert(demoEntries,{actual:0,...row}),
  updateEntry:async(id,patch)=>demoUpdate(demoEntries,id,patch),
  deleteEntry:async id=>demoDelete(demoEntries,id),
  entryToBacklog:async id=>{
    const row=demoFind(demoEntries,id);
    const added=demoInsert(demoBacklog,{category:row.category,name:row.name,planned:row.planned});
    demoDelete(demoEntries,id);return added;
  },
  listBacklog:async()=>demoCopy(demoBacklog),
  createBacklog:async row=>demoInsert(demoBacklog,row),
  updateBacklog:async(id,patch)=>demoUpdate(demoBacklog,id,patch),
  deleteBacklog:async id=>demoDelete(demoBacklog,id),
  backlogToEntry:async(id,monthId)=>{
    const row=demoFind(demoBacklog,id);
    const added=demoInsert(demoEntries,{category:row.category,name:row.name,planned:row.planned,actual:0,type:'planned',month_id:monthId});
    demoDelete(demoBacklog,id);return added;
  },
};
function init(){return loadAll();}
async function refreshData(){await init();flash('Тестовый бюджет обновлён');}
function doLogout(){$('app').classList.add('hidden');$('login-overlay').classList.remove('hidden');$('login-email').focus();}
async function doLogin(event){event.preventDefault();$('login-overlay').classList.add('hidden');$('app').classList.remove('hidden');await init();}

// Only chart colors are remapped. Values and calculations use app.js unchanged.
cloudView.setChartPalette((ring,parts)=>{
  if(document.documentElement.dataset.theme==='lilac')return parts;
  const colors=ring==='h-ring'?['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)']:['var(--chart-3)','var(--chart-2)'];
  return parts.map((part,index)=>({...part,color:colors[index]}));
});
function demoTheme(theme){
  if(!['coral','lime','lilac','pastel'].includes(theme))return;
  document.documentElement.dataset.theme=theme;
  lilacHandlers.lilacTheme(theme);
  if(state.monthId){renderAll();renderBacklog();}
  if(!$('sheet-overlay').classList.contains('hidden'))renderWho();
}
function demoCloseScreens(){
  closeConfirm();closeQuick();closeCover();closePad();
  closeCalendar();
  $('login-overlay').classList.add('hidden');$('app').classList.remove('hidden');
}
async function demoScreen(screen){
  demoCloseScreens();
  if(!state.monthId&&!['empty','login'].includes(screen)){Object.assign(state,demoPeriod);await loadCurrentMonth();}
  if(document.documentElement.dataset.theme==='lilac'){
    lilacHandlers.lilacRoute(['payments','planned','analytics','backlog'].includes(screen)?screen:'home');
    if(['payments','planned','analytics'].includes(screen))return;
    if(screen==='parameters'){$('lilac-budget-editor').open=true;return;}
  }
  if(screen==='login'){doLogout();return;}
  if(document.documentElement.dataset.theme!=='lilac'&&['payments','planned','analytics','parameters'].includes(screen)){
    const targets={payments:'[data-lilac-panel=payments]',planned:'[data-lilac-panel=planned]',analytics:'#spending-disclosure',parameters:'#budget-disclosure'};
    const target=document.querySelector(targets[screen]);if(target.tagName==='DETAILS')target.open=true;
    target.scrollIntoView({behavior:'smooth',block:'start'});return;
  }
  if(screen==='empty'){
    Object.assign(state,demoPeriod);
    do {
      if(state.half===1)state.half=2;
      else{state.half=1;state.month++;if(state.month>12){state.month=1;state.year++;}}
    } while(state.allMonths.some(row=>row.year===state.year&&row.month===state.month&&row.half===state.half));
    await loadCurrentMonth();window.scrollTo(0,0);return;
  }
  if(!state.monthId){Object.assign(state,demoPeriod);await loadCurrentMonth();}
  if(screen==='quick'){openQuick();return;}
  if(screen==='pad'){
    const input=document.querySelector('#planned-body [data-f=actual]')||document.querySelector('#mandatory-body [data-f=planned]');
    if(input)openPad(input);return;
  }
  if(screen==='cover'){
    const row=state.entries.find(row=>row.type==='planned'&&row.actual>row.planned);
    if(row)openCover(row.id);else flash('Перерасхода нет. Увеличьте факт любой траты.');return;
  }
  if(screen==='confirm'){
    const row=state.entries.find(row=>row.type==='planned');
    if(row)deleteEntry(row.id);return;
  }
  if(screen==='calendar'){$('month-label').click();return;}
  if(screen==='backlog'){
    showBacklog();
    document.querySelector('.backlog-header').scrollIntoView({behavior:'smooth',block:'start'});return;
  }
  window.scrollTo({top:0,behavior:'smooth'});
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  if(event.data?.type==='theme')demoTheme(event.data.theme);
  if(event.data?.type==='screen')demoScreen(event.data.screen).catch(error=>flash(error.message,true));
});
configureCore({ storage: api, categories: initialCategories, reload: init, escape: cloudView.onEscape, refresh: refreshData, logout: doLogout, mode: 'cloud' });
cloudView.installCloudView();
const lilacHandlers = installLilacView();
registerInlineHandlers({ ...core.inlineHandlers, ...cloudView.cloudInlineHandlers, ...lilacHandlers, state: core.state, api, refreshData, doLogout, doLogin });
$('app').classList.remove('hidden');
init().then(async()=>{
  const screen=new URLSearchParams(location.search).get('screen');
  if(screen)await demoScreen(screen);
  window.parent.postMessage({type:'ready'},location.origin);
}).catch(error=>flash(error.message,true));
