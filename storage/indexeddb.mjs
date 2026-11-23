import { normalizeEntry } from '../shared/domain.mjs';

// Local adapter. Promise resolution always follows transaction commit.
export function createIndexedDBAdapter({ indexedDB, uid, name = 'budget-free', getCategories,
  defaultCategories = [], onChanged = () => {}, onError = () => {}, onVersionChange = () => {} }) {
const DB_NAME = name;
const DB_VERSION = 2;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => {
      const db = req.result;
      if (event.oldVersion < 1) {
      const months = db.createObjectStore('months', { keyPath: 'id' });
      months.createIndex('period', ['year', 'month', 'half'], { unique: true });
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('month_id', 'month_id');
      db.createObjectStore('backlog', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
      }
      const store = req.transaction.objectStore('entries');
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.update(normalizeEntry(cursor.value)); cursor.continue();
      };
    };
    req.onsuccess = () => {
      const db = req.result;
      // новая версия приложения в другой вкладке обновляет схему
      db.onversionchange = () => { db.close(); onVersionChange(); };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => onError(new Error('Закрой другие вкладки с бюджетом'));
  });
  return dbPromise;
}

// fn(stores, out, t): результат кладётся в out.value, промис резолвится
// только после commit транзакции.
async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const names = [].concat(storeNames);
    const t = db.transaction(names, mode);
    const s = {};
    names.forEach(n => { s[n] = t.objectStore(n); });
    const out = {};
    t.oncomplete = () => resolve(out.value);
    t.onabort = () => reject(out.error || t.error || new Error('Операция отменена'));
    try { fn(s, out, t); } catch (e) { out.error = e; t.abort(); }
  });
}

function onReq(r, cb) { r.onsuccess = () => cb(r.result); }

function fail(out, t, msg) { out.error = new Error(msg); t.abort(); }

// Любая ошибка записи должна быть видна: молча потерянная правка хуже алерта.
async function write(storeNames, fn) {
  try {
    const v = await tx(storeNames, 'readwrite', fn);
    onChanged();
    return v;
  } catch (e) {
    onError(e);
    throw e;
  }
}

const getMeta = key => tx('meta', 'readonly', (s, out) =>
  onReq(s.meta.get(key), r => { out.value = r ? r.value : undefined; }));
const setMeta = (key, value) => tx('meta', 'readwrite', s => { s.meta.put({ key, value }); });
const delMeta = key => tx('meta', 'readwrite', s => { s.meta.delete(key); });

function patchRow(store, id, patch) {
  onReq(store.get(id), row => {
    if (row) store.put({ ...(row.type ? normalizeEntry(row) : row), ...patch, updated_at: Date.now() });
  });
}

const catIndex = id => { const i = getCategories().findIndex(c => c.id === id); return i === -1 ? 999 : i; };
const sortRows = rows => rows.sort((a, b) =>
  (a.type || '').localeCompare(b.type || '')
  || catIndex(a.category) - catIndex(b.category)
  || (a.created_at || 0) - (b.created_at || 0));

