# Архітектура Vortex

Цей документ описує структуру monorepo, межі процесів Electron, основні підсистеми та правила
розміщення нового коду. Він є навігаційною картою, а не повною документацією кожного модуля.

Актуальний Linux-напрям і порядок майбутніх робіт описані в
[`LINUX-ROADMAP.md`](./LINUX-ROADMAP.md).

## Загальна модель

Vortex — Electron-застосунок із розширюваною архітектурою. Ядро запускає application lifecycle,
вікна, IPC і системні операції; renderer відповідає за UI, Redux state та більшість вбудованих
функцій; bundled extensions і game extensions додають поведінку через реєстраційний API.

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│ startup · windows · filesystem · downloads · native code    │
└──────────────────────────┬───────────────────────────────────┘
                           │ typed IPC
┌──────────────────────────▼───────────────────────────────────┐
│ Preload bridge                                              │
│ мінімальний безпечний API між Electron і renderer           │
└──────────────────────────┬───────────────────────────────────┘
                           │ exposed API
┌──────────────────────────▼───────────────────────────────────┐
│ Renderer                                                    │
│ React UI · Redux · orchestration · built-in extensions      │
└───────────────┬──────────────────────────────┬───────────────┘
                │ extension API                │ shared APIs
┌───────────────▼──────────────────┐  ┌────────▼───────────────┐
│ Feature and game extensions     │  │ Shared/packages        │
│ installers · games · stores     │  │ contracts · utilities  │
└──────────────────────────────────┘  └────────────────────────┘
```

Основне правило залежностей: renderer не повинен напряму покладатися на внутрішні деталі main
process. Міжпроцесна функція проходить через shared contract та preload/IPC. Загальновживаний
контракт розширень належить `packages/vortex-api`, а не конкретному extension.

## Карта репозиторію

```text
Vortex/
├── src/
│   ├── main/             Electron main process і packaging
│   ├── preload/          безпечний міст main ↔ renderer
│   ├── renderer/         React UI, state та вбудовані extensions
│   ├── shared/           міжпроцесні типи, API та спільні utilities
│   ├── queries/          database/query setup
│   └── stylesheets/      глобальні Sass/Tailwind стилі
├── extensions/
│   ├── games/            окремі game extensions
│   └── */                bundled feature/store/mod-type extensions
├── packages/             повторно використовувані workspace packages
├── assets/               статичні ресурси застосунку
├── locales/              переклади
├── docs/                 тематична документація
├── flatpak/              Flatpak manifest, scripts та metadata
├── docker/               середовища складання
├── scripts/              workspace/build/release automation
├── tools/                автономні build/debug utilities
├── samples/              приклади extensions
├── patches/              pnpm dependency patches
├── typings.custom/       декларації сторонніх модулів
├── pnpm-workspace.yaml   packages і єдиний dependency catalog
├── nx.json               task graph, inputs, cache та outputs
└── package.json          кореневі команди workspace
```

Не редагувати як вихідний код:

- `node_modules/` — встановлені залежності;
- `dist/` — packaged output;
- `src/main/build/`, `src/main/out/` — результати збірки;
- `extensions/*/dist/` — зібрані extensions;
- `.nx/cache/`, `test-results/` — кеш і тестові артефакти.

## Electron main process

Каталог: `src/main/src/`.

Main process володіє можливостями, які не слід віддавати довільному renderer-коду:

- запуском і завершенням застосунку;
- створенням Electron windows;
- privileged filesystem і process operations;
- завантаженнями, upload і transfer operations;
- системними протоколами та інтеграцією з ОС;
- завантаженням extensions і native/adaptor hosts;
- telemetry bootstrap та main-process error handling.

Основні підкаталоги:

| Каталог                   | Призначення                                 |
| ------------------------- | ------------------------------------------- |
| `downloading/`            | download orchestration і worker logic       |
| `extensions/`             | main-process частини вбудованих можливостей |
| `filesystem/`             | системні filesystem operations              |
| `node-adaptor-host/`      | ізольований запуск Node adaptors            |
| `store/`                  | main-side persistence/state infrastructure  |
| `telemetry/`              | tracing і telemetry initialization          |
| `transfer/`, `uploading/` | передавання й завантаження даних            |
| `unleash/`                | feature flags та згенерована API schema     |

`src/main/package.json` визначає Electron entry point (`build/main.cjs`) і Nx build graph. Main build
залежить від renderer, preload, shared packages, assets та скопійованих extensions.

## Preload і IPC

Каталоги: `src/preload/src/` та `src/shared/src/api/`.

Preload є вузькою межею безпеки. Нову системну операцію слід будувати так:

1. Описати request/result/error contract у shared code.
2. Реалізувати privileged handler у main process.
3. Експортувати мінімально необхідну функцію через preload.
4. Викликати її з renderer без доступу до довільних Electron або Node internals.

Не передавати через IPC складні class instances, callbacks або несеріалізовані помилки. Для
довготривалих операцій визначати progress/cancellation semantics у контракті.

## Renderer

Каталог: `src/renderer/src/`.

Renderer містить UI, application state та orchestration вбудованих функцій.

| Каталог               | Призначення                                       |
| --------------------- | ------------------------------------------------- |
| `actions/`            | Redux actions загального рівня                    |
| `reducers/`           | загальні Redux reducers                           |
| `store/`              | створення store, middleware, persistence          |
| `views/`              | сторінки й великі layout components               |
| `controls/`           | повторно використовувані UI controls              |
| `ui/`                 | новіші design-system компоненти й UI utilities    |
| `hooks/`, `contexts/` | React hooks і contexts                            |
| `extensions/`         | вбудовані feature extensions                      |
| `types/`              | renderer та extension-facing TypeScript contracts |
| `util/`               | загальні services і helpers                       |
| `util/linux/`         | Linux/Steam/Proton/launcher parsing і resolution  |
| `telemetry/`          | renderer tracing та events                        |
| `test-utils/`         | shared test setup/helpers                         |

### Стан застосунку

Extensions підключають reducers до визначеної гілки state:

- `session` — тимчасовий стан поточного запуску;
- `settings` — користувацькі налаштування;
- `persistent` — довготривалі дані застосунку;
- `confidential` — чутливі дані з окремими вимогами до зберігання.

Не дублювати derived state у Redux, якщо його можна стабільно отримати selector-ом. Асинхронні
операції та filesystem effects не повинні виконуватися всередині reducer.

### Вбудований extension

Типова структура `src/renderer/src/extensions/<feature>/`:

```text
<feature>/
├── index.ts[x]       registration entry point
├── actions/          feature actions, якщо потрібні
├── reducers/         feature state
├── selectors.ts      derived state
├── views/            UI
├── util/             domain logic
├── types.ts          локальні contracts
└── *.test.ts[x]      unit/component tests поруч із кодом
```

`index.ts` повинен переважно реєструвати capability: page, reducer, action, event handler,
installer, deployment method, game або provider. Складну domain logic слід виносити з entry point у
тестовані модулі.

## Extensions

Каталог `extensions/` містить незалежні workspace packages, які збираються та копіюються до
застосунку.

Основні групи:

- `extensions/games/game-*` — підтримка конкретної гри;
- `gamestore-*` — інтеграції магазинів/launcher-ів;
- `modtype-*` — спеціальні типи модів;
- `gamebryo-*` — спільні можливості Bethesda/Gamebryo;
- installer, import, dependency та tooling extensions.

Extension має залежати від публічного `@nexusmods/vortex-api`, а не імпортувати приватні renderer
модулі. Bundled renderer extensions можуть мати глибшу інтеграцію, але новий стабільний контракт
слід піднімати до публічного API.

### Game extension

Game extension реєструє `IGame` та за потреби installers, tools, mod types і diagnostics. Мінімальна
відповідальність:

- стабільний унікальний game ID;
- назва й artwork;
- discovery/store identifiers;
- platform-specific executable;
- `requiredFiles` для перевірки знайденого каталогу;
- mod/data path;
- підтримувані tools;
- явні platform/deployment capabilities.

Windows-only припущення не повинні бути приховані в `details: any`, drive letters чи абсолютних
шляхах. Linux launch, Proton і deployment requirements мають описуватися typed capabilities.

## Workspace packages

Каталог `packages/` містить код, який має власний API та може використовуватися кількома
підсистемами.

| Package                                          | Роль                                        |
| ------------------------------------------------ | ------------------------------------------- |
| `vortex-api/`                                    | публічний extension API та declarations     |
| `adaptor-api/`, `adaptors/`                      | контракти й реалізації adaptor architecture |
| `game-extension-test/`                           | test harness для game extensions            |
| `extension-test-mocks/`                          | mocks для extension tests                   |
| `file-dependency-resolver/`                      | dependency resolution                       |
| `nexus-api-v3/`                                  | typed Nexus API/GraphQL layer               |
| `exe-version/`, `pe-resources/`, `icon-extract/` | executable/resource utilities               |
| `e2e/`                                           | Playwright end-to-end suite                 |

Створювати package варто, коли модуль має чіткий незалежний API, кілька споживачів або окремий
build/test lifecycle. Локальний feature helper повинен залишатися поруч із feature.

## Основні потоки даних

### Discovery гри

```text
Game extension query
  -> GameStoreHelper
  -> Steam / Heroic / Lutris / інший game store
  -> IGameStoreEntry + launchContext
  -> requiredFiles validation
  -> discovered game state
```

Store adapters відповідають за читання формату launcher-а. Вони повертають нормалізований
`IGameStoreEntry`; game extensions не повинні самостійно парсити Steam VDF, Heroic JSON або Lutris
YAML.

### Встановлення і deployment мода

```text
NXM/API/download
  -> download management
  -> installer selection
  -> normalized install instructions
  -> staging directory
  -> deployment plan
  -> hardlink / symlink / move activator
  -> game data directory
```

Archive boundary нормалізує Windows/POSIX separators і відхиляє traversal. Deployment layer має
перевіряти filesystem capabilities до запису та повертати structured diagnostics для `EXDEV`,
`EACCES`, `EROFS` й case collisions.

### Запуск гри або tool

Поточні компоненти включають `StarterInfo`, game-store adapters і `ProtonPaths`. Цільова модель
описана в Linux roadmap: єдиний launch provider обирає native/Steam/Wine/Proton шлях, prefix,
runtime, environment і повертає structured result.

```text
Game/tool request
  -> game capabilities + discovered store entry
  -> launch-context resolution
  -> native / URI / compatibility-runtime execution
  -> result, logs, remediation
```

## Linux-архітектура

Linux-specific логіка повинна складатися з невеликих шарів:

1. **Parsing** — чисті функції для VDF/JSON/YAML/mount data, без UI та side effects.
2. **Discovery** — пошук native, Flatpak і Snap locations через XDG-aware paths.
3. **Resolution** — нормалізація game path, App ID, prefix, runtime і filesystem capability.
4. **Policy** — вибір launch/deployment strategy з поясненням причин.
5. **Presentation** — health checks, onboarding, settings і platform-aware remediation.

Ключові поточні модулі:

- `src/renderer/src/util/linux/ProtonPaths.ts` — Proton prefix/runtime resolution;
- `src/renderer/src/util/linux/steamPaths.ts` — Steam layouts і libraries;
- `src/renderer/src/util/linux/heroic.ts` — Heroic manifest/config parsing;
- `src/renderer/src/util/linux/lutris.ts` — Lutris config parsing;
- `src/renderer/src/util/HeroicGamesLauncher.ts` — Heroic game-store adapter;
- `src/renderer/src/util/Lutris.ts` — Lutris game-store adapter;
- `src/renderer/src/extensions/health_check/` — diagnostics UI і providers;
- `src/renderer/src/extensions/*_activator/` — deployment implementations.

Platform parsing слід unit-test-ити synthetic fixtures без реального Steam, prefix або game
installation. Integration tests, що запускають Proton чи змінюють реальну бібліотеку, мають бути
явно opt-in.

## Локалізація та assets

- Загальні переклади розміщені у `locales/<language>/`.
- Extension може мати власний `language.json`, якщо цього вимагає його build pipeline.
- Не вбудовувати user-facing текст у platform policy, якщо повідомлення потребує перекладу.
- Спільні іконки, зображення та шрифти належать `assets/`; game artwork — відповідному game
  extension.

## Build і dependency graph

Workspace керується `pnpm`, задачі — Nx. Версії спільних залежностей визначаються в `catalog`
усередині `pnpm-workspace.yaml`.

Основні команди з кореня:

```sh
pnpm start
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run format
```

Для конкретного workspace слід використовувати його scripts або pnpm filter. Після зміни коду
потрібно виконати пропорційні `format`, `lint`, `typecheck`, `test` і `build` перевірки affected
package. Unit tests розміщуються поруч із кодом; cross-package workflows належать integration/e2e
suite.

Nx inputs і outputs у `nx.json` та package-level `nx.targets` є частиною архітектури збірки. Якщо
нова задача генерує файли, її outputs мають бути оголошені для коректного кешування.

## Де розміщувати новий код

| Зміна                           | Рекомендоване місце                                        |
| ------------------------------- | ---------------------------------------------------------- |
| React page або reusable control | `src/renderer/src/views`, `ui` або `controls`              |
| Незалежна вбудована функція     | `src/renderer/src/extensions/<feature>`                    |
| Renderer state                  | feature reducer/selector або загальні `actions`/`reducers` |
| OS/native operation             | `src/main/src` + typed IPC/preload contract                |
| Код для main і renderer         | `src/shared/src` без Electron process globals              |
| Публічна можливість extension   | `packages/vortex-api`                                      |
| Підтримка конкретної гри        | `extensions/games/game-*`                                  |
| Парсер launcher/config format   | `src/renderer/src/util/linux` або окремий package          |
| Store integration               | `gamestore-*` extension або нормалізований store adapter   |
| Reusable multi-consumer library | `packages/<name>`                                          |
| Build/release automation        | `scripts/`                                                 |
| Debugging/inspection utility    | `tools/`                                                   |

## Архітектурні правила

1. Зберігати process boundaries явними; privileged behavior не переносити в UI.
2. Віддавати перевагу typed contracts замість `any`, implicit `details` і string conventions.
3. Парсери зовнішніх форматів робити чистими, tolerant до optional fields і покривати fixtures.
4. Не змішувати discovery, policy та presentation в одному модулі.
5. Platform differences вирішувати provider-ами/capabilities, а не розсипаними перевірками
   `process.platform` у feature code.
6. User-facing failure має містити причину, контекст, безпечне виправлення та можливість retry.
7. Не логувати API keys, tokens, повні confidential payloads або неретушовані diagnostic reports.
8. Новий game/store extension не повинен змінювати поведінку інших ігор без явного shared contract.
9. Generated output не редагувати вручну; змінювати source і запускати відповідний generator.
10. Складну orchestration logic розбивати на тестовані pure helpers і тонкий integration layer.

## Пов'язана документація

- [`LINUX-ROADMAP.md`](./LINUX-ROADMAP.md) — Linux roadmap і completion criteria;
- [`AGENTS-DIRECTORIES.md`](./AGENTS-DIRECTORIES.md) — коротка карта для навігації;
- [`CONTRIBUTE.md`](./CONTRIBUTE.md) — правила внесення змін;
- [`CODESTYLE.md`](./CODESTYLE.md) — стиль коду;
- [`AGENTS-TESTING.md`](./AGENTS-TESTING.md) — тестові правила;
- [`docs/flatpak/technical.md`](./docs/flatpak/technical.md) — технічна Flatpak документація;
- [`docs/error-reporting/OVERVIEW.md`](./docs/error-reporting/OVERVIEW.md) — error-reporting architecture;
- [`packages/vortex-api/README.md`](./packages/vortex-api/README.md) — extension-facing API.
