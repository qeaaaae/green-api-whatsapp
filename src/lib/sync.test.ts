import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CallJournalItem,
  ChatListItem,
  JournalMessage,
} from '../api/greenApi';
import { useChatStore } from '../store/chatStore';
import { mapCallJournal, syncAccountChats } from './sync';
import type { Credentials } from '../types';

const credsOf = (id: string): Credentials => ({
  idInstance: id,
  apiTokenInstance: 't',
});

const CHAT = '79991234567@c.us';

const journalText = (
  id: string,
  overrides: Partial<JournalMessage> = {},
): JournalMessage => ({
  type: 'incoming',
  idMessage: id,
  timestamp: 1700000000,
  typeMessage: 'textMessage',
  chatId: CHAT,
  senderName: 'Владислав',
  textMessage: 'привет',
  ...overrides,
});

const emptyDeps = {
  fetchChats: vi.fn(async () => []),
  fetchIncoming: vi.fn(async () => []),
  fetchOutgoing: vi.fn(async () => []),
  fetchIncomingCalls: vi.fn(async () => []),
  fetchOutgoingCalls: vi.fn(async () => []),
};

beforeEach(() => {
  useChatStore.setState({ chats: {}, activeChatId: null });
});

describe('mapCallJournal', () => {
  it('пропущенный входящий -> красная карточка', () => {
    const mapped = mapCallJournal({
      idMessage: 'C1',
      timestamp: 1,
      typeMessage: 'incomingCall',
      chatId: CHAT,
      status: 'missed',
    });
    expect(mapped?.message.text).toBe('Пропущенный звонок');
    expect(mapped?.message.outgoing).toBe(false);
    expect(mapped?.message.extra?.callStatus).toBe('missed');
  });

  it('принятый входящий с длительностью -> "Входящий звонок · 1:23"', () => {
    const mapped = mapCallJournal({
      idMessage: 'C2',
      timestamp: 1,
      typeMessage: 'incomingCall',
      chatId: CHAT,
      status: 'pickUp',
      duration: 83,
    });
    expect(mapped?.message.text).toBe('Входящий звонок · 1:23');
  });

  it('исходящий invalid -> "Звонок не состоялся" со стилем пропущенного', () => {
    const mapped = mapCallJournal({
      idMessage: 'C3',
      timestamp: 1,
      typeMessage: 'outgoingCall',
      chatId: '1@g.us',
      status: 'invalid',
    });
    expect(mapped?.message.text).toBe('Звонок не состоялся');
    expect(mapped?.message.outgoing).toBe(true);
    expect(mapped?.message.extra?.callStatus).toBe('declined');
  });

  it('без idMessage/chatId/timestamp -> null', () => {
    expect(
      mapCallJournal({ typeMessage: 'incomingCall', status: 'pickUp' }),
    ).toBeNull();
    expect(
      mapCallJournal({
        idMessage: 'C',
        timestamp: 1,
        typeMessage: 'incomingCall',
      }),
    ).toBeNull();
  });
});

