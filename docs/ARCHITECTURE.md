# Архитектура Budget

Состояние по исходникам на 23.11.2026. Настройки боевой БД не проверялись.

## Два режима

| Режим | Вход | Хранилище | Сеть | Назначение |
|---|---|---|---|---|
| `/` | Email и пароль Supabase | Postgres через PostgREST/RPC | Нужна | Изолированные семьи, общий бюджет участников |
| `/free/` | Нет | IndexedDB браузера | Нужна для первой загрузки | Индивидуальный бюджет без аккаунта |

HTML и JavaScript ES modules запускаются непосредственно в браузере, сборки нет.
Единственная внешняя JS-библиотека в облачном режиме: supabase-js 2.58.0,
закреплена в CDN URL. У бесплатной версии внешних JS-зависимостей нет.
Корневая страница имеет PWA-манифест, но собственного service worker нет.
У `/free/` есть service worker с network-first кэшем оболочки.

## Карта кода

Для адресного поиска по задаче используйте [индекс исходников и тестов](INDEX.md).

| Файл | Ответственность |
|---|---|
| `shared/domain.mjs` | Чистые финансовые функции, периоды, категории, нормализация резерва |
| `shared/core.js` | Controller, локальное представление, явный view port и lifecycle callbacks |
| `shared/inline-bridge.mjs` | Единственное место записи обработчиков в window для inline HTML |
| `storage/supabase.mjs`, `storage/indexeddb.mjs` | Factories storage adapters с явными зависимостями |
| `shared/core.css` | Общие стили и мобильная адаптация |
| `index.html` | Облачная композиция модулей, SDK и refresh lifecycle |
| `ui/family.mjs` | Auth, onboarding, выбор семьи, настройки/приглашения, Realtime и защита контекста |
| `app.js`, `app.css` | Облачное представление, устанавливаемое через `installCloudView` |
| `ui/lilac.js`, `ui/base.css`, `ui/lilac.css` | Рабочий дизайн «Лаванда»: навигация, карточки, аналитика и формы поверх существующих обработчиков |
| `design/` | Четыре тестовых оформления и живой референс с отдельным хранилищем в памяти |
| `free/index.html` | Локальная композиция, категории, backup/restore UI, межвкладочные события |
| `free/sw.js` | Офлайн-кэш HTML, JS, CSS, манифеста и иконок |
| `supabase/migrations/001_households.sql` | Полная схема, RLS, membership/invite и транзакционные RPC |
| `supabase/legacy/prepare.sql`, `supabase/legacy/import.sql` | Admin-only preflight, карантин и явный перенос прежней семьи |
| `supabase_setup.sql` | Отключённый небезопасный legacy setup, всегда отказывает |
| `manifest.webmanifest`, `free/manifest.webmanifest` | Метаданные установки |

Локальные SQLite, Python-скрипты и личные документы исключены через `.gitignore`.
Они не являются runtime публичного приложения и не заменяют миграции Postgres.

`configureCore({storage,categories,reload,escape,refresh,logout,mode})` задаёт зависимости.
`app.js:installCloudView()` один раз устанавливает реализации view port через `setView`.
Controller вызывает port для отрисовки/обработки строк; одноимённых глобальных замен нет.
`installLilacView()` подключает hooks `summary`, `loaded`, `modal(active)` через
`configureViewHooks`, возвращает inline handlers. Загрузка вызывает `periodChanged` port.
UI-разметка остаётся в существующих файлах. Порядок и подписи категорий передаются
через `cats`; `default:true` отмечает категорию по умолчанию. Имена людей отсутствуют
в domain/adapters. Настройки и категории берутся только из выбранной семьи.
`registerInlineHandlers` публикует явные карты обработчиков один раз на точку входа;
`state`/`api` доступны также для безопасных браузерных проверок. Межмодульные вызовы
используют imports и callbacks. В `/free/` cloud/lilac не устанавливаются.

