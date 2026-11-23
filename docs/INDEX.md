# Budget: agent index

## Поиск

- Маршрут → режим → файл → символ → тело + зависимости. Пути от корня.
- `rg -n 'symbol' file`; CSS: класс/ID из DOM → соответствующий CSS.
- Нет совпадения: файл → каталог → репозиторий; исправить маршрут.
- Full scan: общий аудит или исчерпан адресный поиск. Большой HTML читать фрагментами.
- Обновлять в том же diff: пути, символы, ответственность, тесты, цепочки загрузки.
- Хранить точки входа; детали поведения → профильный документ. Без номеров строк.

## Режимы и композиция

| Режим | Точка композиции ES modules | Хранилище |
|---|---|---|
| `/` | inline module `index.html`: `configureCore` → `installCloudView` → `installLilacView` → `installFamily` → bridge | `storage/supabase.mjs` |
| `/free/` | inline module `free/index.html`: `configureCore` → bridge | `storage/indexeddb.mjs` |
| `/design/` | `design/preview.js` → import `design/demo.js`, та же cloud/view композиция; `?theme=lilac` берёт стили из `index.html` | память |

Нет общих глобальных объявлений: imports/exports + `setView`, `configureViewHooks`.
`shared/inline-bridge.mjs:registerInlineHandlers` один раз публикует карты обработчиков
для старых inline onclick. Внутренние save/load/modal/calendar counters не публикуются.
Чистые формулы/периоды → `shared/domain.mjs`; различия local/cloud намеренные.

## Маршруты

