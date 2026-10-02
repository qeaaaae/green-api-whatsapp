import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

describe('linkify', () => {
  it('текст без ссылок -> один сегмент', () => {
    expect(linkify('просто текст')).toEqual([{ text: 'просто текст' }]);
  });

  it('http-ссылка посреди текста', () => {
    expect(linkify('смотри https://a.com/x?q=1 круто')).toEqual([
      { text: 'смотри ' },
      { text: 'https://a.com/x?q=1', url: 'https://a.com/x?q=1' },
      { text: ' круто' },
    ]);
  });

  it('www. без протокола -> href с https://', () => {
    const segs = linkify('www.youtube.com/watch?v=x');
    expect(segs).toEqual([
      {
        text: 'www.youtube.com/watch?v=x',
        url: 'https://www.youtube.com/watch?v=x',
      },
    ]);
  });

  it('несколько ссылок', () => {
    const segs = linkify('a https://a.com и https://b.com/z');
    expect(segs.map((s) => s.url)).toEqual([
      undefined,
      'https://a.com',
      undefined,
      'https://b.com/z',
    ]);
  });

  it('хвостовая пунктуация в ссылку не входит', () => {
    expect(linkify('глянь https://a.com).')).toEqual([
      { text: 'глянь ' },
      { text: 'https://a.com', url: 'https://a.com' },
      { text: ').' },
    ]);
  });

  it('парные скобки внутри URL сохраняются, лишняя откусывается', () => {
    const segs = linkify('(https://en.wikipedia.org/wiki/Foo_(bar))');
    expect(segs[1]).toEqual({
      text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    });
    expect(segs[2]).toEqual({ text: ')' });
  });

  it('ссылка в начале и в конце текста', () => {
    const segs = linkify('https://a.com текст https://b.com');
    expect(segs).toEqual([
      { text: 'https://a.com', url: 'https://a.com' },
      { text: ' текст ' },
      { text: 'https://b.com', url: 'https://b.com' },
    ]);
  });
});