describe('syncAccountChats', () => {
  it('getChats создаёт чаты с именем и unread', async () => {
    await syncAccountChats(credsOf('i-sync1'), {
      ...emptyDeps,
      fetchChats: vi.fn(async (): Promise<ChatListItem[]> => [
        { id: CHAT, name: 'Владислав', type: 'user', unreadCount: 3 },
        { id: '1@g.us', name: 'Группа', type: 'group' },
      ]),
    });
    const chats = useChatStore.getState().chats;
    expect(chats[CHAT]!.title).toBe('Владислав');
    expect(chats[CHAT]!.unread).toBe(3);
    expect(chats['1@g.us']!.title).toBe('Группа');
    // sync не должен трогать активный чат
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it('журналы сообщений мержатся в чаты с именем отправителя', async () => {
    await syncAccountChats(credsOf('i-sync2'), {
      ...emptyDeps,
      fetchIncoming: vi.fn(async () => [
        journalText('J1'),
        journalText('J2', { textMessage: 'как дела', timestamp: 1700000001 }),
      ]),
      fetchOutgoing: vi.fn(async () => [
        journalText('J3', {
          type: 'outgoing',
          timestamp: 1700000002,
          textMessage: 'норм',
          statusMessage: 'read',
        }),
      ]),
    });
    const chat = useChatStore.getState().chats[CHAT]!;
    expect(chat.title).toBe('Владислав');
    expect(chat.messages.map((m) => m.id)).toEqual(['J1', 'J2', 'J3']);
    expect(chat!.messages[2]!.outgoing).toBe(true);
    expect(chat!.messages[2]!.status).toBe('read');
  });

  it('журналы звонков -> карточки в чатах', async () => {
    await syncAccountChats(credsOf('i-sync3'), {
      ...emptyDeps,
      fetchIncomingCalls: vi.fn(async () => [
        {
          idMessage: 'C1',
          timestamp: 1700000000,
          typeMessage: 'incomingCall',
          chatId: CHAT,
          status: 'declined',
        } satisfies CallJournalItem,
      ]),
    });
    const m = useChatStore.getState().chats[CHAT]!.messages[0]!;
    expect(m.kind).toBe('call');
    expect(m.text).toBe('Пропущенный звонок');
  });

  it('один раз на инстанс за сессию - повторный вызов ничего не делает', async () => {
    const fetchChats = vi.fn(async () => [{ id: CHAT, name: 'A' }]);
    await syncAccountChats(credsOf('i-sync4'), { ...emptyDeps, fetchChats });
    await syncAccountChats(credsOf('i-sync4'), { ...emptyDeps, fetchChats });
    expect(fetchChats).toHaveBeenCalledOnce();
  });

  it('полный отвал API -> синхронизацию можно повторить', async () => {
    const failing = {
      fetchChats: vi.fn(async () => {
        throw new Error('net');
      }),
      fetchIncoming: vi.fn(async () => {
        throw new Error('net');
      }),
      fetchOutgoing: vi.fn(async () => {
        throw new Error('net');
      }),
      fetchIncomingCalls: vi.fn(async () => {
        throw new Error('net');
      }),
      fetchOutgoingCalls: vi.fn(async () => {
        throw new Error('net');
      }),
    };
    await syncAccountChats(credsOf('i-sync5'), failing);
    expect(useChatStore.getState().chats).toEqual({});
    const fetchChats = vi.fn(async () => [{ id: CHAT, name: 'A' }]);
    await syncAccountChats(credsOf('i-sync5'), { ...emptyDeps, fetchChats });
    expect(fetchChats).toHaveBeenCalledOnce();
    expect(useChatStore.getState().chats[CHAT]).toBeDefined();
  });

  it('мусорные chatId (0@c.us) из getChats и журналов фильтруются', async () => {
    await syncAccountChats(credsOf('i-sync7'), {
      ...emptyDeps,
      fetchChats: vi.fn(async (): Promise<ChatListItem[]> => [
        { id: '0@c.us', name: 'System' },
        { id: CHAT, name: 'Владислав' },
      ]),
      fetchIncoming: vi.fn(async () => [
        journalText('J1'),
        journalText('J-BAD', { chatId: '0@c.us' }),
      ]),
    });
    const chats = useChatStore.getState().chats;
    expect(chats['0@c.us']).toBeUndefined();
    expect(chats[CHAT]!.messages[0]!.id).toBe('J1');
  });

  it('уже заведённый невалидный чат вычищается при синке', async () => {
    useChatStore.getState().addChat('0@c.us', '0@c.us');
    await syncAccountChats(credsOf('i-sync8'), emptyDeps);
    expect(useChatStore.getState().chats['0@c.us']).toBeUndefined();
  });

  it('частичный отвал (упал только журнал звонков) не ломает остальное', async () => {
    await syncAccountChats(credsOf('i-sync6'), {
      ...emptyDeps,
      fetchIncoming: vi.fn(async () => [journalText('J1')]),
      fetchIncomingCalls: vi.fn(async () => {
        throw new Error('beta off');
      }),
      fetchOutgoingCalls: vi.fn(async () => {
        throw new Error('beta off');
      }),
    });
    const chat = useChatStore.getState().chats[CHAT]!;
    expect(chat.messages[0]!.id).toBe('J1');
  });
});
