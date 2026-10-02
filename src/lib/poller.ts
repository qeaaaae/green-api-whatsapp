import { ApiError, getMessage, getStateInstance, type JournalMessage } from '../api/greenApi';
import {
  mapCall,
  mapDeletedMessage,
  mapEditedMessage,
  mapIncomingMessage,
  mapOutgoingMessage,
  mapOutgoingStatus,
  mapReaction,
  mapServiceNotice,
  quoteSenderLabel,
} from './notifications';
import { isPhoneLike } from './chatId';
import { ensureChatTitle } from './chatTitle';
import { toMessage } from './history';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import type { ChatMessage, Credentials, Notification } from '../types';

type Body = Notification['body'];

/** getMessage для догрузки цитаты - инъектируется из pollLoop для тестов */
export type QuoteFetcher = (
  creds: Credentials,
  chatId: string,
  idMessage: string,
) => Promise<JournalMessage>;

// Оригинал цитаты не в загруженной истории - спрашиваем его у журнала
// по stanzaId и патчим плейсхолдер настоящим текстом
async function resolveQuoteRemote(
  fetcher: QuoteFetcher,
  creds: Credentials,
  chatId: string,
  messageId: string,
  stanzaId: string,
): Promise<void> {
  try {
    const orig = toMessage(await fetcher(creds, chatId, stanzaId));
    if (!orig) return;
    const store = useChatStore.getState();
    const cur = store.chats[chatId]?.messages.find((x) => x.id === messageId);
    if (!cur?.quote) return;
    store.updateMessage(chatId, messageId, {
      quote: {
        ...cur.quote,
        text: orig.deleted
          ? 'Сообщение удалено'
          : orig.text || cur.quote.text,
        sender: orig.outgoing ? 'Вы' : (orig.senderName ?? cur.quote.sender),
        thumbnail:
          cur.quote.thumbnail ??
          (orig.kind === 'image' || orig.kind === 'video'
            ? (orig.extra?.thumbnail ?? orig.url)
            : undefined),
      },
    });
  } catch {
    // stanzaId может не найтись в журнале - остаётся плейсхолдер 'Сообщение'
  }
}

// У typeMessage='quotedMessage' GREEN-API присылает лишь stanzaId/participant:
// текст и автора оригинала подтягиваем из уже загруженной истории чата,
// а если там нет - асинхронно через getMessage
function enrichQuote(
  chatId: string,
  m: ChatMessage,
  creds: Credentials,
  fetchQuote?: QuoteFetcher,
): void {
  const q = m.quote;
  if (!q?.id) return;
  const store = useChatStore.getState();
  const chat = store.chats[chatId];
  const orig = chat?.messages.find((x) => x.id === q.id);
  if (orig) {
    q.text = orig.deleted ? 'Сообщение удалено' : orig.text;
    q.sender = orig.outgoing
      ? 'Вы'
      : (orig.senderName ?? quoteSenderLabel(q.sender, chatId, chat?.title));
    if (!q.thumbnail && (orig.kind === 'image' || orig.kind === 'video')) {
      q.thumbnail = orig.extra?.thumbnail ?? orig.url;
    }
    return;
  }
  // Оригинала в истории нет - нормализуем sender даже если текст уже есть
  q.sender = quoteSenderLabel(q.sender, chatId, m.senderName ?? chat?.title);
  if (!q.text) {
    q.text = 'Сообщение';
    if (fetchQuote) void resolveQuoteRemote(fetchQuote, creds, chatId, m.id, q.id);
  }
}

export const POLL_IDLE_MS = 1000;
export const POLL_ERROR_MS = 5000;
export const POLL_ERROR_MAX_MS = 60_000;
const ERRORS_BEFORE_STATE_CHECK = 3;

/**
 * Раскладывает тело уведомления по сторам: сообщения, статусы, реакции,
 * правки, удаления, звонки, сервисные события. Чистая логика без React -
 * вызывается из цикла поллинга и покрыта тестами.
 */
