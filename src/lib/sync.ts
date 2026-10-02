import {
  getChats,
  lastIncomingCalls,
  lastIncomingMessages,
  lastOutgoingCalls,
  lastOutgoingMessages,
  type CallJournalItem,
  type ChatListItem,
  type JournalMessage,
} from '../api/greenApi';
import { useChatStore } from '../store/chatStore';
import { isSendableChatId } from './chatId';
import { formatDuration } from './format';
import { toMessage } from './history';
import { callLabel, normalizeCallStatus } from './notifications';
import type { ChatMessage, Credentials } from '../types';

// Журналы по умолчанию отдают последние 24ч - для холодного старта мало,
// берём 3 суток (лимит GREEN-API - 10000 записей)
const SYNC_MINUTES = 4320;

export interface SyncDeps {
  creds: Credentials;
  fetchChats?: (creds: Credentials) => Promise<ChatListItem[]>;
  fetchIncoming?: (creds: Credentials) => Promise<JournalMessage[]>;
  fetchOutgoing?: (creds: Credentials) => Promise<JournalMessage[]>;
  fetchIncomingCalls?: (creds: Credentials) => Promise<CallJournalItem[]>;
  fetchOutgoingCalls?: (creds: Credentials) => Promise<CallJournalItem[]>;
}

/** Запись журнала звонков -> карточка звонка (текст + missed-статус для стиля) */
export function mapCallJournal(
  c: CallJournalItem,
): { chatId: string; message: ChatMessage } | null {
  if (!c.idMessage || !c.timestamp || !c.chatId) return null;
  const outgoing = c.typeMessage === 'outgoingCall';
  const label = callLabel(c.status, outgoing);
  return {
    chatId: c.chatId,
    message: {
      id: c.idMessage,
      timestamp: c.timestamp,
      outgoing,
      kind: 'call',
      text: c.duration ? `${label} · ${formatDuration(c.duration)}` : label,
      extra: { callStatus: normalizeCallStatus(c.status) },
    },
  };
}

const synced = new Set<string>();

/**
 * Первичная синхронизация аккаунта при входе: список чатов (getChats,
 * с unreadCount), последние сообщения обоих направлений и журналы звонков.
 * Частичные ошибки (один метод упал) не валят остальные. Один раз на
 * инстанс за сессию; при сетевой ошибке повтор разрешён.
 */
export async function syncAccountChats(
  creds: Credentials,
  deps: Omit<SyncDeps, 'creds'> = {},
): Promise<void> {
  const key = creds.idInstance;
  if (synced.has(key)) return;
  synced.add(key);

  const f = {
    fetchChats: deps.fetchChats ?? getChats,
    fetchIncoming:
      deps.fetchIncoming ?? ((c: Credentials) => lastIncomingMessages(c, SYNC_MINUTES)),
    fetchOutgoing:
      deps.fetchOutgoing ?? ((c: Credentials) => lastOutgoingMessages(c, SYNC_MINUTES)),
    fetchIncomingCalls:
      deps.fetchIncomingCalls ?? ((c: Credentials) => lastIncomingCalls(c, SYNC_MINUTES)),
    fetchOutgoingCalls:
      deps.fetchOutgoingCalls ?? ((c: Credentials) => lastOutgoingCalls(c, SYNC_MINUTES)),
  };

  const [chatsR, incomingR, outgoingR, inCallsR, outCallsR] =
    await Promise.allSettled([
      f.fetchChats(creds),
      f.fetchIncoming(creds),
      f.fetchOutgoing(creds),
      f.fetchIncomingCalls(creds),
      f.fetchOutgoingCalls(creds),
    ]);

  const ok = <T,>(r: PromiseSettledResult<T[]>): T[] =>
    r.status === 'fulfilled' ? r.value : [];
  const allFailed = [chatsR, incomingR, outgoingR, inCallsR, outCallsR].every(
    (r) => r.status === 'rejected',
  );
  // Полный отвал (нет сети) - снимаем флаг, чтобы при следующем входе повторить
  if (allFailed) synced.delete(key);

  const store = useChatStore.getState();

  // GREEN-API присылает в getChats/журналах служебные id вроде '0@c.us',
  // которые сам же не принимает в send-методах - фильтруем и заодно
  // вычищаем уже заведённые мусорные чаты
  store.mergeChats(
    ok(chatsR)
      .map((c) => {
        const chatId =
          c.newChatId && isSendableChatId(c.newChatId) ? c.newChatId : c.id;
        return { chatId, title: c.name || chatId, unread: c.unreadCount };
      })
      .filter((c) => c.chatId && isSendableChatId(c.chatId)),
  );
  for (const id of Object.keys(store.chats)) {
    if (!isSendableChatId(id)) store.removeChat(id);
  }

  const byChat = new Map<string, ChatMessage[]>();
  const titles = new Map<string, string>();
  for (const j of [...ok(incomingR), ...ok(outgoingR)]) {
    if (!j.chatId || !isSendableChatId(j.chatId)) continue;
    const m = toMessage(j);
    if (!m) continue;
    const list = byChat.get(j.chatId) ?? [];
    list.push(m);
    byChat.set(j.chatId, list);
    const sender = j.senderContactName ?? j.senderName;
    if (sender && !titles.has(j.chatId)) titles.set(j.chatId, sender);
  }
  for (const [chatId, messages] of byChat) {
    store.mergeMessages(chatId, messages, titles.get(chatId));
  }

  for (const c of [...ok(inCallsR), ...ok(outCallsR)]) {
    const mapped = mapCallJournal(c);
    if (mapped && isSendableChatId(mapped.chatId)) {
      store.mergeMessages(mapped.chatId, [mapped.message]);
    }
  }
}
