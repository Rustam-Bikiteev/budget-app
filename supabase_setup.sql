-- Budget: включение RLS и политик доступа.
-- Выполнить один раз в Supabase → SQL Editor → New query → Run.
--
-- После этого:
--   anon (не залогинен)  → доступа нет вообще
--   authenticated        → полный доступ ко всем трём таблицам
--
-- Anon-ключ лежит в открытом index.html — это нормально, он безопасен
-- ровно потому, что ниже включён RLS.

-- ── months ───────────────────────────────────────────────────────────────────
alter table public.months enable row level security;
drop policy if exists "auth_full_access" on public.months;
create policy "auth_full_access" on public.months
  for all to authenticated using (true) with check (true);

-- ── entries ──────────────────────────────────────────────────────────────────
alter table public.entries enable row level security;
drop policy if exists "auth_full_access" on public.entries;
create policy "auth_full_access" on public.entries
  for all to authenticated using (true) with check (true);

-- ── backlog ──────────────────────────────────────────────────────────────────
alter table public.backlog enable row level security;
drop policy if exists "auth_full_access" on public.backlog;
create policy "auth_full_access" on public.backlog
  for all to authenticated using (true) with check (true);

-- ── проверка ─────────────────────────────────────────────────────────────────
-- rowsecurity должен быть true у всех трёх
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('months', 'entries', 'backlog');
