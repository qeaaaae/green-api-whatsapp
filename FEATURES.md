# Карта функционала

Браузерный WhatsApp-клиент поверх GREEN-API. React 19 + TypeScript + Vite +
Zustand (persist) + Ant Design 6. Без бэкенда: все запросы идут напрямую из
браузера в `api.green-api.com` (и `media.green-api.com` для загрузки файлов).
Входящие события приходят long-polling циклом `receiveNotification` ->
`deleteNotification`, а не вебхуками - вебхуку некуда слать, сервера нет.
Состояние (креды, чаты, тема) персистится в `localStorage` через
zustand/middleware persist с in-memory fallback.

```
Компоненты (antd UI)  ->  zustand-сторы (persist -> localStorage)
     ^                            ^
     |                            |
 send* / get* / журналы    dispatchNotification
     |                            |
     +---- api/greenApi.ts ---- pollLoop (receiveNotification)
```

| Слой | Файлы | Ответственность |
|---|---|---|
| API client | `src/api/greenApi.ts` | Тонкие fetch-обёртки; `ApiError` извлекает `invokeStatus.description`/`description`/`message` из тела ошибки; пустые ответы не парсятся; `uploadFile` ходит на отдельный media-хост |
| Types | `src/types.ts` | `Credentials`, `ChatMessage`, `MessageExtra`, `MessageQuote`, тела вебхук-уведомлений GREEN-API |
| Mappers | `src/lib/notifications.ts` | Чистые функции: `Notification.body` -> сообщение/реакция/статус/правка/удаление/звонок/сервисное событие |
| History | `src/lib/history.ts` | `getChatHistory` -> merge сообщений и реакций; `toMessage` - общий маппер записи журнала |
| Sync | `src/lib/sync.ts` | Первичная синхронизация: `getChats` + журналы сообщений и звонков |
| Polling | `src/lib/poller.ts` + `src/hooks/useNotifications.ts` | Цикл приёма уведомлений, leader election между вкладками, tab sync |
| Stores | `src/store/{auth,chat,ui}Store.ts` | Креды + баннер связи; чаты + сообщения; тема + масштаб |
| Utils | `src/lib/{chatId,chatTitle,contacts,format,storage}.ts` | Нормализация номеров, имена/аватары, поиск по контактам, форматирование, safe-storage |
| UI | `src/components/*`, `src/components/attachments/*` | LoginScreen, ChatList, ChatWindow, MessageBubble, ImageLightbox, AttachmentMenu, DiagnosticsModal, модалки вложений |

## Карта фич: UI -> API -> код

### Вход и конфигурация инстанса

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Вход по idInstance + apiTokenInstance | `LoginScreen`: два поля, кнопка 'Войти'; вход только при `stateInstance === 'authorized'` | `getStateInstance` | `src/components/LoginScreen.tsx`; `src/store/authStore.ts` (`login`) |
| Автонастройка приёма уведомлений | При входе незаметно; если у инстанса был webhookUrl - warning 'На инстансе был настроен webhook - он отключён' | `getSettings`, `setSettings` | `ensureReceivingSettings` в `src/api/greenApi.ts`; вызов в `src/App.tsx` |
| Предупреждение о разлогине инстанса | Баннер `Alert` вверху экрана | вебхук `stateInstanceChanged`, `quotaExceeded` | `mapServiceNotice` в `src/lib/notifications.ts`; `src/App.tsx` |

Флаги, выставляемые `setSettings` (см. `src/api/greenApi.ts`):

