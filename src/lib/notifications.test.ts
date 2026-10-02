import { describe, expect, it } from 'vitest';
import type { Notification } from '../types';
import {
  mapCall,
  mapDeletedMessage,
  mapEditedMessage,
  mapIncomingMessage,
  mapOutgoingMessage,
  mapServiceNotice,
} from './notifications';

type Body = Notification['body'];

describe('isForwarded', () => {
  it('входящее: isForwarded из extendedTextMessageData -> forwarded: true', () => {
    const body = {
      typeWebhook: 'incomingMessageReceived',
      idMessage: 'IN1',
      timestamp: 1000,
      senderData: { chatId: '79991234567@c.us', senderName: 'Владислав' },
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: {
          text: 'смотри',
          isForwarded: true,
          forwardingScore: 4,
        },
      },
    } as Body;
    const msg = mapIncomingMessage(body);
    expect(msg?.message.forwarded).toBe(true);
    expect(msg?.message.text).toBe('смотри');
  });

  it('исходящее эхо: isForwarded из fileMessageData -> forwarded: true', () => {
    const body = {
      typeWebhook: 'outgoingMessageReceived',
      idMessage: 'OUT1',
      timestamp: 1000,
      chatId: '79991234567@c.us',
      messageData: {
        typeMessage: 'imageMessage',
        fileMessageData: {
          downloadUrl: 'https://files.example/1.jpg',
          caption: '',
          fileName: '1.jpg',
          isForwarded: true,
        },
      },
    } as Body;
    expect(mapOutgoingMessage(body)?.message.forwarded).toBe(true);
  });

  it('обычное сообщение без флага -> forwarded: undefined', () => {
    const body = {
      typeWebhook: 'incomingMessageReceived',
      idMessage: 'IN2',
      timestamp: 1000,
      senderData: { chatId: '79991234567@c.us' },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: { textMessage: 'привет' },
      },
    } as Body;
    expect(mapIncomingMessage(body)?.message.forwarded).toBeUndefined();
  });
});

describe('mapEditedMessage', () => {
  it('маппит входящую правку: chatId + stanzaId + новый текст', () => {
    const body = {
      typeWebhook: 'incomingMessageReceived',
      senderData: { chatId: '79991234567@c.us' },
      messageData: {
        typeMessage: 'editedMessage',
        editedMessageData: { textMessage: 'новый текст', stanzaId: 'MSG1' },
      },
    } as Body;
    expect(mapEditedMessage(body)).toEqual({
      chatId: '79991234567@c.us',
      messageId: 'MSG1',
      text: 'новый текст',
    });
  });

  it('маппит правку исходящего сообщения (chatId на верхнем уровне)', () => {
    const body = {
      typeWebhook: 'outgoingMessageReceived',
      chatId: '79991234567@c.us',
      messageData: {
        typeMessage: 'editedMessage',
        editedMessageData: { textMessage: 'fixed', stanzaId: 'MSG2' },
      },
    } as Body;
    expect(mapEditedMessage(body)).toEqual({
      chatId: '79991234567@c.us',
      messageId: 'MSG2',
      text: 'fixed',
    });
  });

  it('игнорирует обычные сообщения и чужие вебхуки', () => {
    expect(
      mapEditedMessage({
        typeWebhook: 'incomingMessageReceived',
        messageData: { typeMessage: 'textMessage' },
      } as Body),
    ).toBeNull();
    expect(
      mapEditedMessage({
        typeWebhook: 'outgoingMessageStatus',
        messageData: { typeMessage: 'editedMessage' },
      } as Body),
    ).toBeNull();
  });
});

describe('mapDeletedMessage', () => {
  it('маппит удалённое сообщение по stanzaId', () => {
    const body = {
      typeWebhook: 'incomingMessageReceived',
      senderData: { chatId: '79991234567@c.us' },
      messageData: {
        typeMessage: 'deletedMessage',
        deletedMessageData: { stanzaId: 'MSG9' },
      },
    } as Body;
    expect(mapDeletedMessage(body)).toEqual({
      chatId: '79991234567@c.us',
      messageId: 'MSG9',
    });
  });

  it('игнорирует не-удаления', () => {
    expect(
      mapDeletedMessage({
        typeWebhook: 'incomingMessageReceived',
        messageData: { typeMessage: 'textMessage' },
      } as Body),
    ).toBeNull();
  });
});

describe('mapCall', () => {
  it('offer не создаёт карточку (промежуточный статус)', () => {
    const body = {
      typeWebhook: 'incomingCall',
      from: '79991234567@c.us',
      status: 'offer',
      timestamp: 100,
      idMessage: 'C1',
    } as Body;
    expect(mapCall(body)).toBeNull();
  });

  it('вебхук invalid нормализуется в declined - стиль пропущенного', () => {
    const mapped = mapCall({
      typeWebhook: 'incomingCall',
      idMessage: 'C9',
      timestamp: 1,
      from: '79991234567@c.us',
      status: 'invalid',
    } as Body);
    expect(mapped?.message.extra?.callStatus).toBe('declined');
    expect(mapped?.message.text).toBe('Пропущенный звонок');
  });

  it("pickUp -> 'Входящий звонок', declined -> 'Пропущенный звонок'", () => {
    const base = {
      typeWebhook: 'incomingCall',
      from: '79991234567@c.us',
      timestamp: 100,
    };
    const picked = mapCall({ ...base, status: 'pickUp', idMessage: 'C2' } as Body);
    expect(picked?.chatId).toBe('79991234567@c.us');
    expect(picked?.message.kind).toBe('call');
    expect(picked?.message.text).toBe('Входящий звонок');
    const missed = mapCall({ ...base, status: 'declined', idMessage: 'C3' } as Body);
    expect(missed?.message.text).toBe('Пропущенный звонок');
    expect(missed?.message.extra?.callStatus).toBe('declined');
  });

  it('outgoingCall -> исходящая карточка по chatId', () => {
    const body = {
      typeWebhook: 'outgoingCall',
      chatId: '79991234567@c.us',
      status: 'pickUp',
      timestamp: 100,
      idMessage: 'C4',
    } as Body;
    const call = mapCall(body);
    expect(call?.message.outgoing).toBe(true);
    expect(call?.message.text).toBe('Исходящий звонок');
  });
});

describe('mapServiceNotice', () => {
  it('quotaExceeded -> текст про тариф', () => {
    expect(mapServiceNotice({ typeWebhook: 'quotaExceeded' } as Body)).toContain(
      'тариф',
    );
  });

  it('stateInstanceChanged: authorized -> null, прочее -> баннер', () => {
    expect(
      mapServiceNotice({
        typeWebhook: 'stateInstanceChanged',
        stateInstance: 'authorized',
      } as Body),
    ).toBeNull();
    expect(
      mapServiceNotice({
        typeWebhook: 'stateInstanceChanged',
        stateInstance: 'notAuthorized',
      } as Body),
    ).toContain('не авторизован');
  });
});
