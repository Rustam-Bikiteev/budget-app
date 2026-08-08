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
-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Живая синхронизация между устройствами: изменения прилетают всем открытым
-- вкладкам без перезагрузки.
--
-- REPLICA IDENTITY FULL нужен, чтобы в событии DELETE приходила вся удалённая
-- строка, а не только её id — иначе клиент не поймёт, к какому периоду она
-- относилась. Таблицы крошечные, накладные расходы неощутимы.

alter table public.months  replica identity full;
alter table public.entries replica identity full;
alter table public.backlog replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['months', 'entries', 'backlog'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── проверка ─────────────────────────────────────────────────────────────────
-- rowsecurity должен быть true у всех трёх
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('months', 'entries', 'backlog');

-- все три должны попасть в публикацию realtime
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
