import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isPhoneLike, toChatId } from '../lib/chatId';
import { GENERIC_TEXT } from '../lib/notifications';
import { persistStorage } from '../lib/storage';
import type { Chat, ChatMessage, MessageStatus } from '../types';

const MAX_MESSAGES_PER_CHAT = 200;

// Копия объекта без undefined-полей
function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// Статус монотонный: журнал/вебхук не должны понижать галочки
// (read не откатывается на sent). Локальный 'error' липкий - журнальный
// 'sent' не воскрешает сообщение, чья отправка уже провалилась.
const STATUS_RANK: Record<MessageStatus, number> = {
  error: -1,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

const maxStatus = (
  a?: MessageStatus,
  b?: MessageStatus,
): MessageStatus | undefined => {
  if (a === 'error') return a;
  if (!a) return b;
  if (!b) return a;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
};

// pending после перезапуска - недоставленное: вкладка могла умереть
// посреди отправки, 'отправляется' вечно вводит в заблуждение
const pendingToError = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) =>
    m.status === 'pending' ? { ...m, status: 'error' as const } : m,
  );

// blob:- и data:-ссылки не переживают перезапуск / раздувают localStorage
function stripTransient(m: ChatMessage): ChatMessage {
  const out = { ...m };
  if (out.url?.startsWith('blob:') || out.url?.startsWith('data:')) delete out.url;
  if (out.extra?.thumbnail?.startsWith('data:')) {
    out.extra = { ...out.extra, thumbnail: undefined };
  }
  if (out.quote?.thumbnail?.startsWith('data:')) {
    out.quote = { ...out.quote, thumbnail: undefined };
  }
  return out;
}

interface ChatState {
  chats: Record<string, Chat>;
  activeChatId: string | null;
  /** Инстанс GREEN-API, которому принадлежат чаты - чужой логин стирает их */
  instanceId: string | null;
  addChat: (chatId: string, title: string) => void;
  /**
   * Апсерт списка чатов (синхронизация getChats): создаёт отсутствующие,
   * у существующих улучшает phone-like заголовок. activeChatId не трогает,
   * unread выставляет только новым чатам - локальный счётчик не затираем.
   */
  mergeChats: (entries: { chatId: string; title?: string; unread?: number }[]) => void;
  setChatTitle: (chatId: string, title: string) => void;
  setChatAvatar: (chatId: string, avatar: string) => void;
  selectChat: (chatId: string | null) => void;
  addMessage: (chatId: string, message: ChatMessage, title?: string) => void;
  /** Дозагрузка истории: мержит пачку сообщений по id, сортирует по времени */
  mergeMessages: (chatId: string, messages: ChatMessage[], title?: string) => void;
  updateMessage: (
    chatId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void;
  removeMessage: (chatId: string, messageId: string) => void;
  /** Удалить чат из списка (мусорные/невалидные chatId из синка) */
  removeChat: (chatId: string) => void;
  /** Привязать чаты к инстансу: другой инстанс -> чистим всё */
  setInstance: (instanceId: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      chats: {},
      activeChatId: null,
      instanceId: null,

      addChat: (chatId, title) =>
        set((state) => ({
          chats: {
            ...state.chats,
            [chatId]: state.chats[chatId] ?? { chatId, title, messages: [] },
          },
          activeChatId: chatId,
        })),

      mergeChats: (entries) =>
        set((state) => {
          const chats = { ...state.chats };
          let changed = false;
          for (const e of entries) {
            const prev = chats[e.chatId];
            if (!prev) {
              chats[e.chatId] = {
                chatId: e.chatId,
                title: e.title || e.chatId,
                unread: e.unread,
                messages: [],
              };
              changed = true;
            } else if (e.title && isPhoneLike(prev.title) && !isPhoneLike(e.title)) {
              chats[e.chatId] = { ...prev, title: e.title };
              changed = true;
            }
          }
          return changed ? { chats } : state;
        }),

      setChatTitle: (chatId, title) =>
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          return { chats: { ...state.chats, [chatId]: { ...chat, title } } };
        }),