| Задача / keywords | Файлы | Символы |
|---|---|---|
| Период, спринт, календарь, копия плана | `shared/domain.mjs`, `shared/core.js`, `app.js`; storage adapter | `initialPeriod`, `shiftPeriod`, `periodDaysLeft`, `shiftMonth`, `loadCurrentMonth`, `createCurrentMonth`, `findPrev`, `pickPeriod`, `periodRange` |
| Доход, накопления, баланс, формулы | `shared/domain.mjs`, `shared/core.js`, `app.js` | `localSummary`, `cloudSummary`, `plannedTotalsFor`, `saveMonthFields`, `renderSummary`, `calc` |
| Статус записи, ошибки, конкурентные операции | `shared/core.js`; HTML handlers обоих режимов, `app.js` | `runSaveAction`, `renderSaveStatus`, `execConfirm`, `saveQuick`; `#save-status` |
| Графики, проценты, аналитика | `app.js`, `ui/lilac.js` | `renderBudgetChart`, `chartShare`, `lilacRender`, `lilacRenderBars` |
| Траты, план/факт, CRUD и ширина сумм | `shared/core.js`, `app.js`, `ui/lilac.css` | `renderPlanned`, `saveEntry`, `addEntry`, `deleteEntry`, `patchPlannedRow`; `.r-plan`, `field-sizing` |
| Платежи, оплачено, резерв | `shared/domain.mjs`, `app.js`, `shared/core.js`; `storage/` | `normalizeEntry`, `isReserve`, `isPaid`, `reserveControl`, `setReserve`, `setPaid` |
| Расход вне плана, источники, перерасход | `app.js`, `index.html` | `openQuick`, `saveQuick`, `quickSources`, `openCover`, `coverFrom` |
| Суммы, клавиатура, калькулятор | `app.js`, `ui/lilac.js`, `index.html` | `parseSum`, `openPad`, `renderPad`, `padKey`, `padDone` |
| Бэклог, перенос | `shared/core.js`, `app.js`; `api` режима | `entryToBacklog`, `moveBacklogEntry`, `renderBacklog`, `saveBacklogEntry`, `backlogToEntry` (API) |
| Supabase CRUD/revisions/retry | `storage/supabase.mjs` | `createSupabaseAdapter`, `atomic`, `setContext`, `revision`, `read`, `cloudErrorMessage` |
| Auth, семьи, onboarding, приглашения, настройки, Realtime | `ui/family.mjs`; `index.html` inline module | `installFamily`, `showSession`, `login`, `logout`, `list`, `select`, `renderAccount`, `captureDraft`, `restoreDraft`; `doLogin`, `doSignup`, `doLogout` |
| Смена семьи/аккаунта, поздние ответы, сброс UI | `ui/family.mjs`, `storage/supabase.mjs`, `shared/core.js`, `app.js` | `clear`, `setContext`, `check`, `resetContext`, `contextToken`, `resetCloudContext` |
| Обновление, pull refresh | `index.html`, `app.js` | `refreshData`, `initPullToRefresh` |
| IndexedDB, схема, транзакции, вкладки | `storage/indexeddb.mjs`; `free/index.html` inline module | `createIndexedDBAdapter`, `DB_VERSION`, `openDB`, `tx`, `write`; `bc`, `init` |
| Backup, JSON, импорт, автокопия | `storage/indexeddb.mjs`; `free/index.html` inline module | `snapshot`, `restore`, `exportBackup`, `normalizeBackup`, `onImportFile`, `undoImport`, `writeBackupFile`, `markBackedUp` |
| Категории, настройки, справка | `/`: `ui/family.mjs:renderAccount`; `/free/`: `free/index.html` inline module; `shared/domain.mjs` | `sortCategories`, `renderSettings`, `showGuide`, `renderCatEditor`, `commitCats`, `removeCat` |
| Экраны, навигация, «Лаванда» | `ui/lilac.js`, `ui/lilac.css`, `ui/base.css`, `app.css`, `index.html` | `lilacRoute`, `lilacRender`, `lilacTheme`; CSS по DOM |
| Композиция / inline bridge | `shared/core.js`, `app.js`, `ui/lilac.js`, `shared/inline-bridge.mjs`; точки входа | `configureCore`, `setView`, `configureViewHooks`, `inlineHandlers`, `cloudInlineHandlers`, `registerInlineHandlers` |
| Диалоги, фокус, подтверждение | `shared/core.js`, `ui/lilac.js`; HTML режима | `openModal`, `closeModal`, `updateModalBackground`, `openConfirm`, `execConfirm` |
| Общие UI-примитивы, токены, касания | `shared/core.css`, `ui/base.css`, `ui/lilac.css`; HTML режима | `.dialog-surface`, `--tap-size`, `--focus-color`, `--text-body`, `#save-status` |
| Бесплатный UI, mobile | `shared/core.css`, `free/index.html` | `.free-app`; CSS по DOM |
| PWA, офлайн, кэш | `free/sw.js`, `manifest.webmanifest`, `free/manifest.webmanifest`, `free/index.html` | `CACHE`, `SHELL`, `install`, `activate`, `fetch` |
| SQL, семьи, RLS, RPC, приглашения | `supabase/migrations/001_households.sql` | `budget_is_member`, `budget_create_household`, `budget_list_households`, `budget_household_details`, `budget_create_invite`, `budget_join_household`, `budget_mutate`; `households`, `household_members`, `revision` |
| SQL legacy migration / backup / rollback | `supabase/legacy/prepare.sql`, `supabase/legacy/import.sql`; `docs/ARCHITECTURE.md` | `import_legacy`, `budget_legacy`, preflight, `legacy_unsupported_real_amount`; `supabase_setup.sql` отключён; `supabase_add_transferred.sql` только историческая одиночная колонка |
| Демо, темы, референс | `design/preview.js`, `design/demo.js`, `design/themes.css`, `design/reference.html` | [design/README.md](../design/README.md) |
| Проверки, CI, выпуск Pages | `package.json`, `package-lock.json`, `playwright.config.cjs`, `.github/workflows/pages.yml`, `tests/package-pages.cjs` | `check`, `checks`, `package`, `deploy`; artifact `_site/` |
| Локальный запуск без Supabase | `tests/e2e/server.cjs`, `design/preview.html`, `design/demo.js`, `free/index.html` | loopback `127.0.0.1:8138`; preview в памяти, `/free/` в изолированной по origin IndexedDB |

## Тесты

Полный набор: `node --test tests/*.test.cjs`. Один: `node --test tests/quick-expense.test.cjs`.
Полный gate: `npm ci` → `npx playwright install chromium` → `npm run check`.
Node.js 24.14.1; Playwright 1.65.1; test-only PostgreSQL WASM PGlite 0.6.0.
Быстрые тесты ниже: Node + VM + заглушки; database.test.cjs исполняет настоящий SQL.
`tests/runtime-source.cjs` снимает module syntax для прежних VM fixtures; native imports
и реальные связи дополнительно выполняются браузерными тестами.
Пути тестов: `tests/<имя>`.

