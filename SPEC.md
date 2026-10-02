# Заметки по реализации

Документация API: https://green-api.com/docs/api/

Клиент работает без бэкенда: всё идёт через HTTP API инстанса и цикл
`receiveNotification`/`deleteNotification`. Файл описывает, что было
добавлено поверх базового ТЗ и как это устроено.

## Стек

React 19 · TypeScript (strict + noUncheckedIndexedAccess) · Vite ·
Zustand (persist) · Ant Design · oxlint · vitest

```bash
npm run dev       # dev-сервер http://localhost:5173
npm run build     # tsc -b && vite build -> dist/
npm run preview   # превью production-сборки
npm run lint      # oxlint
npm run test      # vitest run
```

## Архитектурные решения

Зафиксированные решения и их обоснование. Детали реализации фич - ниже
в 'Что сделано', полная карта методов API - в FEATURES.md.

### Прямые вызовы браузер -> GREEN-API, без бэкенда и прокси

Весь транспорт - `fetch` к
`{apiUrl}/waInstance{idInstance}/{method}/{apiTokenInstance}`
(`src/api/greenApi.ts`). GREEN-API отдаёт CORS-заголовки и сам играет
роль серверной стороны (очередь уведомлений, журналы, медиа-хранилище),
поэтому промежуточный бэкенд не нужен и сборка остаётся чисто
статической. Цена решения: `apiTokenInstance` виден в URL - принято,
зафиксировано в ограничениях. `uploadFile` идёт на отдельный хост
`media.green-api.com` (`mediaEndpoint`) - так устроен GREEN-API; оба
хоста переопределяемы через `Credentials.apiUrl`/`mediaUrl`.

### Поллинг receiveNotification/deleteNotification вместо webhook

Webhook требует публичный endpoint, которого у статического фронта нет,
поэтому входящие вычитываются из очереди инстанса long-polling'ом:
`receiveNotification?receiveTimeout=30` -> `dispatchNotification` ->
`deleteNotification` по `receiptId` (`pollLoop` в `lib/poller.ts`).
При входе `ensureReceivingSettings` (`greenApi.ts`) читает `getSettings`
и при расхождении флагов вызывает `setSettings`:
`webhookUrl`/`webhookUrlToken` обнуляются (HTTP-приём требует пустого
webhook URL), все нужные вебхуки включаются. Проверка идемпотентна -
лишних `setSettings` не шлём; если у инстанса был настроен свой webhook,
его URL возвращается и App показывает предупреждение, что он отключён.

Сам цикл: idle-сон 1 с (`POLL_IDLE_MS`), экспоненциальный backoff на
ошибках 5 с -> 60 с, после 3 ошибок подряд - диагностика
`getStateInstance` и текст в баннер `connectionError`, на 401 -
разлогин и выход из цикла. `receiveNotification` работает с
`AbortSignal` - закрытие вкладки/выход обрывают long-poll сразу, а не
ждут 30-секундный таймаут.

`dispatchNotification` отделён от ack: исключение в маппере ловится и
логируется, `deleteNotification` выполняется в любом случае - иначе
одно битое уведомление возвращалось бы из очереди бесконечно и
блокировало все остальные (poison message).

### Zustand persist -> localStorage

Три стора, три ключа:

- `green-api-auth` - только `credentials`; `connectionError` не
  персистится (это состояние сессии, а не настройка).
- `green-api-chats` - чаты, `activeChatId`, `instanceId`; `version: 2`
  с `migrate`.
- `green-api-ui` - тема и масштаб.

Решения вокруг персиста (`lib/storage.ts`, `store/chatStore.ts`):

- `persistStorage` откатывается на in-memory Map, если localStorage
  недоступен (приватный режим, тесты без DOM) - приложение не ломается,
  просто ничего не сохраняется между сессиями.
- `partialize` + `stripTransient`: `blob:`/`data:`-url сообщений и
  `data:`-thumbnail вырезаются при сохранении - blob-ссылки мертвы после
  перезапуска, а base64 раздувает localStorage до quota-превышения,
  которое роняло persist целиком.
- `migrate` (version 2): нормализует старые chatId через `toChatId`.
- `onRehydrateStorage`: после каждого восстановления переводит
  сообщения со статусом `pending` в `error` - вкладка могла умереть
  посреди отправки, а вечное 'отправляется' вводит в заблуждение.
  Одного `migrate` недостаточно: он срабатывает только при смене
  версии схемы.
