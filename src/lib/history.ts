import { getChatHistory, type JournalMessage } from '../api/greenApi';
import { useChatStore } from '../store/chatStore';
import { repairEncoding } from './format';
import { fixExtra, mapQuote, STATUS_MAP, thumb, vcardOrg, vcardPhone } from './notifications';
import type { ChatMessage } from '../types';

function toMessageRaw(j: JournalMessage): ChatMessage | null {
  if (!j.idMessage || !j.timestamp || !j.typeMessage) return null;
  const base = {
    id: j.idMessage,
    timestamp: j.timestamp,
    outgoing: j.type === 'outgoing',
    senderName: j.senderName ?? j.senderContactName,
    status:
      j.type === 'outgoing'
        ? (STATUS_MAP[j.statusMessage ?? ''] ?? 'sent')
        : undefined,
    quote: mapQuote(j.quotedMessage, j.chatId),
    // в журнале флаг на верхнем уровне, у составных типов - вложенный
    forwarded:
      j.isForwarded ||
      j.extendedTextMessage?.isForwarded ||
      j.location?.isForwarded ||
      j.contact?.isForwarded ||
      undefined,
  };
  switch (j.typeMessage) {
    case 'textMessage':
    case 'extendedTextMessage':
    // Ответ на сообщение: текст reply в textMessage, цитата - в quotedMessage
    case 'quotedMessage':
      return {
        ...base,
        kind: 'text',
        text: j.textMessage ?? j.extendedTextMessage?.text ?? '',
      };
    case 'imageMessage':
      return {
        ...base,
        kind: 'image',
        url: j.downloadUrl,
        text: j.caption || 'Изображение',
      };
    case 'videoMessage':
      return {
        ...base,
        kind: 'video',
        url: j.downloadUrl,
        text: j.caption || 'Видео',
        extra: j.jpegThumbnail ? { thumbnail: thumb(j.jpegThumbnail) } : undefined,
      };
    case 'stickerMessage':
      return { ...base, kind: 'image', url: j.downloadUrl, text: 'Стикер' };
    case 'audioMessage':
      return {
        ...base,
        kind: 'audio',
        url: j.downloadUrl,
        text: 'Голосовое сообщение',
      };
    case 'documentMessage':
      return { ...base, kind: 'file', url: j.downloadUrl, text: j.fileName || 'Файл' };
    case 'locationMessage':
      return {
        ...base,
        kind: 'location',
        text:
          j.location?.nameLocation ||
          [j.location?.latitude, j.location?.longitude].filter(Boolean).join(', ') ||
          'Геолокация',
        extra: {
          latitude: j.location?.latitude,
          longitude: j.location?.longitude,
          locationName: j.location?.nameLocation,
          address: j.location?.addressLocation,
        },
      };
    case 'contactMessage':
      return {
        ...base,
        kind: 'contact',
        text: `Контакт: ${j.contact?.displayName || 'без имени'}`,
        extra: {
          contactName: j.contact?.displayName,
          phone: vcardPhone(j.contact?.vcard),
          company: vcardOrg(j.contact?.vcard),
        },
      };
    case 'pollUpdateMessage':
      return {
        ...base,
        kind: 'text',
        text: `Голос в опросе${j.pollMessage?.name ? ` '${j.pollMessage.name}'` : ''}: ${(j.pollMessage?.options ?? []).map((o) => o.optionName).join(', ')}`,
      };
    case 'pollMessage':
      return {
        ...base,
        kind: 'poll',
        text: j.pollMessage?.name ?? 'Опрос',
        extra: j.pollMessage?.options?.length
          ? { options: j.pollMessage.options.map((o) => o.optionName) }
          : undefined,
      };
    default:
      return null;
  }
}

// Текстовые поля журнала местами приходят в битой кодировке (Latin-1 как
// UTF-8) - чиним готовый объект, не размазывая по каждой ветке switch
export function toMessage(j: JournalMessage): ChatMessage | null {
  const m = toMessageRaw(j);
  if (!m) return null;
  return {
    ...m,
    text: repairEncoding(m.text),
    senderName: m.senderName && repairEncoding(m.senderName),
    extra: fixExtra(m.extra),
  };
}

const attempted = new Set<string>();

/**
 * Дозагружает историю чата из журнала GREEN-API (последние 100 сообщений):
 * мержит сообщения по id и раскладывает реакции по stanzaId.
 * Один раз на чат за сессию; ошибки API игнорируются.
 */
const HISTORY_MIN_GAP = 1100;
let lastHistoryCall = 0;

export async function ensureChatHistory(
  creds: Parameters<typeof getChatHistory>[0],
  chatId: string,
): Promise<void> {
  if (attempted.has(chatId)) return;
  attempted.add(chatId);
  // getChatHistory ограничен 1 запросом/с (429 при пачке) - разносим вызовы
  const now = Date.now();
  const startAt = Math.max(now, lastHistoryCall + HISTORY_MIN_GAP);
  lastHistoryCall = startAt;
  if (startAt > now) {
    await new Promise((r) => setTimeout(r, startAt - now));
  }
  try {
    const items = await getChatHistory(creds, chatId);
    const messages: ChatMessage[] = [];
    const reactions: { messageId: string; emoji: string }[] = [];
    for (const j of items) {
      if (j.typeMessage === 'reactionMessage') {
        const messageId = j.quotedMessage?.stanzaId;
        if (messageId) {
          reactions.push({ messageId, emoji: j.extendedTextMessage?.text ?? '' });
        }
        continue;
      }
      const m = toMessage(j);
      if (m) messages.push(m);
    }
    const store = useChatStore.getState();
    store.mergeMessages(chatId, messages);
    for (const r of reactions) {
      // Пустой emoji в журнале - не снятие: журнал хранит устаревшие записи
      // реакций; снятие ловим только живым reactionMessage-вебхуком
      if (r.emoji) {
        store.updateMessage(chatId, r.messageId, { reaction: r.emoji });
      }
    }
  } catch {
    attempted.delete(chatId);
  }
}
