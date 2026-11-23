const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const read = path => readFileSync(resolve(__dirname, '..', path), 'utf8');
const migration = read('supabase/migrations/001_households.sql');
const prepare = read('supabase/legacy/prepare.sql');
const importer = read('supabase/legacy/import.sql');
const users = [1,2,3,4].map(n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);
async function fixture() {
  const db = new PGlite();
  await db.exec(read('tests/fixtures/budget-auth.sql'));
  return db;
}
async function as(db, user, sql, args = []) {
  await db.exec(`SET ROLE ${user === null ? 'anon' : 'authenticated'}`);
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify(user ? {sub:user,role:'authenticated'} : {role:'anon'})]);
    const identity = await db.query('SELECT current_user AS role');
    assert.equal(identity.rows[0].role, user === null ? 'anon' : 'authenticated');
    return (await db.query(sql,args)).rows;
  } finally { await db.exec('RESET ROLE'); }
}
async function rpc(db,user,name,args=[],casts=[]) {
  const sql = `SELECT public.${name}(${args.map((_,i)=>`$${i+1}${casts[i] ? '::'+casts[i] : ''}`).join(',')}) AS value`;
  return (await as(db,user,sql,args))[0].value;
}
const mutate = (db,u,h,op,p,id=randomUUID()) => rpc(db,u,'budget_mutate',[h,id,op,p],['uuid','uuid','text','jsonb']);
const createFamily = (db,u,name) => rpc(db,u,'budget_create_household',[name,randomUUID()]);
const month = async (db,u,id) => (await as(db,u,'SELECT * FROM months WHERE id=$1',[id]))[0];
const rev = row => Number(row.revision);

