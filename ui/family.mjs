import { state, $, setCategories, loadAll, renderAll, renderBacklog, flash, esc, activeModal, closeModal, resetContext, runSaveAction } from '../shared/core.js';
import { cloudErrorMessage } from '../storage/supabase.mjs';

// Owns Auth, selected household and generation-scoped Realtime lifetime.
export function installFamily({ client: sb, storage }) {
  let epoch = 0, user = null, selected = null, families = [], channel = null;
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
    <form id="family-create"><label>Название семьи<input id="family-name" required maxlength="120" placeholder="Наш бюджет"></label><button class="btn-primary">Создать семейный бюджет</button></form>
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
    selected.settings.categories.forEach((cat, i) => add(`[data-family-cat="${i}"]`, cat.name, 'Категория'));
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
  function renderAccount() {
    account.innerHTML = `<h2>${esc(selected.name)}</h2><p>${selected.role === 'owner' ? 'Владелец' : 'Участник'}</p>
      <button id="family-switch" type="button">Выбрать семейный бюджет</button><div id="family-owner"></div><p id="account-error" role="alert"></p>`;
    $('family-switch').onclick = () => {
      clear(); const stamp = epoch;
      list(false).catch(error => { if (stamp === epoch) { $('family-error').textContent = message(error); onboarding(); } });
    };
    if (selected.role !== 'owner') return;
    $('family-owner').innerHTML = `<form id="family-settings"><label>Название семьи<input id="family-edit-name" required maxlength="120" value="${esc(selected.name)}"></label>
      ${selected.settings.categories.map((cat, i) => `<label>Категория<input data-family-cat="${i}" required value="${esc(cat.name)}"></label>`).join('')}
      <button class="btn-primary">Сохранить настройки семьи</button></form><button id="family-invite" type="button">Создать приглашение</button>
      <label id="invite-result" class="hidden">Одноразовая ссылка, действует сутки. Скопируйте и передайте лично.<input id="invite-link" readonly aria-label="Ссылка приглашения"></label>`;
    $('family-settings').onsubmit = event => {
      event.preventDefault();
      const stamp = epoch, family = selected, button = event.currentTarget.querySelector('button');
      if (button.disabled) return;
      button.disabled = true; $('account-error').textContent = '';
      runSaveAction(async () => {
        try {
          const categories = family.settings.categories.map((cat, i) => ({ ...cat, name: account.querySelector(`[data-family-cat="${i}"]`).value.trim() }));
          const updated = await storage.updateSettings(family.revision, { name: $('family-edit-name').value.trim(), settings: { ...family.settings, categories } });
          if (stamp !== epoch) return false;
          selected = { ...updated, role: family.role }; setCategories(categories); renderAccount(); renderAll(); renderBacklog();
        } catch (error) { if (stamp === epoch) $('account-error').textContent = message(error); return false; }
        finally { button.disabled = false; }
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
    const details = await rpc('budget_household_details', { household_id: selected.id });
    selected = { ...details, role: selected.role }; setCategories(details.settings.categories);
    await loadAll(); if (stamp !== epoch) return;
    renderAccount(); restoreDraft(draft);
  }, start: async () => {
    const event = authEvents;
    const { data, error } = await sb.auth.getSession();
    if (event !== authEvents) return;
    if (error) { await showSession(null); $('login-err').textContent = message(error); }
    else await showSession(data.session);
  } };
}