| Флаг | Значение | Зачем |
|---|---|---|
| `webhookUrl`, `webhookUrlToken` | `''` | Приём по HTTP API требует пустой webhook URL |
| `incomingWebhook` | `yes` | Входящие сообщения в очередь уведомлений |
| `outgoingWebhook` | `yes` | Сообщения, отправленные с телефона |
| `outgoingAPIMessageWebhook` | `yes` | Эхо API-сообщений (downloadUrl, статусы) |
| `outgoingMessageWebhook` | `yes` | Статусы сообщений с телефона |
| `editedMessageWebhook` | `yes` | Вебхук правки (свои и чужие) |
| `deletedMessageWebhook` | `yes` | Вебхук удаления у всех участников |
| `incomingCallWebhook`, `outgoingCallWebhook` | `yes` | Уведомления о звонках + журналы `last*Calls` |
| `stateWebhook` | `yes` | Смена состояния инстанса |
| `markIncomingMessagesReaded` | `no` | Read-отметку шлём сами через `readChat`, иначе собеседник видит синие галочки до реального прочтения |

`ensureReceivingSettings` идемпотентен: `setSettings` дёргается только при
расхождении флагов.

### Отправка сообщений

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Текстовое сообщение | Поле ввода + Enter / кнопка отправки | `sendMessage` | `ChatWindow.tsx` (`send`, `sendOutgoing`) |
| Файл/фото с диска | Меню скрепки -> 'Файл' -> `FileUploadModal` (имя, размер, подпись) | `sendFileByUpload` (multipart) | `AttachmentMenu.tsx`, `attachments/FileUploadModal.tsx` |
| Фото с камеры | Кнопка камеры рядом с полем ввода; скрытый `<input capture="environment">` | `sendFileByUpload` | `ChatWindow.tsx` (`sendPhoto`, `cameraInputRef`) |
| Файл по ссылке | Меню скрепки -> 'Файл по ссылке' -> `FileUrlModal` (URL, имя с расширением, подпись; картинка по расширению рендерится как image) | `sendFileByUrl` | `attachments/FileUrlModal.tsx` |
| Контакт | Меню скрепки -> 'Контакт' -> `ContactModal` (телефон с маской, имя, фамилия, компания) | `sendContact` | `attachments/ContactModal.tsx` |
| Геолокация | Меню скрепки -> 'Локация' -> `LocationModal` (широта, долгота, название) | `sendLocation` | `attachments/LocationModal.tsx` |
| Опрос | Меню скрепки -> 'Опрос' -> `PollModal` (вопрос, динамический список вариантов, переключатель мультивыбора) | `sendPoll` | `attachments/PollModal.tsx` |
| Оптимистичная отправка | Пузырь появляется сразу со статусом pending и `local-` id; после ответа API id подменяется на `idMessage` | любой `send*` | `ChatWindow.tsx` (`sendOutgoing`) |
| Кликабельные ссылки | URL в тексте и подписях к медиа - ссылки, открываются в новой вкладке; `www.` без протокола -> `https://`; висячая пунктуация и непарные скобки в ссылку не входят | - | `linkify` в `src/lib/linkify.ts`, `LinkedText` в `MessageBubble.tsx` |
| 'Печатает...' у собеседника | Автоматически при наборе текста; только когда текст растёт, throttle 4 с | `sendTyping` (`typingTime: 5000`) | `ChatWindow.tsx` (`onInputChange`, `lastTypingSent`) |

### Действия с сообщением (контекстное меню пузыря)

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Ответить | Пункт меню; панель `compose-context` над полем ввода; цитата уходит в `quotedMessageId` | `sendMessage`, `sendFileByUpload`, `sendFileByUrl` (параметр `quotedMessageId`) | `MessageBubble.tsx`, `ChatWindow.tsx` (`startReply`), `attachments/types.ts` (`replyQuoteOf`) |
| Переслать | Пункт меню -> модалка со списком чатов -> toast 'Сообщение переслано' | `forwardMessages` | `ChatWindow.tsx` (`forwarding`, `doForward`) |
| Редактировать | Пункт меню у своих текстовых; поле ввода переходит в режим правки, Enter сохраняет, метка 'изменено' | `editMessage` (окно ~15 минут, только API-сообщения) | `MessageBubble.tsx`, `ChatWindow.tsx` (`startEdit`, `send`) |
| Удалить сообщение | Пункт меню у своих; пузырь остаётся курсивным плейсхолдером 'Сообщение удалено' | `deleteMessage` (только исходящие) | `MessageBubble.tsx`, `ChatWindow.tsx` (`remove`) |