- `setInstance`: чаты привязаны к `idInstance`. Вход под другим
  инстансом чистит список (чужая история не должна оставаться видимой);
  легаси-данные без владельца принимаем своими - не стираем при первом
  апгрейде схемы.
- `MAX_MESSAGES_PER_CHAT = 200` - потолок истории на чат, чтобы persist
  не разрастался.

### Порядок сообщений и дедуп по idMessage

`addMessage` и `mergeMessages` дедупят по `id` (в mergeMessages - Map по
id). Источники пересекаются: журналы синка, `getChatHistory`,
эхо-вебхуки и локальная отправка могут доставить одно сообщение дважды -
дедуп обязателен. `mergeMessages` сортирует по `timestamp`, мержит
`extra` глубоко, не затирает реальный текст сервисными заглушками
('Изображение', 'Файл' и т.п. - журнал иногда отдаёт тип без
содержимого) и не понижает статус: доставленное сообщение не
откатывается до 'sent' при повторном журнале (`STATUS_RANK`, `error`
липкий - журнальная запись не воскрешает провалившуюся отправку).

Особый случай - эхо исходящего: оно может прийти раньше, чем резолвится
`sendXxx`, когда локальный пузырь ещё с `local-`id и дедуп по id дал бы
дубль. `dispatchNotification` находит локальный пузырь того же `kind`
и с тем же текстом и усыновляет эхо: переписывает ему настоящие
`id`/`status`/`url`, blob-превью ревокается. Матч по тексту важен при
двух быстрых сообщениях одного вида - иначе чужой пузырь получил бы
не тот id/url.

### Отправка и ретрай

Отправка оптимистичная: `sendOutgoing` в `ChatWindow` сразу кладёт
`local-${uuid}` со статусом `pending`, по resolve `sendXxx` прописывает
настоящий `idMessage`/`sent`, по ошибке - `error`. Ретрай (клик по
статусу ошибки): текст переотправляется `sendMessage` напрямую; медиа -
`fetch(m.url)` по сохранённой blob:/downloadUrl-ссылке -> blob -> `File`
-> `uploadFile` (media-хост) -> `sendFileByUrl` с полученным `urlFile`.
Поэтому ретрай медиа работает, только пока жива ссылка сессии - после
перезагрузки с вырезанным blob-url контента нет (см. ограничения).

### Цитаты: сначала локальная история, потом getMessage

Вебхук `quotedMessage` несёт только `stanzaId`/`participant` оригинала.
`enrichQuote` (`lib/poller.ts`) сначала ищет оригинал в уже загруженной
истории чата; если его нет - ставит плейсхолдер 'Сообщение' и асинхронно
дёргает `getMessage` по `stanzaId` (`resolveQuoteRemote`), патча текст,
отправителя и thumbnail по resolve. Не нашёлся в журнале - остаётся
плейсхолдер, это не ошибка. Фетчер инъектируется (`QuoteFetcher`) для
тестов.

`participant` в цитате - сырой jid (`7999...@c.us`). `quoteSenderLabel`
нормализует его всегда, даже когда текст цитаты уже пришёл: в личном
чате участников двое, jid != chatId собеседника - значит цитируют наше
сообщение и показываем 'Вы'; jid собеседника заменяется на его имя
(senderName/заголовок чата); в группах jid режется до номера.

### Мультитаб-координация

`hooks/useNotifications.ts`: поллит только вкладка-лидер через Web Locks
API (`navigator.locks.request('green-api-notifications')`); при закрытии
лидера лок переходит следующей вкладке. Без `navigator.locks` (старые
браузеры) - прямой поллинг, дубли запросов приемлемы. BroadcastChannel
не используется - для выбора лидера достаточно лока. Состояние между
вкладками едет другим путём: persist пишет в localStorage, событие
`storage` в остальных вкладках вызывает `persist.rehydrate()` сторов
(`useTabSync`).

### Скролл и фоновый узор: два баг-фикса

- Скролл к последнему сообщению и к оригиналу цитаты - только
  `messagesRef.scrollTo` на самом контейнере `.chat-window__messages`
  (`ChatWindow.tsx`), НЕ `scrollIntoView`: он крутил бы всех предков с
  overflow, а с декоративным узором `.chat-window` стал scrollable и
  весь чат уезжал вверх при любом автоматическом скролле.
