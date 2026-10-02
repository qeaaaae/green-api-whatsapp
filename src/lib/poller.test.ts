import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/greenApi';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import {
  dispatchNotification,
  POLL_IDLE_MS,
  pollLoop,
  type PollDeps,
} from './poller';
import type { Credentials, Notification } from '../types';

const creds: Credentials = { idInstance: '1', apiTokenInstance: 't' };
const CHAT = '79991234567@c.us';

const resetStores = () => {
  useChatStore.setState({ chats: {}, activeChatId: null });
  useAuthStore.setState({ connectionError: null });
};

beforeEach(resetStores);
afterEach(resetStores);

const incomingText = (id = 'IN1') => ({
  typeWebhook: 'incomingMessageReceived',
  idMessage: id,
  timestamp: 1000,
  senderData: { chatId: CHAT, senderName: 'Владислав' },
  messageData: {
    typeMessage: 'textMessage',
    textMessageData: { textMessage: 'привет' },
  },
});

describe('dispatchNotification', () => {
  it('входящее сообщение -> чат + unread + title из senderName', () => {
    dispatchNotification(incomingText() as Notification['body'], creds);
    const chat = useChatStore.getState().chats[CHAT]!;
    expect(chat.title).toBe('Владислав');
    expect(chat.unread).toBe(1);
    expect(chat.messages[0]!.text).toBe('привет');
  });

  it('эхо исходящего усыновляет local- сообщение, не создаёт дубль', () => {
    const store = useChatStore.getState();
    store.addChat(CHAT, CHAT);
    store.addMessage(CHAT, {
      id: 'local-abc',
      text: 'Тест',
      timestamp: 1,
      outgoing: true,
      status: 'pending',
      kind: 'text',
    });
    dispatchNotification(
      {
        typeWebhook: 'outgoingAPIMessageReceived',
        idMessage: 'REAL1',
        timestamp: 2,
        chatId: CHAT,
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'Тест' },
        },
      } as Notification['body'],
      creds,
    );
    const msgs = useChatStore.getState().chats[CHAT]!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.id).toBe('REAL1');
    expect(msgs[0]!.status).toBe('sent');
  });

  it('статус исходящего обновляет галочки', () => {
    const store = useChatStore.getState();
    store.addChat(CHAT, CHAT);
    store.addMessage(CHAT, {
      id: 'M1',
      text: 'x',
      timestamp: 1,
      outgoing: true,
      status: 'sent',
    });
    dispatchNotification(
      {
        typeWebhook: 'outgoingMessageStatus',
        chatId: CHAT,
        idMessage: 'M1',
        status: 'read',
      } as Notification['body'],
      creds,
    );
    expect(useChatStore.getState().chats[CHAT]!.messages[0]!.status).toBe('read');
  });

  it('deletedMessage -> плейсхолдер вместо текста', () => {
    const store = useChatStore.getState();
    store.addChat(CHAT, CHAT);
    store.addMessage(CHAT, {
      id: 'M9',
      text: 'секрет',
      timestamp: 1,
      outgoing: false,
      url: 'http://x',
      reaction: '👍',
    });
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        senderData: { chatId: CHAT },
        messageData: {
          typeMessage: 'deletedMessage',
          deletedMessageData: { stanzaId: 'M9' },
        },
      } as Notification['body'],
      creds,
    );
    const m = useChatStore.getState().chats[CHAT]!.messages[0]!;
    expect(m.deleted).toBe(true);
    expect(m.text).toBe('Сообщение удалено');
    expect(m.url).toBeUndefined();
    expect(m.reaction).toBeUndefined();
  });

  it('входящий ответ (quotedMessage) -> сообщение + цитата из истории', () => {
    const store = useChatStore.getState();
    store.addChat(CHAT, CHAT);
    store.addMessage(CHAT, {
      id: 'ORIG1',
      text: 'моё сообщение',
      timestamp: 1,
      outgoing: true,
    });
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q',
        timestamp: 2,
        senderData: { chatId: CHAT, senderName: 'Владислав' },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: {
            text: 'ответ',
            stanzaId: 'ORIG1',
            participant: '79990001122@c.us',
          },
        },
      } as Notification['body'],
      creds,
    );
    const m = useChatStore.getState().chats[CHAT]!.messages.at(-1)!;
    expect(m.text).toBe('ответ');
    expect(m.quote?.id).toBe('ORIG1');
    expect(m.quote?.text).toBe('моё сообщение');
    expect(m.quote?.sender).toBe('Вы');
  });

  it('quotedMessage без оригинала: participant != chatId в личке -> Вы', () => {
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q2',
        timestamp: 2,
        senderData: { chatId: CHAT, senderName: 'Владислав' },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: {
            text: 'ответ',
            stanzaId: 'LOST',
            participant: '79990001122@c.us',
          },
        },
      } as Notification['body'],
      creds,
    );
    const m = useChatStore.getState().chats[CHAT]!.messages.at(-1)!;
    expect(m.text).toBe('ответ');
    expect(m.quote?.text).toBe('Сообщение');
    expect(m.quote?.sender).toBe('Вы');
  });

  it('quotedMessage: собеседник цитирует своё - sender = его имя', () => {
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q5',
        timestamp: 2,
        senderData: { chatId: CHAT, senderName: 'Владислав' },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: {
            text: 'самоответ',
            stanzaId: 'LOST2',
            participant: CHAT,
          },
        },
      } as Notification['body'],
      creds,
    );
    const q = useChatStore.getState().chats[CHAT]!.messages.at(-1)!.quote;
    expect(q?.sender).toBe('Владислав');
  });

  it('полная цитата (quotedMessage-поле) с jid participant нормализуется в Вы', () => {
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q6',
        timestamp: 2,
        senderData: { chatId: CHAT, senderName: 'Владислав' },
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: { text: 'реакцию видно?' },
          quotedMessage: {
            stanzaId: 'LOST3',
            participant: '79539833990@c.us',
            typeMessage: 'textMessage',
            textMessage: 'тест123',
          },
        },
      } as Notification['body'],
      creds,
    );
    const q = useChatStore.getState().chats[CHAT]!.messages.at(-1)!.quote;
    expect(q?.text).toBe('тест123');
    expect(q?.sender).toBe('Вы');
  });

  it('quotedMessage вне истории -> догрузка через fetchMessage патчит цитату', async () => {
    const fetchMessage = vi.fn(async () => ({
      type: 'outgoing' as const,
      idMessage: 'LOST',
      timestamp: 1,
      typeMessage: 'textMessage',
      chatId: CHAT,
      textMessage: 'оригинал из журнала',
    }));
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q3',
        timestamp: 2,
        senderData: { chatId: CHAT, senderName: 'Владислав' },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: { text: 'ответ', stanzaId: 'LOST' },
        },
      } as Notification['body'],
      creds,
      { fetchMessage },
    );
    const get = () =>
      useChatStore.getState().chats[CHAT]!.messages.at(-1)!.quote;
    // сразу - плейсхолдер
    expect(get()?.text).toBe('Сообщение');
    expect(fetchMessage).toHaveBeenCalledWith(creds, CHAT, 'LOST');
    await vi.waitFor(() => expect(get()?.text).toBe('оригинал из журнала'));
    expect(get()?.sender).toBe('Вы');
  });

  it('без fetchMessage удалённая догрузка цитаты не выполняется', () => {
    dispatchNotification(
      {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'IN-Q4',
        timestamp: 2,
        senderData: { chatId: CHAT },
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: { text: 'ответ', stanzaId: 'LOST' },
        },
      } as Notification['body'],
      creds,
    );
    expect(
      useChatStore.getState().chats[CHAT]!.messages.at(-1)!.quote?.text,
    ).toBe('Сообщение');
  });

  it('quotaExceeded -> баннер связи', () => {
    dispatchNotification(
      { typeWebhook: 'quotaExceeded' } as Notification['body'],
      creds,
    );
    expect(useAuthStore.getState().connectionError).toContain('тариф');
  });
});