Действия недоступны для сообщений с `local-` id (ещё нет настоящего
`idMessage`) и для удалённых.

### Приём событий (вебхук-тела из очереди)

| Функция | UI | Источник (typeWebhook / typeMessage) | Где в коде |
|---|---|---|---|
| Входящее сообщение | Пузырь слева; чат создаётся при необходимости; unread-бейдж в списке | `incomingMessageReceived` | `mapIncomingMessage`, `dispatchNotification` (`src/lib/notifications.ts`, `src/lib/poller.ts`) |
| Эхо исходящего | Свой пузырь; если был `local-` пузырь того же kind - усыновляется (id + url), иначе добавляется | `outgoingMessageReceived`, `outgoingAPIMessageReceived` | `mapOutgoingMessage`, echo-dedup в `dispatchNotification` |
| Статусы доставки | Галочки: часы pending -> серая галка sent -> двойная delivered -> синяя двойная read; красный '!' при error | `outgoingMessageStatus` (`sent`/`delivered`/`read`/`failed` -> error) | `mapOutgoingStatus`; `StatusIcon` в `MessageBubble.tsx` |
| Реакция | Эмодзи-бейдж под пузырём; пустой текст = реакция снята | `reactionMessage` (по `quotedMessage.stanzaId`) | `mapReaction`, `bubble__reaction` |
| Правка чужого/своего | Текст обновляется, метка 'изменено' | `editedMessage` внутри `*MessageReceived` | `mapEditedMessage` |
| Удаление у всех | Плейсхолдер 'Сообщение удалено' курсивом | `deletedMessage` | `mapDeletedMessage` |
| Звонок | Карточка с телефонной иконкой; 'Входящий звонок' / 'Исходящий звонок' / 'Пропущенный звонок'; пропущенный - красная иконка. `offer` пропускается, чтобы не было дублей | `incomingCall`, `outgoingCall` | `mapCall` (`CALL_TEXT`), `MessageBody` kind 'call' |
| Квота/состояние | Жёлтый баннер сверху | `quotaExceeded`, `stateInstanceChanged` | `mapServiceNotice`, `setConnectionError` |

### Цитаты

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Блок цитаты в пузыре | Акцентная полоска, отправитель, текст/тип вложения, thumbnail | `quotedMessage` в теле вебхука/журнала | `mapQuote`, `quoteFromReply` (`notifications.ts`); `QuoteBlock` в `MessageBubble.tsx` |
| Догрузка оригинала | У `typeMessage: 'quotedMessage'` вебхук несёт только `stanzaId`; плейсхолдер 'Сообщение' патчится настоящим текстом и автором | `getMessage` (по stanzaId, если оригинала нет в загруженной истории) | `enrichQuote`, `resolveQuoteRemote` в `src/lib/poller.ts` |
| 'Вы' в цитатах | `participant` приходит как jid (`7999...@c.us`); в личном чате jid != chatId собеседника -> это мы, показываем 'Вы'; jid собеседника -> его имя; в группе -> просто номер | - | `quoteSenderLabel` в `src/lib/poller.ts` |
| Переход по клику на цитату | Плавный скролл контейнера сообщений + зелёная вспышка 1.4 с; если сообщения нет в загруженных - toast 'Сообщение вне загруженной истории' | - | `jumpToMessage`, `bubble--highlight` (`ChatWindow.tsx`, `index.css`) |

### Пересылка

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Переслать в другой чат | Модалка со списком чатов (без текущего) | `forwardMessages` | `ChatWindow.tsx` (`doForward`, `.forward-list`) |
| Метка 'Переслано' | Курсивная строка с иконкой над текстом пузыря | флаг `isForwarded` из вебхука (внутри per-type data) или журнала (верхний уровень + вложенные поля) | `isForwarded` в `notifications.ts`, `forwarded` в `history.ts`, `bubble__forwarded` |