- Узор чата - `.chat-window::before` с `inset: -100%` и поворотом на
  45deg (запас, чтобы края не оголялись на широких окнах); слой висит на
  `.chat-window`, а не на скроллящемся контейнере - иначе расширил бы
  область прокрутки; узор статичен, как в WhatsApp. На `.chat-window`
  стоит `overflow: clip`, а не `hidden`: `hidden` создаёт
  scrollable-контейнер и ломал вёрстку тем же угоном скролла; `clip`
  обрезает узор, не создавая scroll-контекст.

### Фильтрация мусорных chatId

`isSendableChatId` (`lib/chatId.ts`) принимает только `phone@c.us`
(>=5 цифр - короткие вроде `0@c.us` это системный мусор), `group@g.us` и
`@lid`. GREEN-API отдаёт такие служебные id в `getChats` и журналах, но
сам же не принимает их в send-методах - показывать их в списке
бессмысленно. `syncAccountChats` фильтрует входные данные и заодно
вычищает уже заведённые невалидные чаты через `removeChat` - мусор,
созданный до фильтрации, пропадает у существующих пользователей.

### Синхронизация при входе: один раз на инстанс за сессию

`syncAccountChats` помечает `idInstance` в session-Set и повторно за
сессию не ходит - дальше работает поллинг, а повторный синк дорогой и
нужен только при полном отвале. Пять запросов (`getChats`, оба журнала
сообщений, оба журнала звонков) идут через `Promise.allSettled`:
журналы звонков опциональны (бета, могут не отдаваться на старых
инстансах) и не должны валить основной синк. Полный отвал всех пяти ->
флаг снимается, при следующем входе повторим. `SYNC_MINUTES = 4320`
(3 суток): дефолтные 24ч журналов мало для холодного старта, лимит
GREEN-API - 10000 записей.

### Убранная фича: локальная 'очистка диалога'

Функции очистки истории в клиенте нет сознательно: GREEN-API не умеет
удалять историю удалённо, а локальная очистка создавала ложное
поведение - сообщения возвращались из журнала (`getChatHistory`,
`last*Messages`) после F5. Чтобы не обещать то, что API не гарантирует,
пункт убран. `removeChat` в сторе остался, но служит только для вычистки
невалидных chatId при синке (см. выше).

### Стили и темы

- Темы - наборы CSS-переменных: `:root` и `[data-theme='dark']` в
  `index.css`; `App.tsx` выставляет `documentElement.dataset.theme`,
  antd переключается через `theme.darkAlgorithm` +
  `colorPrimary: #00a884`, локаль `ru_RU`.
- Масштаб интерфейса - `data-scale` на `<html>` -> `--ui-zoom` ->
  `transform: scale` на `.app-shell` с компенсацией `width/height`
  (деление на zoom) - иначе появлялся бы лишний скроллбар у body.
- Кастомные скроллбары в фирменном зелёном: `scrollbar-color` для
  Firefox и `::-webkit-scrollbar` c `color-mix(accent 45%)` +
  прозрачная рамка/`background-clip` для визуального отступа.
- Палитра WhatsApp-подобная: accent `#00a884`, исходящий пузырь
  `#d9fdd3`/`#005c4b`, фон чата `#efeae2`/`#0b141a`, мета-серый через
  полупрозрачные rgba.

### Тестируемость

Логика вынесена из React в `src/lib` и параметризована зависимостями:
`PollDeps` (`receive`/`acknowledge`/`sleep`/`isStopped`/`diagnose`/
`fetchMessage`) и `SyncDeps` (`fetchChats`/`fetchIncoming`/...)
подменяются в тестах - реальных вызовов API нет нигде, сторы сбрасываются
прямым `setState`. Догрузка цитаты тоже инъектируется (`fetchMessage`).

### Сборка

`vite.config.ts`: ручное разбиение вендоров - `react`
(react-dom/scheduler) и `antd` (antd/@ant-design/@rc-component/rc-*) в
отдельные чанки: вендорный код меняется редко и кэшируется независимо от
кода приложения. `chunkSizeWarningLimit: 700` поднят под фактический
размер antd-чанка (~697 кБ) - известное и принятое решение: меньше antd
не сжимается, а разбиение уже сделано.

## Что сделано

### Ответ на сообщение (reply)