test('PostgreSQL: independent families, restricted RLS/privileges, sharing and invites', async t => {
  const db=await fixture(); t.after(()=>db.close());
  await db.exec('CREATE SEQUENCE public.unrelated_sequence; GRANT USAGE ON SEQUENCE public.unrelated_sequence TO authenticated');
  const beforeACL=(await db.query("SELECT relacl::text AS acl FROM pg_class WHERE oid='public.unrelated_sequence'::regclass")).rows[0].acl;
  await db.exec(migration);
  assert.equal((await db.query("SELECT relacl::text AS acl FROM pg_class WHERE oid='public.unrelated_sequence'::regclass")).rows[0].acl,beforeACL);
  assert.equal(Number((await as(db,users[0],"SELECT nextval('public.unrelated_sequence') AS n"))[0].n),1);
  await assert.rejects(as(db,users[0],"SELECT nextval('public.months_id_seq')"),/permission denied/);
  const a=await createFamily(db,users[0],'Семья A'); const b=await createFamily(db,users[2],'Семья B');
  let am=(await mutate(db,users[0],a.id,'create_month',{year:2026,month:11,half:1})).row;
  const bm=(await mutate(db,users[2],b.id,'create_month',{year:2026,month:11,half:1})).row;
  const be=(await mutate(db,users[2],b.id,'create_entry',{month_id:bm.id,expected_revision:1,type:'planned',category:'general'})).row;
  const bb=(await mutate(db,users[2],b.id,'create_backlog',{category:'general'})).row;
  await t.test('RLS direct SELECT, anonymous denial and no direct writes', async()=>{
    assert.deepEqual((await as(db,users[0],'SELECT id FROM households')).map(x=>x.id),[a.id]);
    assert.equal((await as(db,users[0],'SELECT * FROM months WHERE id=$1',[bm.id])).length,0);
    assert.equal((await as(db,users[0],'SELECT * FROM entries WHERE id=$1',[be.id])).length,0);
    assert.equal((await as(db,users[0],'SELECT * FROM backlog WHERE id=$1',[bb.id])).length,0);
    assert.equal((await as(db,users[0],'SELECT * FROM household_members')).length,1);
    for(const table of ['households','household_members','months','entries','backlog'])
      await assert.rejects(as(db,null,`SELECT * FROM ${table}`),/permission denied/);
    for(const table of ['households','household_members','months','entries','backlog'])
      await assert.rejects(as(db,users[0],`DELETE FROM ${table} WHERE false`),/permission denied/);
    await assert.rejects(rpc(db,null,'budget_list_households'),/permission denied/);
    await assert.rejects(rpc(db,null,'budget_create_household',['Запрещено',randomUUID()]),/permission denied/);
    await assert.rejects(rpc(db,null,'budget_household_details',[a.id]),/permission denied/);
    await assert.rejects(rpc(db,null,'budget_create_invite',[a.id,randomUUID(),60]),/permission denied/);
    await assert.rejects(rpc(db,null,'budget_join_household',['token']),/permission denied/);
    await assert.rejects(mutate(db,null,a.id,'create_backlog',{category:'general'}),/permission denied/);
    await assert.rejects(as(db,users[0],"INSERT INTO household_members VALUES ($1,$2,'owner')",[b.id,users[0]]),/permission denied/);
    await assert.rejects(as(db,users[0],"UPDATE household_members SET role='owner'"),/permission denied/);
    await assert.rejects(as(db,users[0],'UPDATE months SET household_id=$1',[b.id]),/permission denied/);
    await assert.rejects(as(db,users[0],'SELECT * FROM budget_private.invites'),/permission denied/);
    await assert.rejects(mutate(db,users[0],b.id,'update_month',{month_id:bm.id,expected_revision:1,income:99}),/not_member/);
    await assert.rejects(mutate(db,users[0],a.id,'create_entry',{month_id:bm.id,expected_revision:1,type:'planned',category:'general'}),/not_found/);
    await assert.rejects(mutate(db,users[0],a.id,'update_month',{month_id:am.id,expected_revision:1,household_id:b.id}),/forbidden_field/);
    await assert.rejects(mutate(db,users[0],a.id,'update_entry',{id:be.id,expected_revision:1,actual:10}),/not_found/);
    await assert.rejects(mutate(db,users[0],a.id,'delete_backlog',{id:bb.id,expected_revision:1}),/not_found/);
    for (const field of ['role','user_id','revision','is_admin'])
      await assert.rejects(mutate(db,users[0],a.id,'create_backlog',{category:'general',[field]:'owner'}),/forbidden_field/);
    // Constraint itself also rejects a cross-family FK, independent of the RPC boundary.
    await assert.rejects(db.query("INSERT INTO entries(household_id,month_id,type,category) VALUES($1,$2,'planned','general')",[a.id,bm.id]),/foreign key/);
  });
  let invite;
  await t.test('owner-only invite, sharing, token reuse/expiry, no foreign membership disclosure',async()=>{
    invite=await rpc(db,users[0],'budget_create_invite',[a.id,randomUUID(),60]);
    assert.equal(invite.token.length,64);
    const request=randomUUID();
    const repeat=await rpc(db,users[0],'budget_create_invite',[a.id,request,60]);
    assert.deepEqual(await rpc(db,users[0],'budget_create_invite',[a.id,request,60]),repeat);
    await assert.rejects(rpc(db,users[0],'budget_create_invite',[a.id,request,120]),/request_mismatch/);
    assert.deepEqual(await rpc(db,users[1],'budget_join_household',[invite.token]),{household_id:a.id});
    assert.deepEqual(await rpc(db,users[1],'budget_join_household',[invite.token]),{household_id:a.id});
    await assert.rejects(rpc(db,users[3],'budget_join_household',[invite.token]),/invalid_invite/);
    await assert.rejects(rpc(db,users[1],'budget_create_invite',[a.id,randomUUID(),60]),/owner_required/);
    await assert.rejects(rpc(db,users[0],'budget_create_invite',[b.id,randomUUID(),60]),/owner_required/);
    const details=await rpc(db,users[1],'budget_household_details',[a.id]);
    assert.equal(details.members.length,2); assert.equal(details.settings.categories[0].name,'Общие');
    assert.equal((await rpc(db,users[1],'budget_list_households')).length,1);
    await assert.rejects(rpc(db,users[1],'budget_household_details',[b.id]),/not_member/);
    const expired=await rpc(db,users[0],'budget_create_invite',[a.id,randomUUID(),60]);
    await db.exec("UPDATE budget_private.invites SET expires_at=clock_timestamp()-interval '1 second' WHERE used_by IS NULL");
    await assert.rejects(rpc(db,users[3],'budget_join_household',[expired.token]),/invalid_invite/);
    await assert.rejects(rpc(db,users[3],'budget_join_household',['random']),/invalid_invite/);
    const changed=await mutate(db,users[1],a.id,'update_month',{month_id:am.id,expected_revision:1,income:500,saved:100});
    am=changed.row; assert.equal(Number((await month(db,users[0],am.id)).income),500);
    await assert.rejects(mutate(db,users[1],a.id,'update_settings',{expected_revision:1,name:'Чужое'}),/owner_required/);
  });
  await t.test('idempotency payload/operation match, stale revisions, membership rechecked on retry',async()=>{
    const id=randomUUID(),p={month_id:am.id,expected_revision:am.revision,saved:90};
    const first=await mutate(db,users[1],a.id,'update_month',p,id);
    assert.deepEqual(await mutate(db,users[1],a.id,'update_month',p,id),first);
    await assert.rejects(mutate(db,users[1],a.id,'update_month',{...p,saved:80},id),/request_mismatch/);
    await assert.rejects(mutate(db,users[1],a.id,'create_entry',p,id),/request_mismatch/);
    await assert.rejects(mutate(db,users[0],a.id,'update_month',p),/revision_conflict/);
    await db.query('DELETE FROM household_members WHERE household_id=$1 AND user_id=$2',[a.id,users[1]]);
    await assert.rejects(mutate(db,users[1],a.id,'update_month',p,id),/not_member/);
    am=first.row;
  });
  await t.test('settings belong to household and updates require owner revision',async()=>{
    const settings={categories:[{id:'food',name:'Еда',color:'#112233',default:true}]};
    await assert.rejects(mutate(db,users[0],a.id,'update_settings',{expected_revision:1,settings:{categories:[]}}),/check constraint/);
    assert.deepEqual((await mutate(db,users[0],a.id,'update_settings',{expected_revision:1,settings})).row.settings,settings);
    assert.equal((await rpc(db,users[2],'budget_household_details',[b.id])).settings.categories[0].id,'general');
    await assert.rejects(mutate(db,users[0],a.id,'update_settings',{expected_revision:1,name:'overwrite'}),/revision_conflict/);
  });
});

