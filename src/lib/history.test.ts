import { describe, expect, it } from 'vitest';
import type { JournalMessage } from '../api/greenApi';
import { toMessage } from './history';

const base: JournalMessage = {
  type: 'incoming',
  idMessage: 'J1',
  timestamp: 1700000000,
  chatId: '79991234567@c.us',
};

const j = (overrides: Partial<JournalMessage>): JournalMessage => ({
  ...base,
  ...overrides,
});

describe('toMessage', () => {
  it('текст: textMessage и extendedTextMessage', () => {
    expect(toMessage(j({ typeMessage: 'textMessage', textMessage: 'hi' }))?.text)
      .toBe('hi');
    expect(
      toMessage(
        j({
          typeMessage: 'extendedTextMessage',
          extendedTextMessage: { text: 'ссылка' },
        }),
      )?.text,
    ).toBe('ссылка');
  });

  it('quotedMessage: текст ответа, цитата резолвится отдельно', () => {
    const m = toMessage(
      j({ typeMessage: 'quotedMessage', textMessage: 'ответ' }),
    );
    expect(m?.kind).toBe('text');
    expect(m?.text).toBe('ответ');
  });

  it('медиа: caption или заглушка, url из downloadUrl', () => {
    const img = toMessage(
      j({ typeMessage: 'imageMessage', downloadUrl: 'u', caption: 'фото' }),
    );
    expect(img?.kind).toBe('image');
    expect(img?.text).toBe('фото');
    expect(img?.url).toBe('u');
    expect(
      toMessage(j({ typeMessage: 'imageMessage', downloadUrl: 'u' }))?.text,
    ).toBe('Изображение');
  });

  it('видео: thumbnail из jpegThumbnail в data-url', () => {
    const m = toMessage(
      j({ typeMessage: 'videoMessage', downloadUrl: 'u', jpegThumbnail: 'AA==' }),
    );
    expect(m?.kind).toBe('video');
    expect(m?.extra?.thumbnail).toBe('data:image/jpeg;base64,AA==');
  });

  it('стикер и аудио -> свои kind с заглушками', () => {
    expect(toMessage(j({ typeMessage: 'stickerMessage' }))?.kind).toBe('image');
    expect(toMessage(j({ typeMessage: 'stickerMessage' }))?.text).toBe('Стикер');
    const audio = toMessage(j({ typeMessage: 'audioMessage', downloadUrl: 'u' }));
    expect(audio?.kind).toBe('audio');
    expect(audio?.text).toBe('Голосовое сообщение');
  });

  it('документ: имя файла или "Файл"', () => {
    expect(
      toMessage(j({ typeMessage: 'documentMessage', fileName: 'doc.pdf' }))?.text,
    ).toBe('doc.pdf');
    expect(toMessage(j({ typeMessage: 'documentMessage' }))?.text).toBe('Файл');
  });

  it('геолокация: имя места или координаты в текст и extra', () => {
    const named = toMessage(
      j({
        typeMessage: 'locationMessage',
        location: {
          latitude: 55.75,
          longitude: 37.61,
          nameLocation: 'Москва',
          addressLocation: 'Красная площадь',
        },
      }),
    );
    expect(named?.kind).toBe('location');
    expect(named?.text).toBe('Москва');
    expect(named?.extra?.address).toBe('Красная площадь');
    const coords = toMessage(
      j({
        typeMessage: 'locationMessage',
        location: { latitude: 55.75, longitude: 37.61 },
      }),
    );
    expect(coords?.text).toBe('55.75, 37.61');
  });

  it('контакт: имя + телефон/компания из vcard', () => {
    const m = toMessage(
      j({
        typeMessage: 'contactMessage',
        contact: {
          displayName: 'Влад',
          vcard: 'BEGIN:VCARD\nTEL;wts=7999:+7999\nORG:Рога и копыта;\nEND:VCARD',
        },
      }),
    );
    expect(m?.kind).toBe('contact');
    expect(m?.text).toBe('Контакт: Влад');
    expect(m?.extra?.phone).toBe('+7999');
    expect(m?.extra?.company).toBe('Рога и копыта');
  });

  it('опрос и голос в опросе', () => {
    const poll = toMessage(
      j({
        typeMessage: 'pollMessage',
        pollMessage: {
          name: 'Куда?',
          options: [{ optionName: 'Домой' }, { optionName: 'В бар' }],
        },
      }),
    );
    expect(poll?.kind).toBe('poll');
    expect(poll?.text).toBe('Куда?');
    expect(poll?.extra?.options).toEqual(['Домой', 'В бар']);
    const vote = toMessage(
      j({
        typeMessage: 'pollUpdateMessage',
        pollMessage: { name: 'Куда?', options: [{ optionName: 'Домой' }] },
      }),
    );
    expect(vote?.text).toContain("Голос в опросе 'Куда?': Домой");
  });

  it('исходящее: статус из statusMessage, failed -> error', () => {
    const sent = toMessage(
      j({ type: 'outgoing', typeMessage: 'textMessage', statusMessage: 'read' }),
    );
    expect(sent?.outgoing).toBe(true);
    expect(sent?.status).toBe('read');
    expect(
      toMessage(
        j({ type: 'outgoing', typeMessage: 'textMessage', statusMessage: 'failed' }),
      )?.status,
    ).toBe('error');
    // входящие статуса не имеют
    expect(
      toMessage(j({ typeMessage: 'textMessage', textMessage: 'x' }))?.status,
    ).toBeUndefined();
  });

  it('isForwarded: верхний уровень и вложенный в составных', () => {
    expect(
      toMessage(j({ typeMessage: 'textMessage', isForwarded: true }))?.forwarded,
    ).toBe(true);
    expect(
      toMessage(
        j({
          typeMessage: 'extendedTextMessage',
          extendedTextMessage: { text: 'x', isForwarded: true },
        }),
      )?.forwarded,
    ).toBe(true);
  });

  it('неподдерживаемые/битые записи -> null', () => {
    expect(toMessage(j({ typeMessage: 'buttonsMessage' }))).toBeNull();
    expect(toMessage(j({ typeMessage: 'textMessage', idMessage: undefined })))
      .toBeNull();
    expect(toMessage(j({ typeMessage: 'textMessage', timestamp: undefined })))
      .toBeNull();
    expect(toMessage(j({}))).toBeNull();
  });
});
