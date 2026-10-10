-- Budget: колонка для отметки «перевёл Насте» в периоде.
-- Только добавляет колонку, существующие строки и данные не меняются.
-- Выполнить один раз в Supabase → SQL Editor → New query → Run.
-- Повторный запуск безопасен (if not exists).

alter table public.months add column if not exists transferred numeric;

-- проверка: колонка есть, у всех периодов пока null
select id, year, month, half, income, saved, transferred
from public.months
order by year desc, month desc, half desc
limit 5;