test('PostgreSQL: atomic copy, CRUD revisions, moves, financial sources and rollback',async t=>{
  const db=await fixture(); t.after(()=>db.close()); await db.exec(migration);
  const h=await createFamily(db,users[0],'Тест');
  let m=(await mutate(db,users[0],h.id,'create_month',{year:2026,month:11,half:1})).row;
  const act=async(op,p)=>{
    const result=await mutate(db,users[0],h.id,op,p);
    if(result.month?.id===m.id)m=result.month;
    return result;
  };
  const create=async p=>(await act('create_entry',{month_id:m.id,expected_revision:m.revision,type:'planned',category:'general',...p})).row;
  await act('update_month',{month_id:m.id,expected_revision:m.revision,income:1000,saved:100});
  let r=await create({type:'mandatory',name:'Резерв',planned:100,actual:10,is_reserve:true});
  let e=await create({name:'Еда',planned:50,actual:80});
  await t.test('reserve rename keeps type; stale row updates/deletes rejected; month_id immutable',async()=>{
    r=(await act('update_entry',{id:r.id,expected_revision:r.revision,name:'Подушка'})).row;
    assert.equal(r.is_reserve,true);
    await assert.rejects(act('update_entry',{id:r.id,expected_revision:1,name:'overwrite'}),/revision_conflict/);
    await assert.rejects(act('delete_entry',{id:r.id,expected_revision:1}),/revision_conflict/);
    await assert.rejects(act('update_entry',{id:e.id,expected_revision:e.revision,month_id:m.id}),/forbidden_field/);
    await assert.rejects(create({planned:-1}),/check constraint/);
    await assert.rejects(create({planned:1.001}),/check constraint/);
    assert.equal(rev(await month(db,users[0],m.id)),m.revision);
  });
  await t.test('copy plan resets facts, preserves reserve, unique period and stale source refusal',async()=>{
    const p={year:2026,month:11,half:2,copy_from_id:m.id,expected_revision:m.revision};
    const copy=await act('create_month',p);
    const rows=await as(db,users[0],'SELECT * FROM entries WHERE month_id=$1',[copy.row.id]);
    assert.equal(rows.length,2); assert.ok(rows.every(x=>Number(x.actual)===0)); assert.ok(rows.some(x=>x.is_reserve));
    await assert.rejects(act('create_month',p),/unique constraint/);
    await assert.rejects(act('create_month',{...p,month:12,expected_revision:1}),/revision_conflict/);
  });
  await t.test('saved and reserve cover, partial cover, quick sources, free deficit allowed',async()=>{
    e=(await act('cover_overrun',{month_id:m.id,expected_revision:m.revision,id:e.id,source:'saved'})).row;
    assert.equal(e.planned,80); assert.equal(m.saved,70);
    await act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'saved',amount:20,category:'general',name:'Кофе'});
    assert.equal(m.saved,50);
    await act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'reserve',amount:30,id:e.id});
    let rows=await as(db,users[0],'SELECT * FROM entries WHERE id=$1',[r.id]); assert.equal(Number(rows[0].actual),40);
    e=(await act('update_entry',{id:e.id,expected_revision:e.revision+1,actual:300})).row;
    e=(await act('cover_overrun',{month_id:m.id,expected_revision:m.revision,id:e.id,source:'reserve'})).row;
    assert.equal(e.planned,170); // 80+30 quick +60 remaining reserve.
    await act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'free',amount:2000,category:'general',name:'Дефицит'});
    assert.ok((await as(db,users[0],"SELECT sum(actual) AS spent FROM entries WHERE type='planned'"))[0].spent>1000);
  });
  await t.test('insufficient funds and invalid destination roll back debits; retry only one expense',async()=>{
    const before=await month(db,users[0],m.id);
    await assert.rejects(act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'saved',amount:999,category:'general'}),/insufficient_funds/);
    await assert.rejects(act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'reserve',amount:1,category:'general'}),/insufficient_funds/);
    await assert.rejects(act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'saved',amount:10,category:''}),/check constraint/);
    assert.deepEqual(await month(db,users[0],m.id),before);
    const id=randomUUID(),p={month_id:m.id,expected_revision:m.revision,source:'saved',amount:10,category:'general',name:'Повтор'};
    const first=await mutate(db,users[0],h.id,'quick_expense',p,id);
    assert.deepEqual(await mutate(db,users[0],h.id,'quick_expense',p,id),first); m=first.month;
    assert.equal((await as(db,users[0],"SELECT * FROM entries WHERE name='Повтор'")).length,1);
    await assert.rejects(act('cover_overrun',{month_id:m.id,expected_revision:m.revision-1,id:e.id,source:'saved'}),/revision_conflict/);
  });
  await t.test('entry/backlog moves atomic, stale versions cannot delete or consume source',async()=>{
    let b=(await act('entry_to_backlog',{id:e.id,expected_revision:e.revision})).row;
    assert.equal((await as(db,users[0],'SELECT * FROM entries WHERE id=$1',[e.id])).length,0);
    b=(await act('update_backlog',{id:b.id,expected_revision:1,name:'В будущем'})).row;
    await assert.rejects(act('delete_backlog',{id:b.id,expected_revision:1}),/revision_conflict/);
    await assert.rejects(act('backlog_to_entry',{id:b.id,expected_revision:b.revision,month_id:m.id,expected_month_revision:1}),/revision_conflict/);
    assert.equal((await as(db,users[0],'SELECT * FROM backlog WHERE id=$1',[b.id])).length,1);
    const restored=(await act('backlog_to_entry',{id:b.id,expected_revision:b.revision,month_id:m.id,expected_month_revision:m.revision})).row;
    assert.equal(restored.actual,0); assert.equal(restored.type,'planned'); assert.equal(restored.name,'В будущем');
    assert.equal((await as(db,users[0],'SELECT * FROM backlog WHERE id=$1',[b.id])).length,0);
    await act('delete_entry',{id:restored.id,expected_revision:restored.revision});
    b=(await act('create_backlog',{category:'general',planned:2})).row;
    await act('delete_backlog',{id:b.id,expected_revision:b.revision});
  });
});