### Статусы исходящих и ретрай

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| pending | Иконка часов (до ответа API) | - | `sendOutgoing` в `ChatWindow.tsx` |
| sent / delivered / read | Одна серая галка / двойная серая / двойная синяя `#53bdeb` | `outgoingMessageStatus`-вебхук; `statusMessage` из журнала | `mapOutgoingStatus`; `STATUS` в `history.ts`; `StatusIcon` |
| error + ретрай | Красный `!` с кликом; текст шлём заново, медиа - перезаливаем блоб по живому url | `sendMessage` для текста; `fetch(url)` -> `uploadFile` (media-хост) -> `sendFileByUrl` для медиа | `retry` в `ChatWindow.tsx` |
| pending после перезапуска | Становится error при каждом восстановлении persist-стейта, не только при смене версии схемы | - | `onRehydrateStorage` + `migrate` в `chatStore.ts` |

### Чтение чата

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Отметить прочитанным | При открытии чата и при приходе новых сообщений в открытый чат | `readChat` (fire-and-forget, не чаще 1 раза в 15 с на чат - на Developer-тарифе у метода месячная квота, ответ 466) | `useEffect` на `lastMessageId` в `ChatWindow.tsx` |
| Авто-прочтение выключено | Синие галочки у собеседника только после реального открытия | `setSettings`: `markIncomingMessagesReaded: 'no'` | `src/api/greenApi.ts` |

### История чата

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Подгрузка истории при открытии | Старые сообщения вставляются по timestamp, статусы обновляются, реакции раскладываются по `stanzaId` | `getChatHistory` (последние 100), один раз на чат за сессию, вызовы разнесены >=1.1 с (лимитер GREEN-API 1 р/с, 429) | `ensureChatHistory`, `toMessage` в `src/lib/history.ts`; `mergeMessages` в `chatStore.ts` |
| Аккуратный merge | Заглушки текста ('Файл', 'Опрос'...) не затирают реальный текст; `extra` мержится глубоко | - | `GENERIC_TEXT`, `defined` в `chatStore.ts` |

### Синхронизация при входе

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Список чатов аккаунта | Чаты с именами и unreadCount появляются при входе | `getChats` (`newChatId` подменяет устаревший id) | `syncAccountChats` -> `mergeChats` (`src/lib/sync.ts`) |
| Последние сообщения | Превью и время последнего сообщения в списке | `lastIncomingMessages`, `lastOutgoingMessages` (`?minutes=4320` - 3 суток) | `syncAccountChats` -> `toMessage` -> `mergeMessages` |
| Журналы звонков | Карточки звонков с длительностью ('Пропущенный звонок · 0:42'; `invalid` -> 'Звонок не состоялся') | `lastIncomingCalls`, `lastOutgoingCalls` (3 суток) | `mapCallJournal` в `src/lib/sync.ts` |
| Частичный отвал | Падение одного метода не ломает остальные; полный отвал разрешает повтор | `Promise.allSettled` | `syncAccountChats` |

### Список чатов и контакты

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Новый чат по номеру | Поле с маской `+7 (000) 000-00-00` (RU/США/прочие); '8' -> '7' без явного '+' | `checkWhatsapp` для `@c.us`, `getGroupData` для `@g.us`; ошибки проверки не блокируют создание | `ChatList.tsx` (`createChat`); `toChatId`, `formatPhoneInput` в `chatId.ts` |
| Автодополнение контактов | `AutoComplete` с опциями 'Имя · chatId'; поиск по имени и по цифрам номера (от 3 цифр) | `getContacts` при монтировании списка | `ChatList.tsx`; `contactLabel`, `matchContact` в `contacts.ts` |
| Имена чатов | `senderContactName`/`senderName` из уведомления -> `getContactInfo` -> номер | `getContactInfo` (лениво, 1 раз на chatId за сессию, только `@c.us`) | `ensureChatTitle` в `chatTitle.ts`; вызовы в `poller.ts`, `ChatWindow.tsx`, `ChatList.tsx` |
| Аватары | Фото профиля; иначе цветной круг с первой буквой (детерминированный цвет по chatId) | `getContactInfo` (`avatar`), fallback `getAvatar` | `ensureChatAvatar` в `chatTitle.ts`; `avatarColor` в `format.ts`; Avatar в `ChatList.tsx`, `ChatWindow.tsx` |
| Непрочитанные | Зелёный бейдж со счётчиком, акцентное время; сброс при открытии | `unreadCount` из `getChats` (только новым чатам) + локальный счётчик входящих | `addMessage`, `selectChat`, `mergeChats` в `chatStore.ts`; `chat-list__unread` |
| Фильтрация мусорных chatId | Служебные id вроде `0@c.us` не попадают в список, автодополнение контактов и не создаются ручным вводом | - | `isSendableChatId` в `chatId.ts` (`\d{5,}@c.us`, `@g.us`, `@lid`); фильтр в `sync.ts` и `ChatList.tsx` |