// Останавливаем цикл, когда очередь приёмов исчерпана
function makeDeps(overrides: Partial<PollDeps> = {}) {
  const queue: (Notification | null)[] = [];
  const sleeps: number[] = [];
  let stopped = false;
  const deps: PollDeps = {
    creds,
    isStopped: () => stopped,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    receive: vi.fn(async () => {
      const n = queue.shift();
      if (n === undefined) stopped = true;
      return n ?? null;
    }),
    acknowledge: vi.fn(async () => ({})),
    ...overrides,
  };
  // Остановка после N вызовов receive - для тестов со своим receive
  const receiveStopAfter = (wrapped: PollDeps['receive'], n: number) => {
    let calls = 0;
    return async (c: Credentials) => {
      calls += 1;
      if (calls >= n) stopped = true;
      return wrapped(c);
    };
  };
  return { deps, queue, sleeps, receiveStopAfter };
}

const notif = (receiptId: number): Notification => ({
  receiptId,
  body: incomingText(`IN${receiptId}`) as Notification['body'],
});

describe('pollLoop', () => {
  it('принимает уведомление -> dispatch + ack по receiptId', async () => {
    const { deps, queue } = makeDeps();
    queue.push(notif(7));
    await pollLoop(deps);
    expect(useChatStore.getState().chats[CHAT]!.messages[0]!.id).toBe('IN7');
    expect(deps.acknowledge).toHaveBeenCalledWith(creds, 7);
  });

  it('пустой ответ -> idle-сон 1с и продолжение', async () => {
    const { deps, queue, sleeps } = makeDeps();
    queue.push(null, notif(1));
    await pollLoop(deps);
    expect(sleeps).toContain(POLL_IDLE_MS);
  });

  it('ошибки -> экспоненциальный backoff 5с -> 10с -> 20с', async () => {
    const { deps, sleeps, receiveStopAfter } = makeDeps({
      diagnose: vi.fn(async () => 'нет связи'),
    });
    deps.receive = receiveStopAfter(
      vi.fn(async (): Promise<Notification | null> => {
        throw new Error('net');
      }),
      4,
    );
    await pollLoop(deps);
    expect(sleeps.slice(0, 3)).toEqual([5000, 10000, 20000]);
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  it('серия ошибок -> диагностика, успех -> баннер гаснет и backoff сбрасывается', async () => {
    const diagnose = vi.fn(async () => 'нет связи');
    const { deps, sleeps, receiveStopAfter } = makeDeps({ diagnose });
    const receive = vi
      .fn<() => Promise<Notification | null>>()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValueOnce(notif(1))
      .mockRejectedValueOnce(new Error('x'));
    deps.receive = receiveStopAfter(receive, 6);
    await pollLoop(deps);
    expect(diagnose).toHaveBeenCalledOnce();
    // сон после успешного приёма - backoff вернулся к 5с, а не продолжил ×2
    // (последний сон - idle 1с от пустого ответа при остановке)
    expect(sleeps.slice(0, 4)).toEqual([5000, 10000, 20000, 5000]);
    expect(useAuthStore.getState().connectionError).toBeNull();
  });

  it('битое уведомление (dispatch падает) всё равно подтверждается, очередь едет дальше', async () => {
    const { deps, queue } = makeDeps({
      dispatch: vi.fn(() => {
        throw new Error('broken mapper');
      }),
    });
    queue.push(notif(1), notif(2));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pollLoop(deps);
    err.mockRestore();
    // Оба уведомления подтверждены - poison не застрял в очереди
    expect(deps.acknowledge).toHaveBeenCalledWith(creds, 1);
    expect(deps.acknowledge).toHaveBeenCalledWith(creds, 2);
  });

  it('401 -> logout и остановка цикла', async () => {
    const onUnauthorized = vi.fn();
    const { deps, sleeps } = makeDeps({
      receive: vi.fn(async () => {
        throw new ApiError(401, 'unauthorized');
      }),
      onUnauthorized,
    });
    await pollLoop(deps);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(sleeps).toHaveLength(0);
  });
});
