import { state, $, setCategories, loadAll, renderAll, renderBacklog, renderTabs, flash, esc, activeModal, closeModal, resetContext, runSaveAction } from '../shared/core.js';
import { cloudErrorMessage } from '../storage/supabase.mjs';

// Owns Auth, selected household and generation-scoped Realtime lifetime.
export function installFamily({ client: sb, storage }) {
  let epoch = 0, user = null, selected = null, families = [], channel = null;
  const newCategoryColors = ['#7546c7', '#007d70', '#bf4878', '#2163ba', '#b45d19', '#497421'];
  const requests = new Map();
  const pendingKey = 'budget-invite';
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('invite')) {
    sessionStorage.setItem(pendingKey, fragment.get('invite'));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const panel = document.createElement('section');
  panel.id = 'family-onboarding'; panel.className = 'login-overlay hidden';
  panel.innerHTML = `<div class="login-box"><h2>Семейный бюджет</h2><div id="family-choices"></div>
    <form id="family-create"><p>Можно вести бюджет одному и пригласить близких позже.</p><label>Название бюджета<input id="family-name" required maxlength="120" placeholder="Мой бюджет"></label><button class="btn-primary">Создать семейный бюджет</button></form>
    <form id="family-join"><label>Приглашение<input id="family-token" required autocomplete="off" placeholder="Ссылка или код приглашения"></label><button class="btn-primary">Присоединиться по приглашению</button></form>
    <p id="family-error" role="alert"></p><button id="family-logout" type="button">Выйти</button></div>`;
  document.body.append(panel);
  const account = document.createElement('div'); account.id = 'family-account';
  document.querySelector('.lilac-account').prepend(account);
  function clear() {
    epoch++; selected = null;
    if (channel) { sb.removeChannel(channel); channel = null; }
    storage.setContext(null); resetContext(); setCategories([]);
    if (activeModal()) closeModal(activeModal());
    $('app').classList.add('hidden'); panel.classList.add('hidden'); account.replaceChildren();
    $('family-draft')?.remove();
    $('login-pass').value = '';
  }
  async function rpc(name, args) {
    const stamp = epoch;
    const { data, error } = await sb.rpc(name, args);
    if (stamp !== epoch) throw new Error('Контекст изменился');
    if (error) throw error;
    return data;
  }
  async function request(name, args) {
    const key = 'budget-action:' + JSON.stringify([user?.id, name, args]);
    let id = requests.get(key) || sessionStorage.getItem(key) || crypto.randomUUID();
    requests.set(key, id); sessionStorage.setItem(key, id);
    try {
      const result = await rpc(name, { ...args, request_id: id });
      requests.delete(key); sessionStorage.removeItem(key); return result;
    } catch (error) {
      if (error.code && !String(error.code).startsWith('PGRST')) { requests.delete(key); sessionStorage.removeItem(key); }
      throw error;
    }
  }
  function message(error) {
    return cloudErrorMessage(error);
  }
  function submit(form, action) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const stamp = epoch, button = form.querySelector('button');
      if (button.disabled) return;
      button.disabled = true; $('family-error').textContent = '';
      runSaveAction(async () => {
        try { await action(); }
        catch (error) { if (stamp === epoch) $('family-error').textContent = message(error); return false; }
        finally { button.disabled = false; }
      });
    });
  }
  function onboarding() {
    $('app').classList.add('hidden'); panel.classList.remove('hidden');
    $('family-token').value = sessionStorage.getItem(pendingKey) || '';
    $('family-choices').replaceChildren();
    for (const family of families) {
      const button = document.createElement('button'); button.textContent = family.name;
      button.onclick = () => {
        const task = select(family.id), stamp = epoch;
        task.catch(error => { if (stamp === epoch) $('family-error').textContent = message(error); });
      };
      $('family-choices').append(button);
    }
  }
  // Only edited controls survive an explicit refresh. Untouched controls show
  // the new server values, so retry cannot silently overwrite another member.
  function captureDraft() {
    const values = [];
    function add(selector, expected, title, checkbox = false) {
      const el = document.querySelector(selector); if (!el) return;
      const value = checkbox ? el.checked : el.value;
      if (String(value || '') !== String(expected || '')) values.push({ selector, value, title, checkbox });
    }
    for (const [kind, rows] of [['eid', state.entries], ['bid', state.backlog]]) for (const row of rows) {
      for (const field of ['name', 'planned', 'actual']) add(`.row[data-${kind}="${row.id}"] [data-f="${field}"]`, row[field], { name: 'Название', planned: 'План', actual: 'Факт' }[field]);
      add(`.row[data-${kind}="${row.id}"] .cloud-category`, row.category, 'Категория');
      if (kind === 'eid') add(`.row[data-eid="${row.id}"] input[type="checkbox"]`, row.is_reserve, 'Резерв', true);
    }
    add('#income-inp', state.income, 'Доход'); add('#saved-inp', state.saved, 'Отложено');
    add('#family-edit-name', selected.name, 'Название семьи');
    selected.settings.categories.forEach(cat => {
      const id = CSS.escape(cat.id);
      add(`[data-family-cat="${id}"]`, cat.name, 'Категория');
      add(`[data-family-color="${id}"]`, cat.color.toLowerCase(), 'Цвет категории');
    });
    return values;
  }
  function restoreDraft(values) {
    const missing = [];
    for (const item of values) {
      const el = document.querySelector(item.selector);
      if (el) { if (item.checkbox) el.checked = item.value; else el.value = item.value; }
      else missing.push(item);
    }
    if (!missing.length) return;
    let draft = $('family-draft');
    if (!draft) { draft = document.createElement('details'); draft.id = 'family-draft'; $('app').prepend(draft); }
    draft.open = true;
    draft.innerHTML = `<summary>Черновик удалённой записи. Скопируйте нужные значения.</summary>${missing.map(item => `<label>${esc(item.title)}<input readonly value="${esc(item.value)}"></label>`).join('')}`;
  }
  async function list(auto = true) {
    families = await rpc('budget_list_households', {});
    if (auto && families.length === 1 && !sessionStorage.getItem(pendingKey)) await select(families[0].id);
    else onboarding();
  }
  async function select(id) {
    const currentUser = user;
    clear(); user = currentUser;
    panel.classList.remove('hidden');
    const stamp = epoch;
    selected = await rpc('budget_household_details', { household_id: id });
    const role = families.find(f => f.id === id)?.role || selected.members.find(m => m.user_id === user.id)?.role;
    selected.role = role;
    storage.setContext({ householdId: id, userId: user.id });
    setCategories(selected.settings.categories);
    await loadAll(); if (stamp !== epoch) return;
    $('family-error').textContent = '';
    renderAccount(); panel.classList.add('hidden'); $('app').classList.remove('hidden');
    const receive = () => {
      if (stamp !== epoch || $('save-status').dataset.state === 'error' || document.activeElement?.matches('input,select,textarea')) return;
      loadAll().catch(error => { if (stamp === epoch) flash(message(error), true); });
    };
    channel = sb.channel('family-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'months', filter: `household_id=eq.${id}` }, receive)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: `household_id=eq.${id}` }, receive)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'backlog', filter: `household_id=eq.${id}` }, receive)
      .subscribe(status => { if (stamp === epoch && ['CHANNEL_ERROR','TIMED_OUT'].includes(status)) flash('Живая синхронизация отключилась. Обновите данные вручную.', true); });
  }
  function editCategories(form) {
    const rows = new Map();
    const list = form.querySelector('#family-categories');
    const add = form.querySelector('#family-add-category');
    const note = form.querySelector('#family-category-note');
    function updateControls() {
      for (const button of list.querySelectorAll('[data-remove-category]')) button.disabled = rows.size < 2;
      add.disabled = rows.size >= 100;
      const categories = [...rows.values()].map(row => row.category);
      const target = categories.find(cat => cat.default) || categories.at(-1);
      const removed = selected.settings.categories.some(cat => !rows.has(cat.id));
      note.textContent = removed ? `После сохранения записи удалённых категорий перейдут в «${rows.get(target.id).input.value.trim()}».` : '';
    }
    function append(category) {
      const row = document.createElement('div');
      row.className = 'family-category-row';
      row.innerHTML = `<input type="color" class="family-category-color" aria-label="Цвет категории">
        <input aria-label="Название категории" placeholder="Название категории" required maxlength="100">
        <button type="button" data-remove-category aria-label="Удалить категорию"><span aria-hidden="true">×</span></button>`;
      const color = row.firstElementChild;
      color.dataset.familyColor = category.id;
      color.value = category.color;
      const input = row.querySelector('input[required]');
      input.dataset.familyCat = category.id;
      input.value = category.name;
      input.oninput = () => { input.setCustomValidity(''); updateControls(); };
      row.querySelector('button').onclick = () => {
        rows.delete(category.id);
        row.remove();
        updateControls();
      };
      rows.set(category.id, { category, input, color, row });
      list.append(row);
      return input;
    }
    selected.settings.categories.forEach(append);
    add.onclick = () => {
      if (rows.size >= 100) return;
      const color = newCategoryColors.find(value => ![...rows.values()].some(row => row.color.value === value))
        || newCategoryColors[rows.size % newCategoryColors.length];
      append({ id: crypto.randomUUID(), name: '', color }).focus();
      updateControls();
    };
    updateControls();
    return { rows, append, updateControls };
  }
  let categoryEditor;
  function renderAccount() {
    categoryEditor = null;
    account.innerHTML = `<section class="family-card">
      <div class="family-card-heading"><h2>${esc(selected.name)}</h2><p>${selected.role === 'owner' ? 'Владелец' : 'Участник'}</p></div>
      <button id="family-switch" class="family-action" type="button">Выбрать семейный бюджет<span aria-hidden="true">›</span></button>
      </section><div id="family-owner"></div><p id="account-error" role="alert"></p>`;
    $('family-switch').onclick = () => {
      clear(); const stamp = epoch;
      list(false).catch(error => { if (stamp === epoch) { $('family-error').textContent = message(error); onboarding(); } });
    };
    if (selected.role !== 'owner') return;
    $('family-owner').innerHTML = `<form id="family-settings" class="family-card"><label>Название семьи<input id="family-edit-name" required maxlength="120" value="${esc(selected.name)}"></label>
      <fieldset><legend>Категории</legend><div id="family-categories"></div>
      <button id="family-add-category" class="family-action" type="button"><span aria-hidden="true">+</span>Добавить категорию</button>
      <p id="family-category-note" aria-live="polite"></p></fieldset>
      <button class="btn-primary" type="submit">Сохранить настройки семьи</button></form>
      <button id="family-invite" class="lilac-account-action" type="button">Создать приглашение<span aria-hidden="true">›</span></button>
      <label id="invite-result" class="hidden">Одноразовая ссылка, действует сутки. Скопируйте и передайте лично.<input id="invite-link" readonly aria-label="Ссылка приглашения"></label>`;
    const form = $('family-settings');
    const editor = categoryEditor = editCategories(form);
    form.onsubmit = event => {
      event.preventDefault();
      const stamp = epoch, family = selected, button = form.querySelector('[type="submit"]');
      if (button.disabled) return;
      const rows = [...editor.rows.values()];
      const blank = rows.find(({ input }) => !input.value.trim());
      if (blank) {
        blank.input.setCustomValidity('Введите название категории.');
        blank.input.reportValidity();
        return;
      }
      const categories = rows.map(({ category, input, color }) => ({
        ...category, name: input.value.trim(),
        color: color.value === category.color.toLowerCase() ? category.color : color.value,
      }));
      const removed = family.settings.categories.some(cat => !editor.rows.has(cat.id));
      const name = $('family-edit-name').value.trim();
      const controls = [...form.elements].filter(control => !control.disabled);
      controls.forEach(control => { control.disabled = true; });
      $('account-error').textContent = '';
      runSaveAction(async () => {
        try {
          const updated = await storage.updateSettings(family.revision, { name, settings: { ...family.settings, categories } });
          if (stamp !== epoch) return false;
          selected = { ...updated, role: family.role };
          setCategories(updated.settings.categories);
          renderAccount();
          if (removed) await loadAll();
          else { renderTabs(); renderAll(); renderBacklog(); }
        } catch (error) { if (stamp === epoch) $('account-error').textContent = message(error); return false; }
        finally { controls.forEach(control => { control.disabled = false; }); }
      });
    };
    $('family-invite').onclick = () => runSaveAction(async () => {
      const button = $('family-invite'); if (button.disabled) return; button.disabled = true;
      const stamp = epoch;
      try {
        const invite = await request('budget_create_invite', { household_id: selected.id, ttl_seconds: 86400 });
        $('invite-link').value = location.origin + location.pathname + '#invite=' + invite.token;
        $('invite-result').classList.remove('hidden'); $('invite-link').select();
      } catch (error) { if (stamp === epoch && $('account-error')) $('account-error').textContent = message(error); return false; }
      finally { button.disabled = false; }
    });
  }
  submit($('family-create'), async () => {
    const family = await request('budget_create_household', { name: $('family-name').value.trim() });
    families = await rpc('budget_list_households', {}); await select(family.id);
  });
  submit($('family-join'), async () => {
    const input = $('family-token').value.trim();
    const token = input.includes('#') ? new URLSearchParams(input.split('#')[1]).get('invite') : input;
    if (!/^[a-f0-9]{64}$/i.test(token || '')) throw new Error('Введите ссылку или код приглашения');
    sessionStorage.setItem(pendingKey, token);
    const result = await rpc('budget_join_household', { token });
    sessionStorage.removeItem(pendingKey); families = await rpc('budget_list_households', {}); await select(result.household_id);
  });
  async function showSession(session) {
    if (session?.user?.id === user?.id && user) return;
    clear(); user = session?.user || null; requests.clear();
    $('login-overlay').classList.toggle('hidden', !!user);
    if (!user) { $('login-email').focus(); return; }
    const stamp = epoch;
    try { await list(); }
    catch (error) { if (stamp === epoch) { onboarding(); $('family-error').textContent = message(error); } }
  }
  async function login(event, signup = false) {
    event.preventDefault(); const button = $('login-btn'); if (button.disabled) return;
    if (!$('login-email').form.reportValidity()) return;
    button.disabled = true; $('login-err').textContent = '';
    const stamp = epoch;
    try {
      const credentials = { email: $('login-email').value.trim(), password: $('login-pass').value };
      const { data, error } = await (signup ? sb.auth.signUp(credentials) : sb.auth.signInWithPassword(credentials));
      if (stamp !== epoch) return;
      if (error) throw error;
      if (signup && !data.session) { $('login-err').textContent = 'Подтвердите почту по ссылке в письме, затем войдите.'; return; }
      $('login-pass').value = ''; await showSession(data.session);
    } catch (error) {
      $('login-err').textContent = error.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : error.message === 'Email not confirmed' ? 'Подтвердите почту по ссылке в письме.' : message(error);
    } finally { button.disabled = false; }
  }
  async function logout() {
    clear(); user = null; requests.clear(); $('login-overlay').classList.remove('hidden');
    const { error } = await sb.auth.signOut(); if (error) $('login-err').textContent = message(error);
  }
  $('family-logout').onclick = logout;
  let authEvents = 0;
  sb.auth.onAuthStateChange?.((_event, session) => { authEvents++; queueMicrotask(() => showSession(session)); });
  document.addEventListener('visibilitychange', () => {
    const stamp = epoch;
    if (document.visibilityState === 'visible' && selected && $('save-status').dataset.state !== 'error' && !document.activeElement?.matches('input,select,textarea')) loadAll().catch(error => { if (stamp === epoch) flash(message(error), true); });
  });
  return { login, logout, refresh: async () => {
    if (!selected) return;
    const stamp = epoch, draft = captureDraft();
    const added = categoryEditor ? [...categoryEditor.rows.values()]
      .filter(({ category }) => !selected.settings.categories.some(cat => cat.id === category.id))
      .map(({ category, input, color }) => ({ ...category, name: input.value, color: color.value })) : [];
    const removed = categoryEditor ? selected.settings.categories.filter(cat => !categoryEditor.rows.has(cat.id)) : [];
    const details = await rpc('budget_household_details', { household_id: selected.id });
    selected = { ...details, role: selected.role }; setCategories(details.settings.categories);
    await loadAll(); if (stamp !== epoch) return;
    renderAccount();
    if (categoryEditor) {
      for (const cat of added) if (categoryEditor.rows.size < 100 && !categoryEditor.rows.has(cat.id)) categoryEditor.append(cat);
      for (const cat of removed) if (categoryEditor.rows.size > 1) {
        categoryEditor.rows.get(cat.id)?.row.remove();
        categoryEditor.rows.delete(cat.id);
      }
    }
    restoreDraft(draft);
    categoryEditor?.updateControls();
  }, start: async () => {
    const event = authEvents;
    const { data, error } = await sb.auth.getSession();
    if (event !== authEvents) return;
    if (error) { await showSession(null); $('login-err').textContent = message(error); }
    else await showSession(data.session);
  } };
}