test('PostgreSQL: quick matching, source rollback, month deletion and onboarding retries',async t=>{
  const db=await fixture(); t.after(()=>db.close()); await db.exec(migration);
  const request=randomUUID();
  const h=await rpc(db,users[0],'budget_create_household',['Тест',request]);
  assert.deepEqual(await rpc(db,users[0],'budget_create_household',['Тест',request]),h);
  await assert.rejects(rpc(db,users[0],'budget_create_household',['Другое',request]),/request_mismatch/);
  let m=(await mutate(db,users[0],h.id,'create_month',{year:2026,month:12,half:1})).row;
  const act=async(op,p)=>{
    const result=await mutate(db,users[0],h.id,op,p);
    if(result.month)m=result.month;
    return result;
  };
  // Savings may exceed this period's income; deficit is an allowed state.
  m=(await act('update_month',{month_id:m.id,expected_revision:m.revision,income:100,saved:200})).row;
  const reserve=(await act('create_entry',{month_id:m.id,expected_revision:m.revision,type:'mandatory',category:'general',planned:50,is_reserve:true})).row;
  let e=(await act('create_entry',{month_id:m.id,expected_revision:m.revision,type:'planned',category:'general',name:' Кофе ',planned:10,actual:20})).row;
  e=(await act('quick_expense',{month_id:m.id,expected_revision:m.revision,source:'saved',amount:5,category:'general',name:'кофе'})).row;
  assert.equal(e.planned,25); assert.equal(e.actual,25); assert.equal(m.saved,195);
  assert.equal((await as(db,users[0],"SELECT * FROM entries WHERE type='planned'")).length,1);
  const before=await as(db,users[0],'SELECT * FROM entries ORDER BY id');
  const beforeMonth=await month(db,users[0],m.id);
  const retry=randomUUID(),invalid={month_id:m.id,expected_revision:m.revision,source:'reserve',amount:10,category:''};
  await assert.rejects(mutate(db,users[0],h.id,'quick_expense',invalid,retry),/check constraint/);
  assert.deepEqual(await as(db,users[0],'SELECT * FROM entries ORDER BY id'),before);
  assert.deepEqual(await month(db,users[0],m.id),beforeMonth);
  // A failed call leaves no durable request: the UUID remains available.
  const fixed={...invalid,category:'general',name:'Новая'};
  const fixedResult=await mutate(db,users[0],h.id,'quick_expense',fixed,retry); m=fixedResult.month;
  assert.equal(Number((await as(db,users[0],'SELECT actual FROM entries WHERE id=$1',[reserve.id]))[0].actual),10);
  e=(await act('update_entry',{id:e.id,expected_revision:e.revision,actual:500})).row;
  e=(await act('cover_overrun',{month_id:m.id,expected_revision:m.revision,id:e.id,source:'saved'})).row;
  assert.equal(e.planned,220); assert.equal(m.saved,0);
  await assert.rejects(act('delete_month',{month_id:m.id,expected_revision:1}),/revision_conflict/);
  const deletion=randomUUID(),payload={month_id:m.id,expected_revision:m.revision};
  const deleted=await mutate(db,users[0],h.id,'delete_month',payload,deletion);
  assert.equal(deleted.row.id,m.id); assert.equal(deleted.month,null);
  assert.equal((await as(db,users[0],'SELECT * FROM entries')).length,0);
  assert.deepEqual(await mutate(db,users[0],h.id,'delete_month',payload,deletion),deleted);
});

