// Разбивает текст на сегменты: обычный текст и URL'ы.
// Поддерживаем http(s):// и голый www. - как в WhatsApp.
// Хвостовая пунктуация (точка, запятая, закрывающая скобка без пары)
// в ссылку не входит - это обычный текст после URL.

export interface LinkSegment {
  text: string;
  /** href для <a>; у www.-ссылок подставляется https:// */
  url?: string;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCT = /[.,!?;:'"»]+$/;

export function linkify(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    let url = match[0];
    // Откусываем висячую пунктуацию и непарные закрывающие скобки:
    // 'смотри https://a.com).' -> ссылка без ').'
    let tail = '';
    while (true) {
      const punct = url.match(TRAILING_PUNCT);
      if (punct) {
        tail = punct[0] + tail;
        url = url.slice(0, -punct[0].length);
        continue;
      }
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (url.endsWith(')') && closes > opens) {
        tail = ')' + tail;
        url = url.slice(0, -1);
        continue;
      }
      break;
    }
    if (!url) continue;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({
      text: url,
      url: url.startsWith('www.') ? `https://${url}` : url,
    });
    // last указывает на конец url - откушенный хвост останется
    // в следующем текстовом сегменте
    last = start + url.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