      setChatAvatar: (chatId, avatar) =>
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat || !avatar) return state;
          return { chats: { ...state.chats, [chatId]: { ...chat, avatar } } };
        }),

      selectChat: (chatId) =>
        set((state) => {
          const chat = state.chats[chatId ?? ''];
          return {
            activeChatId: chatId,
            chats:
              chatId && chat?.unread
                ? {
                    ...state.chats,
                    [chatId]: { ...chat, unread: 0 },
                  }
                : state.chats,
          };
        }),

      addMessage: (chatId, message, title) =>
        set((state) => {
          const chat = state.chats[chatId] ?? {
            chatId,
            title: title ?? chatId,
            messages: [],
          };
          if (chat.messages.some((m) => m.id === message.id)) {
            return state;
          }
          const isActive = state.activeChatId === chatId;
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                unread:
                  message.outgoing || isActive ? (chat.unread ?? 0) : (chat.unread ?? 0) + 1,
                messages: [...chat.messages, message].slice(-MAX_MESSAGES_PER_CHAT),
              },
            },
          };
        }),

      mergeMessages: (chatId, messages, title) =>
        set((state) => {
          const chat = state.chats[chatId] ?? {
            chatId,
            title: title ?? chatId,
            messages: [],
          };
          const byId = new Map(chat.messages.map((m) => [m.id, m]));
          for (const m of messages) {
            const prev = byId.get(m.id);
            if (!prev) {
              byId.set(m.id, m);
              continue;
            }
            // Не затираем живое сообщение пустыми полями истории:
            // extra мержим глубоко, текст-заглушку не ставим поверх реального,
            // статус - только повышаем
            const next = { ...prev, ...defined(m) };
            next.status = maxStatus(prev.status, m.status);
            if (prev.extra || m.extra) {
              next.extra = { ...prev.extra, ...defined(m.extra ?? {}) };
            }
            if (GENERIC_TEXT.has(m.text) && !GENERIC_TEXT.has(prev.text)) {
              next.text = prev.text;
            }
            byId.set(m.id, next);
          }
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                messages: [...byId.values()]
                  .sort((a, b) => a.timestamp - b.timestamp)
                  .slice(-MAX_MESSAGES_PER_CHAT),
              },
            },
          };
        }),

      updateMessage: (chatId, messageId, patch) =>
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                messages: chat.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m,
                ),
              },
            },
          };
        }),

      removeMessage: (chatId, messageId) =>
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                messages: chat.messages.filter((m) => m.id !== messageId),
              },
            },
          };
        }),

      removeChat: (chatId) =>
        set((state) => {
          if (!state.chats[chatId]) return state;
          const chats = { ...state.chats };
          delete chats[chatId];
          return {
            chats,
            activeChatId:
              state.activeChatId === chatId ? null : state.activeChatId,
          };
        }),

      setInstance: (instanceId) =>
        set((state) => {
          if (state.instanceId === instanceId) return state;
          // Легаси-данные без владельца - считаем своими, не стираем
          if (state.instanceId == null) return { instanceId };
          return { instanceId, chats: {}, activeChatId: null };
        }),

      clear: () => set({ chats: {}, activeChatId: null }),
    }),
    {
      name: 'green-api-chats',
      storage: createJSONStorage(() => persistStorage),
      // blob:/data:-ссылки не переживают перезагрузку и раздувают localStorage -
      // вычищаем при сохранении (иначе quota-превышение роняет persist целиком)
      partialize: (s) => ({
        chats: Object.fromEntries(
          Object.entries(s.chats).map(([id, chat]) => [
            id,
            { ...chat, messages: chat.messages.map(stripTransient) },
          ]),
        ),
        activeChatId: s.activeChatId,
        instanceId: s.instanceId,
      }),
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Pick<ChatState, 'chats' | 'activeChatId'>;
        const chats: Record<string, Chat> = {};
        for (const chat of Object.values(state.chats ?? {})) {
          const chatId = toChatId(chat.chatId) ?? chat.chatId;
          chats[chatId] = {
            ...chat,
            chatId,
            messages: [
              ...(chats[chatId]?.messages ?? []),
              ...pendingToError(chat.messages),
            ],
          };
        }
        return {
          ...state,
          chats,
          activeChatId:
            state.activeChatId != null
              ? (toChatId(state.activeChatId) ?? state.activeChatId)
              : null,
        };
      },
      // migrate ловит только смену версии, а pending->error нужен при каждом
      // восстановлении: иначе зависшие 'отправляется' живут вечно
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        let touched = false;
        const chats: Record<string, Chat> = {};
        for (const [id, chat] of Object.entries(state.chats)) {
          const messages = pendingToError(chat.messages);
          touched ||= messages.some(
            (m, i) => m.status !== chat.messages[i]?.status,
          );
          chats[id] = { ...chat, messages };
        }
        if (touched) useChatStore.setState({ chats });
      },
    },
  ),
);
