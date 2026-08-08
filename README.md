# Бюджет

Статичное веб-приложение для учёта бюджета по полумесяцам.
Хостится на GitHub Pages, данные — в Supabase (Postgres + Auth).

Сервера нет: `index.html` ходит в Supabase напрямую через PostgREST.

## Стек

- vanilla JS, без сборки и зависимостей
- [supabase-js](https://github.com/supabase/supabase-js) с CDN
- Supabase Auth (email + пароль), доступ режет RLS
- PWA: ставится на домашний экран телефона

## Файлы

```
index.html             — всё приложение (разметка, стили, логика)
manifest.webmanifest   — PWA-манифест
icon-192.png / icon-512.png
supabase_setup.sql     — включение RLS и политик (выполнить один раз)
```

## Схема данных

| Таблица   | Назначение |
|-----------|------------|
| `months`  | период (year / month / half), `income`, `saved` |
| `entries` | строки периода: `type` = `mandatory` / `planned`, `category` = `me` / `nastya` / `shared` |
| `backlog` | отложенные траты вне периода |

## Развёртывание

1. Выполнить `supabase_setup.sql` в Supabase → SQL Editor
2. Завести пользователя в Authentication → Users
3. Settings → Pages → Source: `master`, папка `/ (root)`

Anon-ключ в `index.html` публичен по замыслу — доступ к данным
определяется исключительно RLS-политиками.