Общие UI-токены и правила для кнопок, числовых полей, карточек, диалогов,
фокуса и статуса записи находятся в `shared/core.css`. `.dialog-surface`
задаёт общий предел высоты и прокрутку диалогов. Облачные стили выбирают
значения токенов под «Лаванду» и задают компоновку экранов. Приёмка интерфейса
описана в [README](../README.md#приёмка-изменений-интерфейса).

## Контракт хранилища

Factories: `createSupabaseAdapter({client,onError,householdId,requestStore,uuid})`,
`createIndexedDBAdapter({indexedDB,uid,name,getCategories,defaultCategories,onChanged,onError,onVersionChange})`.
Ни одна не читает DOM, глобальные категории, ключи подключения или данные пользователя.

| Операция | Promise результата |
|---|---|
| `listMonths()`, `listBacklog()` | Массив строк |
| `getMonth(id)` | `{month,entries}` с нормализованным `is_reserve` |
| `createMonth(year,month,half,copyFromId)` | Новая строка либо `{error:'exists'}`; копия сбрасывает actual |
| `createEntry(row)`, `createBacklog(row)` | Созданная строка с id |
| `updateMonth/Entry/Backlog(id,patch)`, `deleteEntry/Backlog(id)` | Завершённая запись; payload результата UI не использует |
| `entryToBacklog(id)`, `backlogToEntry(id,monthId)` | Созданная строка назначения после удаления исходной |

ID строк: number в текущем облаке, string локально. Ошибка отклоняет Promise;
`onError` сообщает UI, но не поглощает rejection. IndexedDB разрешает Promise после
commit; переносы/copy/restore атомарны. Дополнительно локальный adapter предоставляет
`snapshot/restore`, `saveCategories/deleteCategory`, `getMeta/setMeta/delMeta` и `tx/openDB/close`.
Данные snapshot format 2 содержат категории, периоды, строки и бэклог.

Supabase отказывает без household context. `setContext({householdId,userId})`
увеличивает поколение и очищает cache строк; `setContext(null)` закрывает доступ.
Каждый SELECT фильтрует `household_id`; RLS независимо проверяет membership.
Все записи, включая copy/переносы/settings/quick/cover, идут через
`budget_mutate(household_id,request_id,operation,payload)`. Adapter хранит реальные
row/month revisions, передаёт ожидаемую версию и обновляет cache из `{row,month}`.
`capabilities.reserveColumn:true`; name fallback и direct DML отсутствуют.
У cloud quick/cover один RPC без клиентской компенсации и обязательный refetch
после успеха: изменённый резерв может отсутствовать в ответе.

UUID и исходный payload неопределённой сетевой попытки хранятся в sessionStorage
(`budget-request:*`, отдельно Auth-family actions `budget-action:*`), scoped по
пользователю/семье/намерению. Повтор того же действия после refetch/reload вкладки
использует прежние UUID и revision; SQL-отказ завершает попытку. Успех очищает только
собственный запрос текущего поколения; новое действие получает новый UUID.
После закрытия вкладки sessionStorage не даёт гарантий повторной отправки; серверный
журнал идемпотентности бессрочный. Изменённый ввод считается новым намерением.
`cloudErrorMessage` переводит ожидаемые SQL/Auth ошибки; fallback не раскрывает SQL,
endpoint или идентификаторы. Отсутствующая миграция даёт понятную ошибку настройки.

Один behavioral suite `tests/storage-contract.mjs` выполняется для production Supabase
adapter через настоящий PostgreSQL RPC в PGlite и для IndexedDB adapter в настоящем браузере.
Он проверяет CRUD, duplicate period, copy, сброс факта, резерв и переносы в обе стороны.
Отдельно проверяются rejection/RPC context и IndexedDB rollback/миграция/backup.
`tests/e2e/cloud-bootstrap.spec.cjs` выполняет native `/` с `cloud-fixture.cjs`:
изолированный SDK mock, canned RPC responses без симуляции SQL, Auth/onboarding,
invite/rename/settings, context/late callbacks, conflict drafts и atomic quick/cover.

Полный локальный и CI gate: `npm run check` (после `npm ci` и установки Chromium).
`playwright.config.cjs` запускает `tests/e2e/server.cjs` на loopback 8138;
`tests/e2e/fixtures.cjs` запрещает внешние HTTP-запросы и все WebSocket, проверяет необработанные
ошибки браузера. `tests/e2e/budget.spec.cjs` проверяет рабочие скрипты облачного
UI через in-memory адаптер `design/demo.js`; это не проверка Supabase-контракта.
Локальный сценарий обращается к настоящей IndexedDB, проверяет завершённые
транзакции, экспортирует JSON через UI и импортирует его в чистый контекст.
Основные UI-сценарии блокируют service worker. Отдельный `tests/e2e/offline.spec.cjs`
с `serviceWorkers:allow` проверяет смену старой оболочки с открытой вкладкой,
сохранность ввода и offline reload записи после кэширования всех ES modules.
Node.js 24.14.1 и Playwright 1.65.1 закреплены в `package.json`/lock и workflow.

`.github/workflows/pages.yml`: `checks` → `package` → `deploy`, а `deploy` также
явно зависит от `checks`. PR не публикуется. Artifact собирается allowlist-скриптом
`tests/package-pages.cjs`, без npm-пакетов, тестов и локальных личных файлов.
На 23.11.2026 удалённые Pages всё ещё имеют `build_type: legacy`, `master:/`:
полный запрет публикации без проверок требует ручного переключения Source
на GitHub Actions владельцем. Настройки и рабочий deploy этим изменением не менялись.

## Данные и расчёты

| Сущность | Основные поля |
|---|---|
| `months` | `id`, `year`, `month`, `half`, `income`, `saved` |
| `entries` | `id`, `month_id`, `type`, `category`, `name`, `planned`, `actual`, `is_reserve` (локально; облако после миграции) |
| `backlog` | `id`, `category`, `name`, `planned` |
| Локальная `meta` | Категории, время копии/изменений, предыдущий snapshot, файловый handle |

`mandatory`: обязательная сумма берётся из `planned`; `actual` в расчёте не участвует.
`planned`: план и факт расхода. Категория обозначает пользователя или группу трат.

```
Обязательные = сумма planned строк mandatory
Потрачено = сумма actual строк planned
Можно тратить = income − обязательные − saved
Остаток = можно тратить − потрачено
```

Облако (`app.js`, `calc`) сохраняет отдельные правила:
`allocated = sum(max(planned, actual))` для строк `planned`,
`spent = sum(actual)`, `free = life - allocated`. `life` вычитает накопления
и обязательные платежи; у строки резерва учитывается её неиспользованная часть.
В UI `allocated` называется «Выделено на траты», `allocated - spent` называется
«Осталось без перерасходов» и равен сумме `max(planned - actual, 0)`.
Таблица (`plannedTotals`) сохраняет `totPlan = sum(planned)` и
`totRem = sum(planned - actual)`, с учётом выбранного фильтра категории.
Перерасходы не переписывают пользовательский план автоматически.
Для исходного demo: `totPlan=46500`, `allocated=47100`, `spent=23150`,
`totRem=23350`, `allocated-spent=23950`; разница 600 вызвана транспортом
с планом 3500 и фактом 4100. Это разные показатели, а не ошибка округления.

Валюта в UI фиксирована: рубль. Деньги в JS хранятся как Number.
SQL-тип денежных полей в рабочем Postgres этим аудитом не подтверждён.
Начальный период `/free/`: half=1 для дней 10–24 включительно, half=2 для остальных;
месяц текущий. В облаке дни 1–9 относятся ко второй половине прошлого месяца. Навигация перебирает половины 1 → 2 → следующий месяц.
Это авторское правило, а не стандартное деление месяца на 1–15 и 16–конец.

### Явный резерв и совместимость

`isReserve` проверяет только `type==='mandatory' && is_reserve===true`.
`normalizeEntry` на границе legacy storage/backup выводит отсутствующий флаг из
старого названия «непредвид»; явное false имеет приоритет. Локальная миграция,
копирование и format 2 фиксируют флаг, поэтому переименование его не меняет.
Локальные формулы/UX не приобретают облачную механику резерва.
Облачная галочка «Резерв» использует `setReserve`/`reserveControl`; новый adapter
всегда требует явную колонку. Создание строки передаёт `is_reserve:false`, если
флаг не выбран. Quick/cover используют первый резерв по id, как SQL API.
Legacy-распознавание выполняется только один раз в admin import; runtime не угадывает
тип по имени. Боевой БД не касались.

## Сохранение и синхронизация

Пользовательские обработчики записи входят через `runSaveAction(action)`
в `shared/core.js`. Функция ждёт Promise всей операции, ловит отказ и обновляет
отдельный доступный `#save-status` (`role=status`, `aria-live=polite`).
`execConfirm` возвращает Promise callback; создание периода дожидается загрузки.
Составной `saveQuick` возвращает `false` при уже обработанном отказе, чтобы
не сообщать об успехе после компенсации. `sync-dot` остаётся для кратких сообщений.
Счётчик параллельных операций удерживает «Сохраняется» до их завершения;
ошибка сохраняется при позднем успешном ответе другой уже начатой операции.
Новая отдельная попытка может заменить ошибку. Искусственных задержек нет.
API сохраняет Promise/rejection: UI-обёртка не заменяет storage-контракт.
Транзакционность cloud обеспечивает RPC, локального режима — IndexedDB. Введённые значения
при отказе правки поля остаются доступными для повторной записи.

`installFamily` управляет Auth/email confirmation, выбором семьи и её категориями.
Без membership показывается create/join, при нескольких семьях — выбор. Owner может
менять имя/названия категорий и создавать одноразовую ссылку на сутки; member не видит
эти действия. Invite хранится в fragment, сразу удаляется из адреса и сохраняется
в sessionStorage до успешного join; вставленная ссылка разбирается как текст, без fetch
и перехода на её домен. Нет email-рассылки приглашений, удаления семей/участников.

Смена семьи/аккаунта/logout снимает канал, обнуляет controller/view/cache/modal/save
контекст и категории. Adapter и family проверяют поколение после await; запоздалые
ответы не применяются. Realtime подписывает только months/entries/backlog выбранной
семьи с `household_id=eq.<id>`, callback повторно проверяет поколение. Возврат во
вкладку и Realtime перечитывают данные только вне ввода и состояния ошибки записи.
При revision conflict ввод остаётся в форме. Явное обновление сохраняет только
изменённые поля, подставляя свежие данные в остальные; для удалённой строки остаётся
копируемый черновик. Повтор после обновления явный, с новой revision и новым UUID.
Черновики в памяти/DOM очищаются при смене контекста; reload их не сохраняет.

Локальная версия использует IndexedDB `budget-free`, версия схемы 2. При upgrade v1→v2
каждая строка получает boolean `is_reserve`, исходные записи сохраняются. Период
уникален по `[year, month, half]`. Переносы, копирование, удаление категории
с переносом её записей и restore выполняются транзакционно. BroadcastChannel
сообщает другим вкладкам о необходимости перечитать данные.

## Копии и офлайн

JSON-копия содержит `app: budget`, `format: 2`, `exportedAt`, категории и три
массива данных. `normalizeBackup` проверяет уникальность ID внутри коллекций,
целые периоды, типы строк, структуру массивов, конечные числовые суммы и ссылки
строк на периоды. Импорт файла ограничен 10 МБ. Читаются format 1/2 и старые копии без format;
небулевый `is_reserve` отклоняется. Новые копии могут не читаться старым приложением.
Restore заменяет текущие данные, сохраняя предыдущее состояние в той же IndexedDB.
Этот snapshot не переживёт очистку данных сайта.

Есть ручное скачивание/Share API и автоматическая запись в выбранный файл через
File System Access API при наличии поддержки и разрешения. Автозапись отложена
на 1,5 секунды; это не гарантия сохранения при внезапном завершении браузера.
Файл JSON не зашифрован. Передавать его следует как личные финансовые данные.

Ручной экспорт записывает время подготовки в `meta.lastExportAt`; подтверждение
пользователем внешнего сохранения обновляет `lastBackupAt` по времени snapshot.
Автозапись обновляет этот статус только после успешного закрытия файла.
Записи в файл сериализованы; ошибка показывается в настройках и баннере.
Настройки содержат версию 0.1.0 beta, справку и публичный канал GitHub Issues.
Первый запуск справки управляется локальным ключом `guideSeen`.

Общие модальные окна используют `inert`, удержание фокуса и возврат к инициатору.
Tab перемещает по полям и кнопкам, строки создаются отдельной кнопкой.
На мобильной ширине планируемые траты отображаются в два ряда с подписями сумм.

`persist()` запрашивает защиту от автоматического вытеснения, но не гарантирует
её получение и не защищает от ручной очистки или удаления профиля браузера.
Данные зависят от origin: смена домена требует переноса через backup/restore.

## Сопровождение

Обязательное обновление документации вместе с фичами и критерии готовности
закреплены в [AGENTS.md](../AGENTS.md). Маршруты поиска поддерживаются
в [индексе проекта](INDEX.md).

1. Проверять изменения `shared/` в обоих режимах.
2. Для облачных изменений использовать отдельную тестовую БД и тестовые аккаунты.
3. Изменения IndexedDB сопровождать повышением версии и миграцией, не очисткой данных.
4. Изменения JSON-формата сопровождать правилами чтения старых копий.
5. Проверять обновление service worker с открытой старой вкладкой и офлайн-запуск.
6. Не публиковать `.env`, локальные БД и личные документы.

Вход для владельца: [локальный запуск](../README.md#локальный-запуск),
[проверки](../README.md#проверки), [выпуск](../README.md#развёртывание) и
[восстановление](../README.md#восстановление). Открытые проверки выпуска ведутся
в [RELEASE_REVIEW.md](RELEASE_REVIEW.md).

## Облачная схема и RPC, этап 4а

`supabase/migrations/001_households.sql` применяется администратором один раз в
транзакции на пустую схему public с готовыми Supabase Auth `auth.users/auth.uid()`
и ролями `anon/authenticated`. Если бюджетные таблицы уже есть, она отказывает:
`legacy_preflight_required`. Боевой Postgres и его текущие типы не исследовались.
Миграция не запускается приложением. Runtime `/` подключён к этому контракту на этапе
4б; схема и frontend должны переходить вместе в окно обслуживания после staging.

`households(id uuid,name,settings jsonb,revision bigint)` хранит настройки семьи.
По умолчанию категория одна: `general/Общие`, без имён людей. `settings.categories`
имеет клиентский формат `{id,name,color,default?}`; owner меняет целый JSON.
`household_members(household_id,user_id,role)` допускает owner/member и участие
аккаунта в нескольких семьях. Один общий бюджет мужа и жены использует два UUID
Auth и один household_id. Текущую семью выбирает frontend, а не база.

`months/entries/backlog` сохраняют bigint ID и прежние поля, получают обязательные
`household_id uuid` и `revision bigint`, начиная с 1. Период уникален по
`(household_id,year,month,half)`. Составной FK `(household_id,month_id)` не позволяет
привязать entry к чужому месяцу. Деньги: точный `numeric`, неотрицательные значения
до 10^12 рублей включительно, не более двух десятичных знаков; избыточная точность
отклоняется, не округляется. `transferred` может быть null. Возвраты/отрицательные
суммы не поддерживаются. Существующее правило дефицита из свободных сохранено.
`entries.is_reserve` обязателен; true допустим только для mandatory. Переименование
не меняет флаг. Backlog не содержит факта и типа резерва, возврат всегда planned.

RLS разрешает SELECT только участникам своей семьи, включая список её участников;
`budget_is_member(uuid)` возвращает только boolean членства текущего Auth UUID,
Security Definer устраняет рекурсию membership policy. Прямые INSERT/UPDATE/DELETE,
доступ к sequence, invites и журналу запросов клиентским ролям запрещены. Все записи
через RPC. Все definer-функции имеют fixed search_path и закрытый PUBLIC EXECUTE.
`anon` не может читать таблицы или вызывать endpoint. Данные старой семьи до явного
переноса не присваиваются никому. Legacy `auth_full_access` удаляется при карантине.

### Облачные RPC

PostgREST argument names ниже точные, snake_case. JSON возвращается значением RPC,
не массивом. Не добавлять household_id к endpoint, где его нет в signature.

| Signature | Результат |
|---|---|
| `budget_create_household(name text,request_id uuid)` | Строка household; создаёт owner, повтор того же UUID/name возвращает исходный результат |
| `budget_list_households()` | Массив household с собственной `role`, только текущий пользователь |
| `budget_household_details(household_id uuid)` | Household с `settings` и `members:[{household_id,user_id,role}]`, без email и токенов |
| `budget_create_invite(household_id uuid,request_id uuid,ttl_seconds integer=86400)` | `{token,expires_at}`, только owner; TTL 60–604800 секунд |
| `budget_join_household(token text)` | `{household_id}`, только вошедший пользователь; одноразовый token, retry тем же пользователем возвращает успех |
| `budget_mutate(household_id uuid,request_id uuid,operation text,payload jsonb)` | `{row,month}`: созданная/изменённая/удалённая строка и актуальный месяц либо null |

Invite token состоит из двух случайных UUID без разделителей (64 hex-символа).
В таблице invites хранится SHA-256, исходный token доступен только owner в ответе
и закрытом журнале его idempotency. UI строит ссылку из token, не отправляет email;
token передавать как секрет, предпочтительно fragment URL, убрать из адреса после
чтения и не логировать. Невалидный, истёкший или использованный другим аккаунтом
token возвращает одинаковый `invalid_invite`. Email нового участника функция не знает.

Все `budget_mutate` принимают UUID запроса, созданный один раз на действие.
Повтор после network timeout использует тот же UUID, operation и исходный payload:
возвращается прежний JSON без повторной записи. Другой payload/operation с тем же
ключом отклоняется `request_mismatch`. Область ключа: семья + текущий пользователь.
Членство проверяется заново перед выдачей сохранённого результата. Журнал не имеет
автоматического TTL: удаление ключей сняло бы бессрочную гарантию дедупликации.
Новая попытка после исправления данных/конфликта использует новый UUID.

Каждая mutation блокирует строку household, затем нужные месяцы/строки: финансовые
операции одной семьи сериализованы. Каждое изменение entries увеличивает также
`month.revision`, делая его версией агрегата для покрытий/расходов/copy. В ответе
`row` это строка назначения; после переноса исходная удалена. Для quick/cover refetch
месяца обязателен: RPC может также изменить резерв, его row в ответ не включён.
Для `delete_month` row содержит удалённый месяц, month=null; entries удаляются
с ним по FK, повтор UUID возвращает тот же результат. Backlog семьи не меняется.

| operation | payload |
|---|---|
| `create_month` | `year,month,half,copy_from_id?`; при копировании `expected_revision` исходного месяца; income/saved=0, actual=0, план и is_reserve копируются |
| `update_month` | `month_id,expected_revision`, изменяемые `income?,saved?,transferred?` |
| `delete_month` | `month_id,expected_revision` месяца; удаляет месяц вместе с entries |
| `create_entry` | `month_id,expected_revision` месяца, `type,category,name?,planned?,actual?,is_reserve?` |
| `update_entry` | `id,expected_revision` entry, изменяемые `type?,category?,name?,planned?,actual?,is_reserve?`; `month_id` запрещён |
| `delete_entry` / `entry_to_backlog` | `id,expected_revision` entry; перенос сохраняет category/name/planned, факт удаляется с исходной строкой |
| `create_backlog` | `category,name?,planned?` |
| `update_backlog` | `id,expected_revision` backlog, изменяемые `category?,name?,planned?` |
| `delete_backlog` | `id,expected_revision` backlog |
| `backlog_to_entry` | `id,expected_revision` backlog, `month_id,expected_month_revision` назначения |
| `quick_expense` | `month_id,expected_revision` месяца, `source:'free'/'saved'/'reserve',amount>0`; существующая planned-строка `id` либо `category,name?` новой |
| `cover_overrun` | `month_id,expected_revision` месяца, `id` planned-строки, `source:'saved'/'reserve'` |
| `update_settings` | `expected_revision` household, `name?,settings?`; только owner |

Если quick не получил id, сервер ищет planned-строку той же category и имени
(trim + lower); при нескольких совпадениях берёт первую по id. Это выполняется
внутри блокировки семьи. Quick увеличивает actual на amount, planned становится max(planned,actual)+amount;
у новой строки оба равны amount. Saved уменьшается, у первого по id резерва
увеличивается actual. Saved/reserve обязаны покрывать всю сумму quick; free разрешает
дефицит. Cover берёт min(actual-planned, доступный источник), увеличивает planned;
частичное покрытие разрешено. Проверка сумм/членства/источника выполняется сервером;
ошибка любого шага откатывает весь вызов вместе с source debit и журналом запроса.

Ошибки Supabase: `error.message` содержит `not_member/owner_required` (SQLSTATE 42501),
`revision_conflict` (40001), `request_required/request_mismatch`, `not_found`,
`forbidden_field`, `invalid_payload/invalid_amount/invalid_source`,
`insufficient_funds`, `invalid_ttl`, `invalid_invite`, `unknown_operation` (P0001).
`unknown_operation` возвращается при существующем month_id и актуальной revision;
общие проверки доступа/месяца/версии могут отклонить запрос раньше. Ограничения данных:
23514 check, 23502 required field, 23503 FK, 23505 duplicate period. Невалидные SQL
типы могут дать 22xxx. При конфликте refetch и явный повтор, без тихой перезаписи.
Прямой DML/anon дают 42501. Идентификаторы семьи/пользователя/role/revision в payload
запрещены, значения задаёт сервер. Разделение family A/B не зависит от UI-фильтра.

### Миграция старой семьи

Не выполнять на production без отдельного подтверждения и staging-прогона.
Production schema неизвестна; `prepare.sql` принимает только подтверждённую fixture:
id/month_id integer или bigint, year/month/half integer/bigint, деньги numeric,
name/category/type text/varchar. Набор колонок строгий, transferred опционален.
Неизвестные колонки/типы или отсутствующие таблицы дают `legacy_*` и отказывают.
Даты создания, UUID ID, float/money суммы, уже добавленный is_reserve требуют отдельной
проверенной миграции, не автоматического преобразования. Ограничения новой схемы
дополнительно отклонят дубли периодов, orphan FK и несовместимые суммы.

1. Остановить клиентов/записи. Сделать внешний SQL dump всей БД (schema/data/roles),
   включая auth, ACL и publication; проверить восстановление в отдельном проекте.
   JSON frontend не заменяет backup БД. Сохранить суммы/count/ID по всем таблицам.
2. Подтвердить через Authentication два разных UUID владельца и супруги. Не выбирать
   первого auth.users, не включать автоматически остальные аккаунты. Второй UUID
   можно передать NULL и пригласить партнёра позже.
3. В SQL Editor отдельного staging начать `BEGIN`, выполнить `supabase/legacy/prepare.sql`,
   затем `supabase/migrations/001_households.sql` и `supabase/legacy/import.sql`.
   Prepare удаляет все старые policies, grants/publication для трёх таблиц и перемещает
   их в закрытую `budget_legacy`. Без явного import все данные остаются fail-closed.
4. Выполнить `SELECT budget_private.import_legacy('OWNER_UUID'::uuid,'PARTNER_UUID'::uuid)`.
   Только administrator, функция invoker без PUBLIC/client EXECUTE. Target должен быть
   пустым. Import сохраняет ID и суммы без округления (legacy null в income/saved/
   planned/actual нормализуется в 0), восстанавливает sequences, переносит категории
   из данных; старое mandatory-название с «непредвид» один раз становится is_reserve.
5. До COMMIT сверить ID/count/суммы/резерв и доступ двумя аккаунтами своей семьи и
   посторонним аккаунтом в staging. Ошибка либо сомнение: `ROLLBACK`, старые таблицы,
   политики/ACL и publication возвращаются транзакционно. После проверки `COMMIT`.
6. Проверить frontend 4б, Auth и Realtime на staging; только затем согласовывать
   production переход. После COMMIT откат через проверенное внешнее восстановление
   в изолированный проект и переключение frontend. Не возвращать broad legacy RLS в
   публичном проекте; если появились новые записи, сначала сохранить их отдельно.

Карантин не удалять до подтверждённого восстановления backup. Двойной запуск import
отказывает; произвольное добавление ещё одного household не считается миграцией семьи.

### Исполняемые SQL-проверки

`tests/database.test.cjs` исполняет исходные SQL в PostgreSQL WASM PGlite 0.6.0
([официальный API](https://pglite.dev/docs/)). Fixture создаёт роли и `auth.uid()`
из JWT claims. Все access assertions выполняются после настоящего SET ROLE
authenticated/anon и проверяют current_user, не под superuser. Administrator нужен
только для установки, fixture, истечения invite, отзыва membership и проверки FK.
Проверяются fresh/legacy, две семьи/общий доступ, spoof IDs/role/FK, anon, invites,
атомарный rollback (включая DDL/policies/ACL карантина), copy/переносы/удаление месяца,
источники, совпадение quick по имени, saved>income, retry и stale revisions.
`node --test tests/database.test.cjs`; включено в `node --test tests/*.test.cjs`
и `npm run check`. PGlite однопоточный: конкурентные PostgreSQL connections,
Supabase Auth/JWT validation/PostgREST и Realtime этим не доказаны, необходим staging.
