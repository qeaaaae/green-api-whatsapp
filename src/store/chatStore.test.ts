import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  });
});

import { useChatStore } from './chatStore';
import type { ChatMessage } from '../types';

const msg = (id: string, text = 'hi'): ChatMessage => ({
  id,
  text,
  timestamp: 1700000000,
  outgoing: false,
});

beforeEach(() => {
  useChatStore.getState().clear();
});

describe('chatStore', () => {
  it('addChat создаёт чат и делает его активным', () => {
    useChatStore.getState().addChat('1@c.us', 'User');
    const s = useChatStore.getState();
    expect(s.chats['1@c.us']!.title).toBe('User');
    expect(s.activeChatId).toBe('1@c.us');
  });

  it('addMessage дедупит по id', () => {
    const { addMessage } = useChatStore.getState();
    addMessage('1@c.us', msg('m1'));
    addMessage('1@c.us', msg('m1', 'dup'));
    expect(useChatStore.getState().chats['1@c.us']!.messages).toHaveLength(1);
  });

  it('addMessage создаёт чат для входящего, если его не было', () => {
    useChatStore.getState().addMessage('2@c.us', msg('m1'), 'Sender');
    const chat = useChatStore.getState().chats['2@c.us']!;
    expect(chat).toBeDefined();
    expect(chat.title).toBe('Sender');
    expect(chat.messages).toHaveLength(1);
  });

  it('обрезает историю до 200 сообщений', () => {
    const { addMessage } = useChatStore.getState();
    for (let i = 0; i < 205; i++) addMessage('1@c.us', msg(`m${i}`));
    const messages = useChatStore.getState().chats['1@c.us']!.messages;
    expect(messages).toHaveLength(200);
    expect(messages.at(-1)?.id).toBe('m204');
  });

  it('updateMessage патчит статус и id', () => {
    const { addMessage, updateMessage } = useChatStore.getState();
    addMessage('1@c.us', { ...msg('local-1'), outgoing: true, status: 'pending' });
    updateMessage('1@c.us', 'local-1', { id: 'srv-1', status: 'sent' });
    const m = useChatStore.getState().chats['1@c.us']!.messages[0]!;
    expect(m.id).toBe('srv-1');
    expect(m.status).toBe('sent');
  });

  it('clear сбрасывает чаты и активный чат', () => {
    useChatStore.getState().addChat('1@c.us', 'User');
    useChatStore.getState().clear();
    const s = useChatStore.getState();
    expect(s.chats).toEqual({});
    expect(s.activeChatId).toBeNull();
  });

  it('mergeChats создаёт недостающие чаты, не трогая активный', () => {
    useChatStore.getState().addChat('keep@c.us', 'Keep');
    useChatStore.getState().mergeChats([
      { chatId: '1@c.us', title: 'A', unread: 2 },
      { chatId: '2@c.us', title: 'B' },
    ]);
    const s = useChatStore.getState();
    expect(s.activeChatId).toBe('keep@c.us');
    expect(s.chats['1@c.us']!.unread).toBe(2);
    expect(s.chats['2@c.us']!.title).toBe('B');
  });

  it('mergeChats улучшает phone-like заголовок, хороший не затирает', () => {
    const { mergeChats } = useChatStore.getState();
    useChatStore.getState().addChat('1@c.us', '79991234567@c.us');
    useChatStore.getState().addChat('2@c.us', 'Мама');
    mergeChats([
      { chatId: '1@c.us', title: 'Владислав' },
      { chatId: '2@c.us', title: 'Другой' },
    ]);
    const chats = useChatStore.getState().chats;
    expect(chats['1@c.us']!.title).toBe('Владислав');
    expect(chats['2@c.us']!.title).toBe('Мама');
  });

  it('mergeChats не затирает локальный unread существующего чата', () => {
    useChatStore.getState().addChat('1@c.us', 'A');
    useChatStore.setState((s) => ({
      chats: { ...s.chats, '1@c.us': { ...s.chats['1@c.us']!, unread: 5 } },
    }));
    useChatStore.getState().mergeChats([{ chatId: '1@c.us', unread: 0 }]);
    expect(useChatStore.getState().chats['1@c.us']!.unread).toBe(5);
  });

  it('mergeMessages не понижает статус: read не откатывается на sent', () => {
    const { addMessage, mergeMessages } = useChatStore.getState();
    addMessage('1@c.us', {
      ...msg('m1'),
      outgoing: true,
      status: 'read',
    });
    mergeMessages('1@c.us', [
      { ...msg('m1'), outgoing: true, status: 'sent' },
    ]);
    expect(useChatStore.getState().chats['1@c.us']!.messages[0]!.status).toBe(
      'read',
    );
  });

  it('rehydrate переводит зависший pending в error при каждом восстановлении', async () => {
    localStorage.setItem(
      'green-api-chats',
      JSON.stringify({
        version: 2,
        state: {
          activeChatId: null,
          instanceId: null,
          chats: {
            '1@c.us': {
              chatId: '1@c.us',
              title: 'A',
              messages: [{ ...msg('m1'), status: 'pending' }],
            },
          },
        },
      }),
    );
    await useChatStore.persist.rehydrate();
    expect(useChatStore.getState().chats['1@c.us']!.messages[0]!.status).toBe(
      'error',
    );
  });

  it('mergeMessages не воскрешает удалённое: deleted липкий, текст плейсхолдер', () => {
    const { addMessage, mergeMessages } = useChatStore.getState();
    addMessage('1@c.us', { ...msg('m1'), text: 'привет' });
    useChatStore
      .getState()
      .updateMessage('1@c.us', 'm1', { deleted: true, text: 'Сообщение удалено' });
    // журнал отдаёт сообщение с исходным текстом и без флага удаления
    mergeMessages('1@c.us', [{ ...msg('m1'), text: 'привет' }]);
    const m = useChatStore.getState().chats['1@c.us']!.messages[0]!;
    expect(m.deleted).toBe(true);
    expect(m.text).toBe('Сообщение удалено');
  });

  it('mergeMessages повышает статус и оставляет error липким', () => {
    const { addMessage, mergeMessages } = useChatStore.getState();
    addMessage('1@c.us', {
      ...msg('m1'),
      outgoing: true,
      status: 'sent',
    });
    mergeMessages('1@c.us', [
      { ...msg('m1'), outgoing: true, status: 'delivered' },
    ]);
    expect(useChatStore.getState().chats['1@c.us']!.messages[0]!.status).toBe(
      'delivered',
    );
    // error после неуспешной отправки не перезаписывается журнальным sent
    useChatStore
      .getState()
      .updateMessage('1@c.us', 'm1', { status: 'error' });
    mergeMessages('1@c.us', [
      { ...msg('m1'), outgoing: true, status: 'read' },
    ]);
    expect(useChatStore.getState().chats['1@c.us']!.messages[0]!.status).toBe(
      'error',
    );
  });
});