В меню пузыря - 'Ответить', над полем ввода появляется превью цитаты с
крестиком. `sendMessage`, `sendFileByUpload` и `sendFileByUrl` принимают
`quotedMessageId` -
передаём `idMessage` исходного. Локальный `quote` ставим сразу, не дожидаясь
эха. Reply на сообщения с `local-` id недоступен (нет настоящего idMessage) -
пункт меню скрыт. Клик по цитате в пузыре скроллит к исходному сообщению и
подсвечивает его (`data-message-id` + `scrollTo` на контейнере, не
scrollIntoView - он крутит и предков).

### Редактирование исходящего текста (editMessage)

POST `{chatId, idMessage, message}` - только свои текстовые сообщения,
отправленные через API, в окне 15 минут (ограничение WhatsApp). Меню пузыря
'Редактировать' переводит поле ввода в режим правки (превью 'Редактирование'
+ крестик отмены), Enter сохраняет. После успеха локально ставим
`edited: true` и новый текст - эхо-вебхук может не прийти.

### Вебхуки правки и удаления

`setSettings` дополнен флагами `editedMessageWebhook`,
`deletedMessageWebhook`, `incomingCallWebhook`, `outgoingCallWebhook` =
`'yes'`; `markIncomingMessagesReaded` = `'no'` (см. ниже).
`ensureReceivingSettings` проверяет все новые флаги.

- `typeMessage: 'editedMessage'` -> `editedMessageData.textMessage` +
  `stanzaId`: обновляем текст сообщения, ставим `edited`, в пузыре
  появляется метка 'изменено'.
- `typeMessage: 'deletedMessage'` -> `deletedMessageData.stanzaId`:
  сообщение заменяется плейсхолдером 'Сообщение удалено' курсивом, как в
  WhatsApp. Своё удаление через `deleteMessage` даёт тот же плейсхолдер
  локально (updateMessage, не removeMessage).

### Отметка прочтения (readChat)

POST `{chatId}` при открытии чата и при каждом новом входящем в открытом
чате. Авто-прочтение на инстансе выключено (`markIncomingMessagesReaded:
'no'`), поэтому синие галочки у собеседника появляются только когда чат
реально открыт. Ошибки глотаем - best-effort.

### 'Печатает...' (sendTyping)

POST `{chatId, typingTime: 5000}` при вводе текста, throttle 4 секунды.
Входящий индикатор набора GREEN-API не присылает - только исходящий.

### Пересылка (forwardMessages)

POST `{chatId, chatIdFrom, messages: [idMessage]}`. Меню пузыря 'Переслать'
-> модалка со списком чатов -> пересылка. Пересланное появится в целевом чате
через эхо-вебхук. Недоступно для `local-` сообщений и удалённых.

Пересланные сообщения помечаются 'Переслано': `isForwarded` лежит внутри
per-type data-объекта вебхука (`extendedTextMessageData` и др.) и на верхнем
уровне записи журнала - маппится в `ChatMessage.forwarded`.

### Файл по ссылке (sendFileByUrl)

POST `{chatId, urlFile, fileName, caption?, quotedMessageId?}`. В меню
вложений пункт 'Файл по ссылке': URL + имя файла (обязательно с расширением)
+ подпись. Учитывает активный reply.

### Звонки в ленте

`typeWebhook: 'incomingCall'`/`'outgoingCall'`, поле `status`: `pickUp` ->
'Входящий звонок', `hungUp`/`declined`/`missed` -> 'Пропущенный звонок'.
Рендерится карточкой в чате (`kind: 'call'`). На `offer` карточку не
добавляем - ждём итоговый статус, чтобы не было дублей.

### Служебные вебхуки

- `quotaExceeded` -> баннер 'Превышены ограничения тарифа'.
- `stateInstanceChanged` с состоянием ≠ `authorized` -> баннер с текстом
  состояния.

### Синхронизация аккаунта при входе

`syncAccountChats` (`lib/sync.ts`) - один вызов на инстанс за сессию,
все запросы через `Promise.allSettled` (частичный отвал не ломает
остальное; полный отвал разрешает повтор):

- `getChats` -> `mergeChats`: чаты с `name`/`unreadCount` из аккаунта
  (существующие чаты не затираются, активный чат не сбрасывается).