| Область | Имя | Исполняемый код |
|---|---|---|
| Чистый domain / периоды / резерв / категории | `domain.test.cjs` | `shared/domain.mjs` |
| Storage contract через PostgreSQL RPC, filters/revisions/retry/context, atomic quick/cover, безопасные ошибки | `storage.test.cjs` | `storage/supabase.mjs`, `storage-contract.mjs`, `supabase-fixture.cjs`, PGlite и auth/SQL fixtures |
| PostgreSQL fresh/legacy, RLS семей, RPC, invite, revision/idempotency/rollback, quick matching/delete_month, сохранение чужих sequence ACL | `database.test.cjs`, `fixtures/budget-auth.sql`, `fixtures/budget-legacy.sql` | `supabase/migrations/001_households.sql`, `supabase/legacy/prepare.sql`, `supabase/legacy/import.sql`; настоящий SET ROLE, JWT claims fixture |
| Backup validation | `backup.test.cjs` | `normalizeBackup` в `free/index.html` |
| Export / autosave | `file-backup.test.cjs` | `free/index.html` |
| Доход / накопления | `save-month-fields.test.cjs` | `shared/core.js` |
| Статус записи / параллельные отказы / смена контекста | `save-status.test.cjs` | `shared/core.js`: `runSaveAction`, `renderSaveStatus`, `resetContext` |
| Навигация во время CRUD | `entry-navigation.test.cjs` | `shared/core.js` только |
| Расход / источники | `quick-expense.test.cjs` | `shared/core.js` + `app.js` |
| Сводка / графики / прогресс | `budget-summary.test.cjs` | `shared/core.js` + `app.js` |
| Pull refresh | `pull-refresh.test.cjs` | `shared/core.js` + `app.js` |
| SW lifecycle / cache | `service-worker.test.cjs` | `free/sw.js` |

Браузерные тесты: `npm run test:e2e` → `tests/e2e/budget.spec.cjs`:
- Cloud preview: создание периода, расход/правка суммы, покрытие, бэклог туда/обратно;
  `shared/core.js` + `app.js` + `ui/lilac.js`, `design/demo.js` в памяти.
- `/free/`: настоящая IndexedDB, reload, JSON download/import в чистое хранилище.
- UX: demo-план/выделено/остатки, раскрытие дохода, подписи навигации, три шага
  первого запуска; pending/reject/retry inline handlers обоих режимов, screenshots
  desktop и mobile (320/390 px) в `test-results/`. Общие компоненты: фокус,
  числовой ввод, размеры кнопок, диалоги, состояния записи и отсутствие
  горизонтальной прокрутки.
- `tests/e2e/cloud-bootstrap.spec.cjs` + `tests/e2e/cloud-fixture.cjs`: native `/`
  bootstrap, Auth/signup/confirmation/errors, create/join/invite/retry, выбор семей,
  owner/member/settings/categories, явный reserve, conflict drafts/refresh,
  atomic quick/cover, filters/revisions, context/late responses/Realtime callbacks;
  SDK mock с canned responses, без SQL-симулятора и внешних запросов; desktop/mobile screenshots.
- `tests/e2e/storage.spec.cjs`: общий `tests/storage-contract.mjs` на настоящей IndexedDB,
  rollback, миграция v1→v2, rename/reopen/backup/restore резерва; явный cloud control.
- `tests/e2e/offline.spec.cjs`: SW разрешён, upgrade старой оболочки при открытой вкладке,
  сохранность ввода, offline reload; fixture `tests/e2e/legacy-free-sw.js`.
- Fixture `tests/e2e/fixtures.cjs`: `guardContext`, `openFree`, изолированные контексты,
  запрет внешнего HTTP и всех WebSocket;
  сервер `tests/e2e/server.cjs`: localhost 8138, MIME `.js/.mjs`; SW заблокирован в основных UI-тестах.

Пробелы: production Supabase/Auth/PostgREST/Realtime, конкурентные PostgreSQL connections,
телефоны, офлайн/установка на телефонах. RLS проверяется локально в PostgreSQL PGlite.
`tests/sw-fixture-server.cjs`: сервер для ручной проверки SW, не автотест.

## Документы: источник фактов

| Назначение | Документ |
|---|---|
| Обязательства / готовность | [AGENTS.md](../AGENTS.md) |
| Карта владельца / запуск / проверка / выпуск / восстановление | [README.md](../README.md) |
| Архитектура / формулы / storage / ограничения | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Дизайн / demo | [design/README.md](../design/README.md) |
| Ревью выпуска / план | [RELEASE_REVIEW.md](RELEASE_REVIEW.md) |
| Пилот / устройства | [FREE_PILOT.md](FREE_PILOT.md) |

Аудиты с датой: история. Статус finding проверять по текущему коду.
