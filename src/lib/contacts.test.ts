import { describe, expect, it } from 'vitest';
import { contactLabel, matchContact } from './contacts';

describe('contactLabel', () => {
  it('имя из телефонной книги важнее имени профиля', () => {
    expect(
      contactLabel({ id: '1@c.us', contactName: 'Мама', name: 'Mom' }),
    ).toBe('Мама');
  });

  it('без contactName берёт имя профиля, иначе chatId', () => {
    expect(contactLabel({ id: '1@c.us', name: 'John' })).toBe('John');
    expect(contactLabel({ id: '1@c.us' })).toBe('1@c.us');
  });
});

describe('matchContact', () => {
  const c = { id: '79991234567@c.us', contactName: 'Владислав' };

  it('матчит по имени без учёта регистра', () => {
    expect(matchContact('влад', c)).toBe(true);
    expect(matchContact('ПЕТР', c)).toBe(false);
  });

  it('матчит по цифрам номера через маску ввода', () => {
    expect(matchContact('+7 (999) 123', c)).toBe(true);
    expect(matchContact('9991234', c)).toBe(true);
    expect(matchContact('111', c)).toBe(false);
  });

  it('матчит по chatId и пустой ввод пропускает всё', () => {
    expect(matchContact('@c.us', c)).toBe(true);
    expect(matchContact('', c)).toBe(true);
  });
});