export interface DispatchDeps {
  /** Догрузка оригинала цитаты по stanzaId через журнал (getMessage) */
  fetchMessage?: QuoteFetcher;
}

export function dispatchNotification(
  body: Body,
  creds: Credentials,
  deps: DispatchDeps = {},
): void {
  const incoming = mapIncomingMessage(body);
  if (incoming) {
    const store = useChatStore.getState();
    enrichQuote(incoming.chatId, incoming.message, creds, deps.fetchMessage);
    store.addMessage(incoming.chatId, incoming.message, incoming.title);
    const senderName = incoming.message.senderName;
    const chatTitle = store.chats[incoming.chatId]?.title;
    // Имя отправителя из уведомления лучше голого номера в заголовке
    if (senderName && chatTitle && isPhoneLike(chatTitle)) {
      store.setChatTitle(incoming.chatId, senderName);
    }
    // Если имени нет ни в уведомлении, ни в заголовке - пробуем getContactInfo
    if (!senderName) {
      void ensureChatTitle(creds, incoming.chatId);
    }
  }

  // Эхо нашего исходящего сообщения (API или с телефона):
  // если уже есть - дописывает url файла, если нет - добавляет
  const outgoing = mapOutgoingMessage(body);
  if (outgoing) {
    enrichQuote(outgoing.chatId, outgoing.message, creds, deps.fetchMessage);
    const store = useChatStore.getState();
    const msgs = store.chats[outgoing.chatId]?.messages ?? [];
    // Эхо может прийти раньше, чем резолвится sendXxx - тогда локальное
    // сообщение ещё с local- id и дедуп по id создаст дубль.
    // Находим локальный пузырь того же вида и усыновляем: id + url из эха.
    // Два быстрых исходящих одного вида - усыновляем именно своё эхо
    // (матчим по тексту/имени файла), иначе чужой пузырь получит id/url
    const sameKind = (m: ChatMessage) =>
      m.outgoing &&
      m.id.startsWith('local-') &&
      (m.kind ?? 'text') === (outgoing.message.kind ?? 'text');
    const local =
      msgs.find((m) => sameKind(m) && m.text === outgoing.message.text) ??
      msgs.find(sameKind);
    if (local) {
      // blob:-превью заменяется настоящим downloadUrl - память отпускаем
      if (outgoing.message.url && local.url?.startsWith('blob:')) {
        URL.revokeObjectURL(local.url);
      }
      const patch: Partial<ChatMessage> = {
        id: outgoing.message.id,
        status: 'sent',
      };
      if (outgoing.message.url) patch.url = outgoing.message.url;
      if (outgoing.message.quote && !local.quote) patch.quote = outgoing.message.quote;
      store.updateMessage(outgoing.chatId, local.id, patch);
    } else {
      store.addMessage(outgoing.chatId, outgoing.message);
    }
  }

  // Реакция на сообщение
  const reaction = mapReaction(body);
  if (reaction) {
    useChatStore.getState().updateMessage(reaction.chatId, reaction.messageId, {
      reaction: reaction.emoji || undefined,
    });
  }

  const statusUpdate = mapOutgoingStatus(body);
  if (statusUpdate) {
    useChatStore
      .getState()
      .updateMessage(statusUpdate.chatId, statusUpdate.idMessage, {
        status: statusUpdate.status,
      });
  }

  // Правка сообщения (своего или собеседника)
  const edited = mapEditedMessage(body);
  if (edited) {
    useChatStore.getState().updateMessage(edited.chatId, edited.messageId, {
      text: edited.text,
      edited: true,
    });
  }

  // Сообщение удалено у всех - оставляем плейсхолдер
  const deleted = mapDeletedMessage(body);
  if (deleted) {
    useChatStore.getState().updateMessage(deleted.chatId, deleted.messageId, {
      deleted: true,
      text: 'Сообщение удалено',
      url: undefined,
      extra: undefined,
      quote: undefined,
      reaction: undefined,
    });
  }

  // Звонок - карточка в чате (offer пропускаем в маппере)
  const call = mapCall(body);
  if (call) {
    useChatStore.getState().addMessage(call.chatId, call.message, call.title);
  }

  // Квота/состояние инстанса -> баннер связи
  const notice = mapServiceNotice(body);
  if (notice) {
    useAuthStore.getState().setConnectionError(notice);
  } else if (
    body.typeWebhook === 'stateInstanceChanged' &&
    body.stateInstance === 'authorized'
  ) {
    useAuthStore.getState().setConnectionError(null);
  }
}