const api = {
  listMonths: () => tx('months', 'readonly', (s, out) =>
    onReq(s.months.getAll(), v => { out.value = v; })),

  getMonth: id => tx(['months', 'entries'], 'readonly', (s, out) => {
    out.value = {};
    onReq(s.months.get(id), v => { out.value.month = v; });
    onReq(s.entries.index('month_id').getAll(id), v => { out.value.entries = sortRows(v.map(normalizeEntry)); });
  }),

  createMonth: async (year, month, half, copyFromId) => {
    try {
      const created = await tx(['months', 'entries'], 'readwrite', (s, out) => {
        const now = Date.now();
        const m = { id: uid(), year, month, half, income: 0, saved: 0, created_at: now, updated_at: now };
        s.months.add(m);
        out.value = m;
        if (!copyFromId) return;
        onReq(s.entries.index('month_id').getAll(copyFromId), src => {
          src.forEach((e, i) => s.entries.add({
            id: uid(), month_id: m.id, type: e.type, category: e.category,
            name: e.name, planned: e.planned, actual: 0, is_reserve: normalizeEntry(e).is_reserve,
            created_at: now + i, updated_at: now,
          }));
        });
      });
      onChanged();
      return created;
    } catch (e) {
      // уникальный индекс по периоду: его уже создали в другой вкладке
      if (e && e.name === 'ConstraintError') return { error: 'exists' };
      onError(e);
      throw e;
    }
  },

  updateMonth: (id, patch) => write('months', s => patchRow(s.months, id, patch)),

  createEntry: row => write('entries', (s, out) => {
    const now = Date.now();
    const e = normalizeEntry({ id: uid(), actual: 0, ...row, created_at: now, updated_at: now });
    s.entries.add(e);
    out.value = e;
  }),
  updateEntry: (id, patch) => write('entries', s => patchRow(s.entries, id, patch)),
  deleteEntry: id => write('entries', s => { s.entries.delete(id); }),

  listBacklog: () => tx('backlog', 'readonly', (s, out) =>
    onReq(s.backlog.getAll(), v => { out.value = sortRows(v); })),
  createBacklog: row => write('backlog', (s, out) => {
    const now = Date.now();
    const b = { id: uid(), ...row, created_at: now, updated_at: now };
    s.backlog.add(b);
    out.value = b;
  }),
  updateBacklog: (id, patch) => write('backlog', s => patchRow(s.backlog, id, patch)),
  deleteBacklog: id => write('backlog', s => { s.backlog.delete(id); }),

  entryToBacklog: eid => write(['entries', 'backlog'], (s, out, t) => {
    onReq(s.entries.get(eid), e => {
      if (!e) return fail(out, t, 'запись не найдена');
      const now = Date.now();
      const b = { id: uid(), category: e.category, name: e.name, planned: e.planned, created_at: now, updated_at: now };
      s.backlog.add(b);
      s.entries.delete(eid);
      out.value = b;
    });
  }),

  backlogToEntry: (bid, monthId) => write(['entries', 'backlog', 'months'], (s, out, t) => {
    onReq(s.months.get(monthId), m => {
      if (!m) return fail(out, t, 'период не найден');
      onReq(s.backlog.get(bid), b => {
        if (!b) return fail(out, t, 'запись не найдена');
        const now = Date.now();
        const e = {
          id: uid(), month_id: monthId, type: 'planned', category: b.category,
          name: b.name, planned: b.planned, actual: 0, created_at: now, updated_at: now,
        };
        s.entries.add(e);
        s.backlog.delete(bid);
        out.value = e;
      });
    });
  }),

  saveCategories: list => write('meta', s => { s.meta.put({ key: 'categories', value: list }); }),

  // удаление категории: её записи переезжают в другую, всё одной транзакцией
  deleteCategory: (catId, toId, list) => write(['entries', 'backlog', 'meta'], s => {
    ['entries', 'backlog'].forEach(name => {
      onReq(s[name].getAll(), rows => rows
        .filter(r => r.category === catId)
        .forEach(r => s[name].put({ ...r, category: toId, updated_at: Date.now() })));
    });
    s.meta.put({ key: 'categories', value: list });
  }),

  snapshot: () => tx(['months', 'entries', 'backlog', 'meta'], 'readonly', (s, out) => {
    out.value = { app: 'budget', format: 2, exportedAt: new Date().toISOString() };
    onReq(s.meta.get('categories'), r => { out.value.categories = r ? r.value : defaultCategories; });
    onReq(s.months.getAll(), v => { out.value.months = v; });
    onReq(s.entries.getAll(), v => { out.value.entries = v.map(normalizeEntry); });
    onReq(s.backlog.getAll(), v => { out.value.backlog = v; });
  }),

  // замена всех данных; прежнее состояние сохраняется для отката
  restore: (data, previous) => write(['months', 'entries', 'backlog', 'meta'], s => {
    s.months.clear(); s.entries.clear(); s.backlog.clear();
    data.months.forEach(r => s.months.add(r));
    data.entries.forEach(r => s.entries.add(normalizeEntry(r)));
    data.backlog.forEach(r => s.backlog.add(r));
    s.meta.put({ key: 'categories', value: data.categories });
    if (previous) s.meta.put({ key: 'preImport', value: previous });
    else s.meta.delete('preImport');
  }),
};

return Object.assign(api, { getMeta, setMeta, delMeta, tx, openDB, close: async () => (await openDB()).close() });
}
