// The preview reuses the current application's markup and rendering functions.
// Its production bootstrap (Supabase, auth and realtime) is never executed.
(async () => {
  const allowed = ['coral','lime','lilac','pastel'];
  const requested = new URLSearchParams(location.search).get('theme');
  document.documentElement.dataset.theme = allowed.includes(requested) ? requested : 'coral';
  try {
    const sourceURL = new URL('../index.html', location.href);
    const response = await fetch(sourceURL, {cache:'no-store'});
    if (!response.ok) throw new Error(`Не удалось загрузить приложение: ${response.status}`);
    const template = new DOMParser().parseFromString(await response.text(), 'text/html');
    template.querySelectorAll('script').forEach(script => script.remove());
    for (const element of template.head.querySelectorAll('link[rel=stylesheet], style')) {
      const copy = element.cloneNode(true);
      if (copy.hasAttribute('href')) copy.href = new URL(copy.getAttribute('href'), sourceURL).href;
      if (copy.href && /\/ui\/(?:base|lilac)\.css/.test(copy.href)) continue;
      document.head.append(copy);
    }
    const loadStyle = path => new Promise((resolve,reject) => {
      const css=document.createElement('link');css.rel='stylesheet';css.href=path;
      css.onload=resolve;css.onerror=()=>reject(new Error(`Не загрузился ${path}`));document.head.append(css);
    });
    const styled=Promise.all([loadStyle('themes.css'),loadStyle('../ui/lilac.css')]);
    document.body.replaceChildren(...Array.from(template.body.childNodes));
    const welcome = document.createElement('div');
    welcome.className='design-welcome';
    welcome.innerHTML='<div><span class="eyebrow">ЛИЧНЫЕ ФИНАНСЫ</span><h2>Всё по плану<span class="welcome-dot">.</span></h2><p>Ваш бюджет, в вашем ритме</p></div><span class="welcome-mark" aria-hidden="true">б.</span>';
    document.querySelector('main').prepend(welcome);
    document.querySelectorAll('.budget-disclosure').forEach(details => details.open=true);
    document.querySelector('.nav-btn').setAttribute('aria-label','Предыдущий спринт');
    document.querySelectorAll('.nav-btn')[1].setAttribute('aria-label','Следующий спринт');
    document.querySelector('header h1').innerHTML='<span class="app-brand-mark">б.</span>Бюджет';
    const loadScript = path => new Promise((resolve,reject) => {
      const script=document.createElement('script'); script.src=path; script.onload=resolve; script.onerror=()=>reject(new Error(`Не загрузился ${path}`)); document.body.append(script);
    });
    await styled;
    await loadScript('../shared/core.js');
    await loadScript('../app.js');
    await loadScript('../ui/lilac.js');
    await loadScript('demo.js');
  } catch(error) {
    document.body.replaceChildren();
    const message=document.createElement('p'); message.textContent=error.message; message.style.cssText='padding:32px;font-family:Arial'; document.body.append(message);
  }
})();
