const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createSupabaseAdapter, cloudErrorMessage } = require('../storage/supabase.mjs');
const { storageContract } = require('./storage-contract.mjs');
const { postgrestFixture } = require('./supabase-fixture.cjs');
const { PGlite } = require('@electric-sql/pglite');

test('Supabase adapter executes unchanged CRUD/copy/move contract through real PostgreSQL RPC', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(readFileSync('tests/fixtures/budget-auth.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/001_households.sql','utf8'));
  await db.exec("SET ROLE authenticated; SET request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-000000000001\"}'");
  const family = (await db.query("SELECT budget_create_household('Transport test',$1) AS value",[crypto.randomUUID()])).rows[0].value;
  const client = {
    from(table) {
      assert.ok(['months','entries','backlog'].includes(table));
      let single = false; const filters = [];
      const q = { select() { return q; }, eq(key,value) { assert.ok(['household_id','id','month_id'].includes(key)); filters.push([key,value]); return q; },
        order() { return q; }, single() { single = true; return q; },
        async then(resolve,reject) {
          try {
            const result = await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM public.${table} t WHERE ${filters.map(([key],i)=>`${key}=$${i+1}`).join(' AND ')}`,filters.map(x=>x[1]));
            const rows = result.rows[0].rows; return resolve({ data: single ? rows[0] : rows, error: null });
          } catch(error) { return reject(error); }
        } };
      return q;
    },
    async rpc(name,args) {
      assert.equal(name,'budget_mutate');
      try { return { data: (await db.query('SELECT budget_mutate($1,$2,$3,$4::jsonb) AS value',[args.household_id,args.request_id,args.operation,JSON.stringify(args.payload)])).rows[0].value }; }
      catch(error) { return { error }; }
    },
  };
  const api = createSupabaseAdapter({ client, householdId: family.id });
  const { month } = await storageContract(api);
  const reserve = await api.createEntry({ month_id: month.id, type: 'mandatory', category: 'one', name: 'Подушка', planned: 200, actual: 0, is_reserve: true });
  const expense = await api.createEntry({ month_id: month.id, type: 'planned', category: 'one', name: 'Покупка', planned: 50, actual: 100 });
  await api.coverOverrun({ month_id: month.id, id: expense.id, source: 'saved' });
  let loaded = await api.getMonth(month.id);
  assert.equal(loaded.month.saved, 50);
  assert.equal(loaded.entries.find(e => e.id === expense.id).planned, 100);
  await api.quickExpense({ month_id: month.id, source: 'reserve', amount: 20, category: 'one', name: 'Новый расход' });
  loaded = await api.getMonth(month.id);
  assert.equal(loaded.entries.find(e => e.id === reserve.id).actual, 20);
  assert.equal(loaded.entries.find(e => e.name === 'Новый расход').actual, 20);
  const before = structuredClone(loaded);
  await assert.rejects(api.quickExpense({ month_id: month.id, source: 'saved', amount: 1000, category: 'one', name: 'Отказ' }), /не хватает денег/);
  assert.deepEqual(await api.getMonth(month.id), before);
  await api.deleteMonth(month.id);
  assert.ok(!(await api.listMonths()).some(row => row.id === month.id));
});

test('household-scoped reads and mutations fail closed, preserve explicit reserve and revisions', async () => {
  const fixture = postgrestFixture(), calls = fixture.calls;
  fixture.tables.months.push({ id: 1, household_id: 'a', revision: 7 }, { id: 2, household_id: 'b', revision: 3 });
  fixture.tables.entries.push({ id: 4, month_id: 1, household_id: 'a', revision: 2, type: 'mandatory', name: 'Непредвиденные', is_reserve: false });
  fixture.tables.backlog.push({ id: 8, household_id: 'a', revision: 5 });
  const api = createSupabaseAdapter({ client: fixture.client });
  await assert.rejects(api.listMonths(), /Семья не выбрана/); assert.equal(calls.length,0);
  api.setContext({ householdId: 'a' });
  assert.equal((await api.listMonths()).length,1);
  assert.equal((await api.getMonth(1)).entries[0].is_reserve,false);
  await api.listBacklog();
  const reads = calls.filter(c=>c.table);
  assert.ok(reads.every(c=>c.operation==='select' && c.filters.some(([k,v])=>k==='household_id' && v==='a')));
  fixture.client.rpc = async (name,args) => { calls.push({rpc:name,args}); return { data: { row: { id:4,revision:3 }, month: {id:1,revision:8} } }; };
  await api.updateEntry(4,{is_reserve:true});
  await api.updateMonth(1,{income:100});
  await api.backlogToEntry(8,1);
  const mutations = calls.filter(c=>c.rpc);
  assert.ok(mutations.every(c=>c.rpc==='budget_mutate' && c.args.household_id==='a' && /^[a-f0-9-]{36}$/.test(c.args.request_id)));
  assert.deepEqual(mutations[0].args.payload,{id:4,expected_revision:2,is_reserve:true});
  assert.equal(mutations[1].args.payload.expected_revision,8);
  assert.equal(mutations[2].args.payload.expected_revision,5);
  assert.equal(mutations[2].args.payload.expected_month_revision,8);
  api.setContext(null); await assert.rejects(api.listBacklog(),/Семья не выбрана/);
});

test('uncertain retry retains UUID and original revision across reload/refetch; successful intent gets a new UUID', async () => {
  const fixture=postgrestFixture(), calls=[], values=new Map();
  const requestStore={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  fixture.client.rpc=async(name,args)=> { calls.push(args); return calls.length===1 ? {error:new Error('Network timeout')} : {data:{row:{id:1,revision:9},month:{id:1,revision:9}}}; };
  let api=createSupabaseAdapter({client:fixture.client,requestStore,householdId:'a'});
  api.observe('months',{id:1,revision:7});
  await assert.rejects(api.updateMonth(1,{income:200}),/Проверьте соединение/);
  api=createSupabaseAdapter({client:fixture.client,requestStore,householdId:'a'});
  api.observe('months',{id:1,revision:8});
  await api.updateMonth(1,{income:200});
  assert.equal(calls[0].request_id,calls[1].request_id); assert.equal(calls[1].payload.expected_revision,7);
  await api.updateMonth(1,{income:200}); assert.notEqual(calls[1].request_id,calls[2].request_id);
});

test('stale conflicts preserve cached revision and context switch rejects late reads and writes', async () => {
  const fixture=postgrestFixture(), errors=[];
  const api=createSupabaseAdapter({client:fixture.client,householdId:'a',onError:e=>errors.push(e.message)});
  api.observe('months',{id:1,revision:7});
  fixture.client.rpc=async()=>({error:{code:'40001',message:'revision_conflict'}});
  await assert.rejects(api.updateMonth(1,{income:200}),/Ввод сохранён/);
  assert.match(errors[0],/Обновить данные/);
  let resolve;
  fixture.client.rpc=()=>new Promise(done=>{resolve=done;});
  const pending=api.updateMonth(1,{income:200}); api.setContext({householdId:'b'});
  resolve({data:{row:{id:1,revision:9},month:{id:1,revision:9}}}); await assert.rejects(pending,/Контекст изменился/);
  const read=api.listMonths(); api.setContext({householdId:'c'}); await assert.rejects(read,/Контекст изменился/);
});

test('late response from an old generation cannot clear the new generation retry journal', async () => {
  const values = new Map(), requests = [], completions = [];
  const requestStore = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const client = { rpc: (_name,args) => { requests.push(args); return new Promise(resolve => completions.push(resolve)); } };
  const api = createSupabaseAdapter({ client, requestStore });
  const context = { householdId: 'a', userId: 'person' };
  api.setContext(context); api.observe('months', { id: 1, revision: 1 });
  const old = api.updateMonth(1, { income: 300 });
  api.setContext(null); api.setContext(context); api.observe('months', { id: 1, revision: 1 });
  const current = api.updateMonth(1, { income: 300 });
  completions[0]({ data: { row: { id: 1, revision: 2 }, month: { id: 1, revision: 2 } } });
  await assert.rejects(old, /Контекст изменился/);
  assert.equal(values.size, 1);
  completions[1]({ error: new Error('Network timeout') });
  await assert.rejects(current, /Проверьте соединение/);
  const retry = api.updateMonth(1, { income: 300 });
  assert.equal(requests[2].request_id, requests[1].request_id);
  completions[2]({ data: { row: { id: 1, revision: 2 }, month: { id: 1, revision: 2 } } });
  await retry; assert.equal(values.size, 0);
});

test('expected SQL/transport errors have safe Russian messages without endpoints or identifiers', () => {
  for (const error of [
    { message: 'insufficient_funds' }, { message: 'revision_conflict' }, { message: 'not_found' }, { message: 'request_mismatch' },
    { code: 'PGRST202', message: 'Could not find function public.budget_mutate in schema cache' },
    { message: 'https://private.example.invalid endpoint 00000000-0000-0000-0000-000000000001' },
  ]) {
    const result = cloudErrorMessage(error);
    assert.match(result, /[А-Яа-я]/); assert.doesNotMatch(result, /budget_|public\.|https:|00000000/);
  }
});