test('PostgreSQL: legacy preflight, fail-closed quarantine, explicit import, IDs/sums and rollback',async t=>{
  const db=await fixture(); t.after(()=>db.close()); await db.exec(read('tests/fixtures/budget-legacy.sql'));
  await assert.rejects(db.exec(migration),/legacy_preflight_required/);
  await db.exec('ALTER TABLE months ALTER COLUMN income TYPE double precision');
  await assert.rejects(db.exec(prepare),/legacy_incompatible_type/);
  await db.exec('ALTER TABLE months ALTER COLUMN income TYPE numeric USING income::numeric');
  await db.exec('ALTER TABLE months ADD COLUMN unexpected text');
  await assert.rejects(db.exec(prepare),/legacy_unknown_column/);
  await db.exec('ALTER TABLE months DROP COLUMN unexpected');
  // DDL, ACL and policies from prepare also roll back in the maintenance transaction.
  await db.exec('BEGIN'); await db.exec(prepare); await db.exec(migration); await db.exec(importer);
  await db.query('SELECT budget_private.import_legacy($1,$2)',[users[0],users[1]]);
  await db.exec('ROLLBACK');
  assert.equal(Number((await as(db,users[2],'SELECT income FROM months WHERE id=41'))[0].income),10000.25);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='auth_full_access'")).rows[0].n,3);
  assert.equal((await db.query("SELECT to_regnamespace('budget_legacy') AS n")).rows[0].n,null);
  await db.exec('BEGIN'); await db.exec(prepare); await db.exec(migration); await db.exec(importer); await db.exec('COMMIT');
  assert.equal((await as(db,users[0],'SELECT * FROM months')).length,0);
  await assert.rejects(as(db,users[0],'SELECT * FROM budget_legacy.months'),/permission denied/);
  await assert.rejects(as(db,users[0],'SELECT budget_private.import_legacy($1,$2)',[users[0],users[1]]),/permission denied/);
  await assert.rejects(db.query('SELECT budget_private.import_legacy(NULL,NULL)'),/explicit_valid_users_required/);
  assert.equal((await db.query('SELECT * FROM households')).rows.length,0);
  await db.exec('BEGIN');
  await db.query('SELECT budget_private.import_legacy($1,$2)',[users[0],users[1]]);
  await db.exec('ROLLBACK'); assert.equal((await as(db,users[0],'SELECT * FROM months')).length,0);
  const h=(await db.query('SELECT budget_private.import_legacy($1,$2) AS id',[users[0],users[1]])).rows[0].id;
  const m=await month(db,users[1],41); assert.equal(m.household_id,h); assert.equal(Number(m.income),10000.25); assert.equal(Number(m.saved),1000.25);
  const entries=await as(db,users[0],'SELECT * FROM entries ORDER BY id');
  assert.deepEqual(entries.map(x=>[Number(x.id),Number(x.planned),Number(x.actual),x.is_reserve]),[[51,500.5,20.25,true],[52,2000,2100,false]]);
  assert.equal(Number((await as(db,users[1],'SELECT * FROM backlog'))[0].planned),123.45);
  assert.equal((await as(db,users[2],'SELECT * FROM household_members')).length,0);
  assert.equal((await as(db,users[2],'SELECT * FROM months')).length,0);
  const renamed=await mutate(db,users[1],h,'update_entry',{id:51,expected_revision:1,name:'Подушка'}); assert.equal(renamed.row.is_reserve,true);
  const next=await mutate(db,users[0],h,'create_month',{year:2026,month:12,half:1}); assert.ok(next.row.id>41);
  await assert.rejects(db.query('SELECT budget_private.import_legacy($1,$2)',[users[0],users[1]]),/import_requires_empty_target/);
});