### Рендер типов сообщений

| typeMessage | kind | Рендер в пузыре |
|---|---|---|
| `textMessage`, `extendedTextMessage`, `quotedMessage` | `text` | Текст, `pre-wrap` |
| `imageMessage`, `stickerMessage` | `image` | Картинка во всю ширину пузыря; клик -> `ImageLightbox` |
| `videoMessage` | `video` | `<video controls>` с poster из `jpegThumbnail` (base64) |
| `audioMessage` | `audio` | `<audio controls>` |
| `documentMessage` | `file` | Карточка 'иконка + имя файла + Скачать' |
| `locationMessage` | `location` | Мини-карта из растровых тайлов `tile.openstreetmap.org` (собирается через `tilesCovering` в `lib/geo.ts`, метка-пин по центру) + название + адрес + координаты; клик -> openstreetmap.org |
| `contactMessage` | `contact` | Карточка: имя + телефон + компания (парсинг `TEL:`/`ORG:` из vCard) |
| `pollMessage` | `poll` | Вопрос + варианты с radio-кружками + подсказка |
| `pollUpdateMessage` | `text` | 'Голос в опросе ... : вариант' |
| `reactionMessage` | - | Не сообщение: эмодзи к целевому сообщению |

### Медиа и файлы

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Лайтбокс | Полноэкранный просмотр картинки: fade+zoom, caption на градиенте, закрытие по Esc / клику на фон / крестик | - | `ImageLightbox.tsx` (createPortal) |
| Протухшие ссылки | `downloadUrl` из вебхуков/журнала протухает; по `onError` у img/video/audio и по клику на файловую ссылку запрашивается свежий url (один раз на рендер) | `downloadFile` | `resolveUrl` в `ChatWindow.tsx`; `refreshMediaUrl`/`refreshUrl` в `MessageBubble.tsx` |
| blob-превью исходящих | Файл виден сразу через `URL.createObjectURL` до прихода `downloadUrl` из эха | эхо `outgoingAPIMessageReceived` | `sendOutgoing`, echo-dedup в `poller.ts` |

### Диагностика инстанса

Кнопка 'i' в шапке сайдбара -> `DiagnosticsModal`. Все запросы параллельно
через `Promise.allSettled`, кнопка 'Обновить'.

| Функция | UI | API-метод(ы) | Где в коде |
|---|---|---|---|
| Профиль и состояние | Номер, stateInstance, прогресс синка истории %, устройство | `getWaSettings` | `DiagnosticsModal.tsx` |
| История состояний | Список: состояние + время + номер | `getStateInstanceHistory` (20 записей) | `DiagnosticsModal.tsx` |
| Очередь исходящих | Счётчик + список до 20 зависших (тип · chatId · содержимое) | `getMessagesCount`, `showMessagesQueue` | `DiagnosticsModal.tsx` (`queueItemText`) |
| Очистить исходящие | Кнопка с Popconfirm | `clearMessagesQueue` | `DiagnosticsModal.tsx` |
| Очередь уведомлений | Счётчик необработанных уведомлений | `getWebhooksCount` | `DiagnosticsModal.tsx` |
| Очистить уведомления | Кнопка с Popconfirm; API лимитит раз в минуту - показываем `leftTime` | `clearWebhooksQueue` | `DiagnosticsModal.tsx` |
| Перезапуск инстанса | Кнопка с Popconfirm | `reboot` | `DiagnosticsModal.tsx` |
| Разлогин инстанса | Кнопка с Popconfirm (danger); после - выход и из приложения | `logout` | `DiagnosticsModal.tsx` (`doLogout` -> `authStore.logout`) |

