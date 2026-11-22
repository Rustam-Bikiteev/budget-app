const frame = document.getElementById('preview');
const notes = {
  coral: ['Коралл', 'Графит, ледяные поверхности и коралловый акцент'],
  lime: ['Лайм', 'Светлый лайм, контрастная карта и геометрия'],
  lilac: ['Лаванда', 'Мягкие формы, лаванда и фисташковые карточки'],
  pastel: ['Пастель', 'Сливочный фон, цветные блоки и свободная типографика'],
};
const params = new URLSearchParams(location.search);
let theme = Object.hasOwn(notes, params.get('theme')) ? params.get('theme') : 'coral';
let view = params.get('view') === 'mobile' ? 'mobile' : 'desktop';
function send(message) { frame.contentWindow.postMessage(message, location.origin); }
function update() {
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  document.querySelectorAll('.viewport-controls [data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  document.querySelector('.lab-stage').dataset.view = view;
  document.getElementById('theme-title').textContent = notes[theme][0];
  document.getElementById('theme-note').textContent = notes[theme][1];
  document.getElementById('standalone').href = `preview.html?theme=${theme}`;
  history.replaceState(null, '', `?theme=${theme}&view=${view}`);
  send({type:'theme', theme});
}
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => { theme = button.dataset.theme; update(); }));
document.querySelectorAll('.viewport-controls [data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; update(); }));
document.getElementById('screen').addEventListener('change', event => send({type:'screen', screen:event.target.value}));
document.getElementById('reset').addEventListener('click', () => { document.getElementById('screen').value='budget'; frame.src=`preview.html?theme=${theme}`; });
window.addEventListener('message', event => { if(event.origin===location.origin && event.source===frame.contentWindow && event.data?.type==='ready') { update(); send({type:'screen',screen:document.getElementById('screen').value}); } });
frame.src=`preview.html?theme=${theme}`;
update();