// Диагностика: инстанс не авторизован или просто нет связи?
async function diagnoseConnection(creds: Credentials): Promise<string> {
  try {
    const { stateInstance } = await getStateInstance(creds);
    return stateInstance === 'authorized'
      ? 'Нет связи с GREEN-API - переподключаемся...'
      : `Инстанс не авторизован (${stateInstance}). Отсканируйте QR-код в личном кабинете GREEN-API.`;
  } catch {
    return 'Нет связи с GREEN-API - переподключаемся...';
  }
}

export interface PollDeps {
  creds: Credentials;
  /** Разрешать ли продолжать цикл - false = остановка (unmount/abort) */
  isStopped: () => boolean;
  /** Sleep, прерываемый остановкой */
  sleep: (ms: number) => Promise<void>;
  /** Дальше - инъектируемые для тестов вызовы API */
  receive: (
    creds: Credentials,
  ) => Promise<Notification | null>;
  acknowledge: (creds: Credentials, receiptId: number) => Promise<unknown>;
  /** Диагностика при серии ошибок; возвращает текст для баннера */
  diagnose?: (creds: Credentials) => Promise<string>;
  /** Догрузка оригинала цитаты (getMessage); по умолчанию - реальный API */
  fetchMessage?: QuoteFetcher;
  /** Диспатч уведомления в сторы - инъектируется в тестах */
  dispatch?: (body: Body, creds: Credentials, deps: DispatchDeps) => void;
  onUnauthorized?: () => void;
}

/**
 * Цикл receiveNotification -> dispatchNotification -> deleteNotification.
 * Idle-сон 1с, экспоненциальный backoff на ошибках до 60с, после
 * ERRORS_BEFORE_STATE_CHECK подряд - диагностика состояния инстанса.
 * 401 - разлогин и выход из цикла.
 */
export async function pollLoop(deps: PollDeps): Promise<void> {
  const { creds, isStopped, sleep, receive, acknowledge } = deps;
  const diagnose = deps.diagnose ?? diagnoseConnection;
  const onUnauthorized = deps.onUnauthorized ?? useAuthStore.getState().logout;
  const fetchMessage = deps.fetchMessage ?? getMessage;
  const dispatch = deps.dispatch ?? dispatchNotification;
  let consecutiveErrors = 0;
  let errorDelayMs = POLL_ERROR_MS;

  while (!isStopped()) {
    try {
      const notification = await receive(creds);
      if (consecutiveErrors > 0) {
        consecutiveErrors = 0;
        errorDelayMs = POLL_ERROR_MS;
        useAuthStore.getState().setConnectionError(null);
      }
      if (!notification) {
        await sleep(POLL_IDLE_MS);
        continue;
      }
      // Dispatch отделён от ack: исключение в маппере не должно
      // блокировать очередь - иначе одно битое уведомление будет
      // возвращаться receiveNotification вечно и похоронит остальные
      try {
        dispatch(notification.body, creds, { fetchMessage });
      } catch (dispatchError) {
        console.error('dispatchNotification failed', dispatchError);
      }
      await acknowledge(creds, notification.receiptId);
    } catch (error) {
      if (isStopped()) return;
      // Токен/инстанс невалидны - дальше нет смысла, разлогиниваем
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= ERRORS_BEFORE_STATE_CHECK) {
        useAuthStore.getState().setConnectionError(await diagnose(creds));
      }
      if (isStopped()) return;
      await sleep(errorDelayMs);
      errorDelayMs = Math.min(errorDelayMs * 2, POLL_ERROR_MAX_MS);
    }
  }
}