- `lastIncomingMessages`/`lastOutgoingMessages` (`?minutes=4320`) ->
  `toMessage` (общий маппер журнала из `lib/history.ts`) ->
  `mergeMessages`: превью последних сообщений, имена отправителей
  становятся заголовками новых чатов.
- `lastIncomingCalls`/`lastOutgoingCalls` -> `mapCallJournal` -> карточки
  звонков с длительностью. Статусы журнала: `pickUp` -> принятый,
  `hungUp`/`missed`/`declined` -> пропущенный, `invalid` -> 'Звонок не
  состоялся'.

### Контакты и автодополнение

`getContacts` грузится при монтировании `ChatList`; поле нового чата -
`AutoComplete` с опциями 'Имя · chatId'. Поиск по имени/chatId подстрокой
и по цифрам номера (`matchContact` - ввод приходит отформатированным
маской, сравниваем по цифрам от 3 знаков). Выбор контакта создаёт чат без
`checkWhatsapp` - номер гарантированно в WhatsApp.

### Аватары

`getContactInfo` -> `avatar` как раньше; если его нет - `ensureChatAvatar`
дёргает `getAvatar` (отдельный метод, работает когда приватность
разрешает). Лениво, один раз на chatId за сессию.

### Догрузка цитаты (getMessage)

Вебхук `quotedMessage` несёт только `stanzaId`/`participant`. Локальный
lookup по истории как раньше; если оригинала нет - `dispatchNotification`
принимает `fetchMessage` (по умолчанию `getMessage`) и патчит цитату
по resolve: текст, отправитель ('Вы' для своих), thumbnail для медиа.

### Протухшие ссылки на файлы (downloadFile)

`downloadUrl` в вебхуках/журнале живёт ограниченное время. По
`onError` у img/video/audio и при клике по файловой ссылке дёргаем
`downloadFile({chatId, idMessage})` -> свежий `downloadUrl` пишется в стор
(updateMessage) и открывается. Повторный запрос за сообщение - один раз
(`urlRefreshed`), чтобы не закольцовывать на реально мёртвых файлах.

### Ретрай медиа (uploadFile -> sendFileByUrl)

Раньше retry работал только для текста. Теперь: `fetch(url)` -> blob ->
`File` -> `uploadFile` (media-хост GREEN-API) -> `sendFileByUrl` с
полученным `urlFile`; статус/id/url сообщения обновляются. Работает для
blob:-ссылок в рамках сессии и для живых downloadUrl.

### Диагностика инстанса

Кнопка ⓘ в шапке сайдбара -> `DiagnosticsModal`: `getWaSettings`
(номер/состояние/устройство/прогресс синка), `getStateInstanceHistory`,
`showMessagesQueue` + `getMessagesCount` (зависшие исходящие),
`getWebhooksCount`. Действия: `clearMessagesQueue`, `clearWebhooksQueue`
(API лимитит раз в минуту - показываем `leftTime`), `reboot`,
`logout` инстанса (Popconfirm: сессия WhatsApp слетает, нужен QR заново,
после разлогина выходим и из приложения).

## Тесты

Vitest: юнит-тесты мапперов в `lib/notifications.test.ts`
(edited/deleted/call/quota), `poller.test.ts` (диспетчинг + цикл +
догрузка цитат), `sync.test.ts` (синхронизация и журналы звонков),
`contacts.test.ts`, `format.test.ts`, плюс `chatId.test.ts` и
`chatStore.test.ts`. Логика вынесена в lib с инъекцией зависимостей -
API-слой в тестах не дёргается. Перед сдачей гоняем `npm run lint` +
`npm run test` + `npm run build`.

## Известные ограничения

- Правка - только свои текстовые сообщения через API и в течение 15 минут
  после отправки (ограничение WhatsApp; `editMessage` не подтверждается
  эхо-уведомлением, статус правки отслеживаем только локально).
- Пересылка требует, чтобы сообщение было в журнале GREEN-API - включается
  `incomingWebhook`/`outgoingWebhook`, они у нас уже 'yes'.
- Журналы звонков в бете и требуют включённых call-вебхуков - могут не
  отдаваться на старых инстансах (синк это переживает).
- Ретрай медиа возможен, только пока жив `blob:`-url сессии или серверный
  `downloadUrl` - после перезагрузки с мёртвой ссылкой контента нет.
- `apiTokenInstance` передаётся в URL - так устроен GREEN-API.