### Поллер и мультитаб

| Функция | UI | Механизм | Где в коде |
|---|---|---|---|
| Цикл приёма | Невидим; результат - новые сообщения/статусы | `receiveNotification?receiveTimeout=30` -> `dispatchNotification` -> `deleteNotification`; idle-сон 1 с | `pollLoop` в `poller.ts`; `useNotifications.ts` |
| Backoff и диагностика | Баннер 'Нет связи' / 'Инстанс не авторизован' | При ошибках задержка 5 с -> 60 с (x2); после 3 подряд - `getStateInstance`; 401 -> авто-logout | `pollLoop`, `diagnoseConnection` в `poller.ts` |
| Leader election | Поллит только одна вкладка | `navigator.locks.request('green-api-notifications')`; без Web Locks - прямой поллинг | `useNotifications.ts` |
| Синхронизация вкладок | Чаты и сессия консистентны во всех вкладках | `storage`-событие -> `persist.rehydrate()` для `green-api-chats` и `green-api-auth` | `useTabSync` в `useNotifications.ts` |

### UI/UX

| Функция | UI | Где в коде |
|---|---|---|
| Темы | Светлая/тёмная (палитра WhatsApp Web): CSS custom properties + `darkAlgorithm` antd; переключатель луна/солнце в шапке | `uiStore.ts`, `App.tsx` (ConfigProvider), `index.css` (`:root`, `[data-theme='dark']`) |
| Масштаб интерфейса | Меню 'Aa': Мелкий/Средний/Крупный -> `transform: scale` на `.app-shell` с компенсацией размеров | `uiStore.ts`, `App.tsx` (`data-scale`), `index.css` (`--ui-zoom`) |
| Мобильная адаптация | По `Grid.useBreakpoint().md`: либо список, либо чат; кнопка 'назад'; safe-area-insets; тултипы отключены на тачах | `App.tsx` (`isMobile`, `showList`/`showChat`); `index.css` `@media (max-width: 767px)` |
| Долгое нажатие | На тачах long-press 500 мс открывает контекстное меню; сдвиг пальца >10px отменяет; `user-select: none` при `hover: none` | `MessageBubble.tsx` (touch-хендлеры), `index.css` |
| Скролл к последнему | Плавный `scrollTo` контейнера сообщений при изменении числа сообщений | `ChatWindow.tsx` (`messagesRef`) |
| Фон-узор чата | SVG-паттерн, повёрнутый на -45 deg, `inset: -100%`, не скроллится | `index.css` (`.chat-window::before`) |
| Кастомные скроллбары | Тонкие зелёные ползунки (WebKit + Firefox) | `index.css` (`::-webkit-scrollbar`, `scrollbar-width`) |
| Разделители дат | 'Сегодня' / 'Вчера' / дата между группами сообщений | `formatMessageDate`, `isSameDay` (`format.ts`); `ChatWindow.tsx` |
| Подпись отправителя | 'Вы' / имя контакта над первым сообщением группы пузырей | `isGroupStart`, `senderLabel` в `ChatWindow.tsx`/`MessageBubble.tsx` |
| Группировка пузырей | Хвостик и отступ у первого сообщения группы | `bubble--in-tail`/`bubble--out-tail` в `index.css` |
| PWA | Устанавливается на домашний экран телефона и как десктопное приложение (кнопка 'Установить' в Chrome): `display: standalone`, theme-color #00a884, маскируемая иконка, apple-touch-icon, theme meta | `public/manifest.webmanifest`, `public/icons/*`, `index.html` |

### Хранилище

