import { describe, expect, it } from 'vitest';
import { formatDuration, repairEncoding } from './format';

describe('formatDuration', () => {
  it('секунды и минуты -> m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(83)).toBe('1:23');
  });

  it('часы -> h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3750)).toBe('1:02:30');
  });
});

describe('repairEncoding', () => {
  // имитация битой строки от GREEN-API: utf-8 байты прочитаны как latin-1
  const mojibake = (s: string) =>
    [...new TextEncoder().encode(s)].map((b) => String.fromCharCode(b)).join('');

  it('чинит UTF-8 прочитанный в Latin-1', () => {
    expect(repairEncoding(mojibake('Отчёт за март.pdf'))).toBe('Отчёт за март.pdf');
  });

  it('нормальную кириллицу и латиницу не трогает', () => {
    expect(repairEncoding('Привет, мир')).toBe('Привет, мир');
    expect(repairEncoding('report.pdf')).toBe('report.pdf');
  });

  it('смешанный текст с эмодзи не ломает', () => {
    expect(repairEncoding('ok 👍')).toBe('ok 👍');
  });
});
