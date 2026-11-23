// Household-scoped PostgREST reads; all writes use the transactional SQL API.
export function cloudErrorMessage(error) {
  const raw = String(error?.message || ''), code = String(error?.code || '');
  if (error?.userMessage === true) return raw;
  const messages = [
    ['revision_conflict', 'Данные изменились на другом устройстве. Ввод сохранён. Нажмите «Обновить данные», затем повторите правку.'],
    ['insufficient_funds', 'В выбранном источнике не хватает денег. Обновите данные и выберите другой источник.'],
    ['not_member', 'Нет доступа к семейному бюджету. Войдите заново.'],
    ['owner_required', 'Это действие доступно владельцу семьи.'],
    ['not_found', 'Запись уже удалена. Обновите данные; введённые значения останутся в черновике.'],
    ['request_mismatch', 'Запрос не совпал с предыдущей попыткой. Обновите данные и повторите действие.'],
    ['invalid_invite', 'Приглашение недействительно, истекло или уже использовано. Попросите новую ссылку.'],
    ['invalid_amount', 'Проверьте сумму: от нуля до триллиона рублей, не более двух знаков после запятой.'],
    ['invalid_source', 'Источник денег недоступен. Обновите данные и выберите другой.'],
    ['invalid_payload', 'Проверьте заполненные поля.'],
    ['Invalid login credentials', 'Неверная почта или пароль'],
    ['Email not confirmed', 'Подтвердите почту по ссылке в письме.'],
    ['User already registered', 'Этот аккаунт уже существует. Войдите с паролем.'],
    ['Password should', 'Пароль слишком короткий. Используйте не менее шести символов.'],
  ];
  for (const [match, message] of messages) if (raw.includes(match)) return message;
  if (code === 'PGRST202' || code === '42883') return 'Облачный бюджет ещё не настроен. Попросите владельца проверить настройку сервиса.';
  if (code === '23505') return 'Такой спринт уже создан. Обновите данные.';
  if (['23514','23502','23503'].includes(code)) return 'Проверьте поля и суммы, затем обновите данные и повторите действие.';
  if (['Контекст изменился', 'Семья не выбрана', 'Перечитайте данные', 'Введите ссылку или код приглашения'].some(prefix => raw.startsWith(prefix))) return raw;
  return 'Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.';
}
export function createSupabaseAdapter({ client: sb, onError = () => {}, householdId = null,
  requestStore = globalThis.sessionStorage, uuid = () => crypto.randomUUID() } = {}) {
  let context = householdId, userId = null, generation = 0;
  const cache = { months: new Map(), entries: new Map(), backlog: new Map() };
  const pending = new Map();
  const contextError = () => new Error('Контекст изменился. Откройте бюджет заново.');
  function ensure() { if (!context) throw new Error('Семья не выбрана'); return generation; }
  function check(epoch) { if (epoch !== generation) throw contextError(); }
  function remember(table, rows) { for (const row of [].concat(rows || [])) if (row) cache[table].set(row.id, row); return rows; }
  function revision(table, id) {
    const value = cache[table].get(id)?.revision;
    if (value == null) throw new Error('Перечитайте данные перед сохранением');
    return value;
  }
  function unwrap(result) { if (result.error) throw result.error; return result.data; }
  function report(error) {
    const reported = new Error(cloudErrorMessage(error));
    reported.userMessage = true;
    reported.code = error.code;
    onError(reported); return reported;
  }
  async function read(table, configure = query => query) {
    const epoch = ensure();
    try {
      const result = unwrap(await configure(sb.from(table).select('*').eq('household_id', context)));
      check(epoch); return remember(table, result);
    } catch (error) { check(epoch); throw report(error); }
  }
  async function atomic(operation, payload) {
    const epoch = ensure(), family = context;
    const intent = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith('expected_')));
    const key = 'budget-request:' + JSON.stringify([userId, family, operation, intent]);
    let request = pending.get(key);
    try { request ||= JSON.parse(requestStore?.getItem(key) || 'null'); } catch {}
    request ||= { id: uuid(), payload };
    const requestId = request.id; payload = request.payload; pending.set(key, request);
    try { requestStore?.setItem(key, JSON.stringify(request)); } catch {}
    const clear = () => {
      if (epoch !== generation || pending.get(key) !== request) return;
      pending.delete(key);
      try { if (JSON.parse(requestStore?.getItem(key) || 'null')?.id === requestId) requestStore.removeItem(key); } catch {}
    };
    try {
      const result = unwrap(await sb.rpc('budget_mutate', { household_id: family, request_id: requestId, operation, payload }));
      clear(); check(epoch);
      if (result.month) remember('months', result.month);
      const table = operation.includes('backlog') && operation !== 'backlog_to_entry' ? 'backlog'
        : operation.includes('month') ? 'months' : 'entries';
      if (result.row && operation !== 'update_settings' && !operation.startsWith('delete_')) remember(table, result.row);
      if (operation === 'delete_entry' || operation === 'entry_to_backlog') cache.entries.delete(payload.id);
      if (operation === 'delete_backlog' || operation === 'backlog_to_entry') cache.backlog.delete(payload.id);
      if (operation === 'delete_month') cache.months.delete(payload.month_id);
      return result;
    } catch (error) {
      // SQL rejection is definitive. Transport uncertainty retains the original UUID.
      if (error.code && !String(error.code).startsWith('PGRST')) clear();
      check(epoch); throw report(error);
    }
  }
  const row = async (operation, payload) => (await atomic(operation, payload)).row;
  const entryPatch = value => ({ ...value, ...(Object.hasOwn(value, 'is_reserve') ? { is_reserve: value.is_reserve === true } : {}) });
  return {
    capabilities: { atomicOperations: ['quickExpense','coverOverrun'], reserveColumn: true },
    getContext: () => ({ householdId: context, generation }),
    setContext(value) {
      context = value?.householdId ?? null; userId = value?.userId ?? null; generation++;
      for (const table of Object.values(cache)) table.clear(); pending.clear();
    },
    observe(table, value) { remember(table, value); },
    atomic,
    listMonths: () => read('months', q => q.order('year', { ascending: false }).order('month', { ascending: false }).order('half', { ascending: false })),
    async getMonth(id) {
      const epoch = ensure();
      const month = await read('months', q => q.eq('id', id).single());
      const entries = await read('entries', q => q.eq('month_id', id).order('type').order('category').order('planned', { ascending: false }));
      check(epoch); return { month, entries };
    },
    async createMonth(year, month, half, copyFromId) {
      try { return await row('create_month', { year, month, half, ...(copyFromId ? { copy_from_id: copyFromId, expected_revision: revision('months', copyFromId) } : {}) }); }
      catch (error) { if (error.code === '23505') return { error: 'exists' }; throw error; }
    },
    updateMonth: (id, patch) => row('update_month', { month_id: id, expected_revision: revision('months', id), ...patch }),
    deleteMonth: id => row('delete_month', { month_id: id, expected_revision: revision('months', id) }),
    createEntry: value => { const { month_id, ...fields } = entryPatch(value); return row('create_entry', { month_id, expected_revision: revision('months', month_id), is_reserve: false, ...fields }); },
    updateEntry: (id, patch) => row('update_entry', { id, expected_revision: revision('entries', id), ...entryPatch(patch) }),
    deleteEntry: id => row('delete_entry', { id, expected_revision: revision('entries', id) }),
    entryToBacklog: id => row('entry_to_backlog', { id, expected_revision: revision('entries', id) }),
    listBacklog: () => read('backlog', q => q.order('category').order('planned', { ascending: false })),
    createBacklog: value => row('create_backlog', value),
    updateBacklog: (id, patch) => row('update_backlog', { id, expected_revision: revision('backlog', id), ...patch }),
    deleteBacklog: id => row('delete_backlog', { id, expected_revision: revision('backlog', id) }),
    backlogToEntry: (id, month_id) => row('backlog_to_entry', { id, expected_revision: revision('backlog', id), month_id, expected_month_revision: revision('months', month_id) }),
    quickExpense: value => atomic('quick_expense', { expected_revision: revision('months', value.month_id), ...value }),
    coverOverrun: value => atomic('cover_overrun', { expected_revision: revision('months', value.month_id), ...value }),
    updateSettings: (expected_revision, patch) => row('update_settings', { expected_revision, ...patch }),
  };
}