| persist-ключ | Стор | Что хранится | Фильтрация |
|---|---|---|---|
| `green-api-auth` | `authStore` | `credentials` | `connectionError` не персистится |
| `green-api-chats` | `chatStore` | чаты, сообщения, `activeChatId`, `instanceId` | `partialize` вычищает `blob:`/`data:` url и base64 thumbnails (иначе quota); миграция v2: `pending` -> `error`, нормализация chatId |
| `green-api-ui` | `uiStore` | `theme`, `scale` | - |

`instanceId` привязывает чаты к инстансу: повторный вход на тот же инстанс
сохраняет историю, вход под другим инстансом чистит список. Cap - 200
сообщений на чат (`MAX_MESSAGES_PER_CHAT`).

## Что НЕ реализовано и почему

| Фича | Почему отложено |
|---|---|
| QR-авторизация инстанса | Инстанс авторизуется в личном кабинете GREEN-API; встраивание `getQR` в приложение дублирует консоль и не входило в ТЗ |
| Управление группами (createGroup, addParticipant, права) | Группы отображаются и принимают сообщения, но администрирование - отдельный контур; `getGroupData` используется только для валидации chatId |
| Интерактивные кнопки и списки | Методы `sendButtons`/`sendListMessage` требуют платного тарифа и не покрыты UI |
| Статусы (stories) | Отдельный механизм (uploadFile + sendStatus), не пересекается с чат-флоу |
| Каталоги и товары | B2B-фича GREEN-API, вне рамок мессенджера |
| Отправка реакций | Реакции отображаются (входящие), но UI для постановки не добавлялся |
| Запись голосовых | Нет UI записи с микрофона; аудио можно отправить только как файл |
| Отправка 'recording' в sendTyping | `sendTyping` поддерживает `typingType: 'recording'`, но используется только текстовый индикатор |

## Известные ограничения

- **История чата** - только последние 100 сообщений (`getChatHistory`,
  один запрос на чат за сессию); скролл вверх не догружает более старые.
- **Журналы синка** - за 3 суток (`?minutes=4320`), лимит GREEN-API 10000
  записей; журналы звонков в бете и требуют включённых call-вебхуков.
- **downloadUrl протухает** - ссылки на файлы из вебхуков/журнала
  недолговечны; оживляются через `downloadFile` по `onError`/клику (один
  раз на рендер, чтобы не закольцовываться на мёртвых файлах).
- **Редактирование** - только свои текстовые сообщения, отправленные
  через API, в окне ~15 минут (ограничение WhatsApp); эхо-вебхука правки
  нет - флаг `edited` ставится локально.
- **Удаление** - только свои сообщения (`deleteMessage`), чужие удалить
  нельзя - только отобразить плейсхолдер по вебхуку.
- **Ретрай медиа** - возможен, только пока жив `blob:`-url сессии или
  серверный `downloadUrl`; после перезагрузки blob-ссылки вычищены
  persist-ом и контента нет.
- **Cap истории** - 200 сообщений на чат в сторе и localStorage.
- **Unread** - локальный счётчик: `unreadCount` из `getChats` применяется
  только к новым чатам, сброс - при открытии.
- **'Печатает...'** - только исходящий: GREEN-API не присылает входящий
  индикатор набора.
- **local- сообщения** недоступны для reply/forward/edit/delete - у них
  нет настоящего `idMessage`; `pending` не переживает перезагрузку
  (становится `error`).
- **Переход по цитате** - только в пределах загруженных сообщений; если
  оригинала нет и в журнале - плейсхолдер 'Сообщение'.
- **Пересылка** требует, чтобы сообщение было в журнале GREEN-API
  (нужны `incomingWebhook`/`outgoingWebhook` = yes, выставляются
  автоматически).
- **apiTokenInstance в URL** - так устроен GREEN-API; для строгих
  требований к безопасности нужен прокси-бэкенд.
- **Квота free-тарифа** - ограниченный список получателей; `checkWhatsapp`
  и проверка группы best-effort, ошибки не блокируют создание чата.
