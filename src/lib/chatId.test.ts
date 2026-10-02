import { describe, expect, it } from 'vitest';
import { formatPhoneInput, isSendableChatId, toChatId } from './chatId';

describe('toChatId', () => {
  it('возвращает null для пустого ввода', () => {
    expect(toChatId('')).toBeNull();
    expect(toChatId('   ')).toBeNull();
    expect(toChatId('+7 (')).toBeNull();
  });

  it('нормализует номер в chatId', () => {
    expect(toChatId('79991234567')).toBe('79991234567@c.us');
    expect(toChatId('+7 (999) 123-45-67')).toBe('79991234567@c.us');
    expect(toChatId('8 999 123 45 67')).toBe('79991234567@c.us');
  });

  it('не трогает иностранные номера на 8 с плюсом', () => {
    expect(toChatId('+819012345678')).toBe('819012345678@c.us');
  });

  it('оставляет готовый chatId как есть', () => {
    expect(toChatId('79991234567@c.us')).toBe('79991234567@c.us');
    expect(toChatId('120363012345678@g.us')).toBe('120363012345678@g.us');
  });

  it('отклоняет слишком короткий номер', () => {
    expect(toChatId('12345')).toBeNull();
  });
});

describe('formatPhoneInput', () => {
  it('форматирует российский номер', () => {
    expect(formatPhoneInput('79991234567')).toBe('+7 (999) 123-45-67');
    expect(formatPhoneInput('89041945430')).toBe('+7 (904) 194-54-30');
  });

  it('форматирует частичный ввод', () => {
    expect(formatPhoneInput('7')).toBe('+7');
    expect(formatPhoneInput('899')).toBe('+7 (99');
  });

  it('форматирует номер США/Канады', () => {
    expect(formatPhoneInput('15551234567')).toBe('+1 (555) 123-4567');
  });

  it('не ломает международные номера на 8 с плюсом', () => {
    expect(formatPhoneInput('+819012345678')).toBe('+819 012 345 678');
  });

  it('не применяет маску к chatId', () => {
    expect(formatPhoneInput('120363012345678@g.us')).toBe('120363012345678@g.us');
  });

  it('пустой ввод -> пустая строка', () => {
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('+')).toBe('');
  });
});

describe('isSendableChatId', () => {
  it('пропускает номера, группы и lid', () => {
    expect(isSendableChatId('79991234567@c.us')).toBe(true);
    expect(isSendableChatId('120363012345678@g.us')).toBe(true);
    expect(isSendableChatId('123456789012345@lid')).toBe(true);
  });

  it('отсекает системные и короткие id', () => {
    expect(isSendableChatId('0@c.us')).toBe(false);
    expect(isSendableChatId('1234@c.us')).toBe(false);
    expect(isSendableChatId('status@broadcast')).toBe(false);
    expect(isSendableChatId('newsletter@newsletter')).toBe(false);
  });
});
