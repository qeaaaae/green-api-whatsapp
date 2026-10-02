import type {
  ChatMessage,
  MessageExtra,
  MessageStatus,
  Notification,
  QuotedMessage,
} from '../types';

type NotificationBody = Notification['body'];
type MessageData = NonNullable<NotificationBody['messageData']>;

export interface IncomingMessage {
  chatId: string;
  title: string;
  message: ChatMessage;
}

export const vcardPhone = (vcard?: string) =>
  vcard?.match(/TEL[^:\r\n]*:(.+)/)?.[1]?.trim();

export const vcardOrg = (vcard?: string) =>
  vcard?.match(/ORG:([^;\r\n]+)/)?.[1]?.trim();

export const thumb = (jpegThumbnail?: string) =>
  jpegThumbnail ? `data:image/jpeg;base64,${jpegThumbnail}` : undefined;

// Тексты-заглушки для нетекстовых типов - при мерже истории не должны
// затирать реальный caption; переиспользуется в chatStore/MessageBubble
export const GENERIC_TEXT = new Set([
  'Изображение',
  'Видео',
  'Стикер',
  'Файл',
  'Голосовое сообщение',
  'Геолокация',
  'Опрос',
]);

// statusMessage из журнала / status из вебхука -> MessageStatus
export const STATUS_MAP: Record<string, MessageStatus> = {
  pending: 'pending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'error',
};

// quotedMessage -> MessageQuote: текст и тип цитируемого сообщения
export function mapQuote(qm?: QuotedMessage): ChatMessage['quote'] | undefined {
  if (!qm) return undefined;
  const text =
    qm.typeMessage === 'textMessage' || qm.typeMessage === 'extendedTextMessage'
      ? (qm.textMessage ?? '')
      : qm.caption ||
        ({
          imageMessage: 'Изображение',
          videoMessage: 'Видео',
          audioMessage: 'Голосовое сообщение',
          documentMessage: qm.fileName || 'Файл',
          stickerMessage: 'Стикер',
          locationMessage: qm.location?.nameLocation || 'Геолокация',
          contactMessage: `Контакт: ${qm.contact?.displayName || 'без имени'}`,
          pollMessage: `Опрос: ${qm.pollMessage?.name || ''}`,
          reactionMessage: 'Реакция',
        }[qm.typeMessage ?? ''] ?? 'Сообщение');
  return {
    id: qm.stanzaId,
    sender: qm.senderName ?? qm.participant,
    text,
    thumbnail: thumb(qm.jpegThumbnail),
  };
}

// У typeMessage='quotedMessage' цитируемое приходит как stanzaId/participant
// внутри extendedTextMessageData - полный текст подтянем позже из стора
const quoteFromReply = (md: MessageData): ChatMessage['quote'] | undefined => {
  if (md.typeMessage !== 'quotedMessage') return undefined;
  const ed = md.extendedTextMessageData;
  return ed?.stanzaId ? { id: ed.stanzaId, sender: ed.participant, text: '' } : undefined;
};

// isForwarded лежит внутри per-type data-объекта, а не на верхнем уровне
const isForwarded = (md: MessageData): boolean | undefined =>
  md.textMessageData?.isForwarded ||
  md.extendedTextMessageData?.isForwarded ||
  md.fileMessageData?.isForwarded ||
  md.locationMessageData?.isForwarded ||
  md.contactMessageData?.isForwarded ||
  undefined;

// Общая распаковка messageData в поля сообщения
function messagePayload(
  md: MessageData,
): Pick<ChatMessage, 'text' | 'kind'> & { url?: string; extra?: ChatMessage['extra'] } | null {
  switch (md.typeMessage) {
    case 'textMessage':
    case 'extendedTextMessage':
      return {
        text: md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ?? '',
        kind: 'text',
      };
    // Ответ на сообщение: текст reply в extendedTextMessageData.text,
    // цитируемое сообщение - только stanzaId/participant (тело резолвим
    // из локальной истории в dispatchNotification)
    case 'quotedMessage':
      return { text: md.extendedTextMessageData?.text ?? '', kind: 'text' };
    case 'imageMessage':
      return {
        kind: 'image',
        url: md.fileMessageData?.downloadUrl,
        text: md.fileMessageData?.caption || 'Изображение',
      };
    case 'videoMessage':
      return {
        kind: 'video',
        url: md.fileMessageData?.downloadUrl,
        text: md.fileMessageData?.caption || 'Видео',
        extra: md.fileMessageData?.jpegThumbnail
          ? { thumbnail: thumb(md.fileMessageData.jpegThumbnail) }
          : undefined,
      };
    case 'stickerMessage':
      return {
        kind: 'image',
        url: md.fileMessageData?.downloadUrl,
        text: 'Стикер',
      };
    case 'audioMessage':
      return {
        kind: 'audio',
        url: md.fileMessageData?.downloadUrl,
        text: 'Голосовое сообщение',
      };
    case 'documentMessage':
      return {
        kind: 'file',
        url: md.fileMessageData?.downloadUrl,
        text: md.fileMessageData?.fileName || 'Файл',
      };
    case 'locationMessage': {
      const loc = md.locationMessageData;
      return {
        kind: 'location',
        text:
          loc?.nameLocation ||
          [loc?.latitude, loc?.longitude].filter(Boolean).join(', ') ||
          'Геолокация',
        extra: {
          latitude: loc?.latitude,
          longitude: loc?.longitude,
          locationName: loc?.nameLocation,
          address: loc?.addressLocation,
        },
      };
    }
    case 'contactMessage':
      return {
        kind: 'contact',
        text: `Контакт: ${md.contactMessageData?.displayName || 'без имени'}`,
        extra: {
          contactName: md.contactMessageData?.displayName,
          phone: vcardPhone(md.contactMessageData?.vcard),
          company: vcardOrg(md.contactMessageData?.vcard),
        },
      };
    case 'pollUpdateMessage': {
      const options = (md.pollMessageData?.options ?? [])
        .map((o) => o.optionName)
        .join(', ');
      return {
        kind: 'text',
        text: `Голос в опросе${md.pollMessageData?.name ? ` '${md.pollMessageData.name}'` : ''}: ${options}`,
      };
    }
    case 'pollMessage':
      return {
        kind: 'poll',
        text: md.pollMessageData?.name ?? 'Опрос',
        extra: md.pollMessageData?.options?.length
          ? { options: md.pollMessageData.options.map((o) => o.optionName) }
          : undefined,
      };
    default:
      return null;
  }
}

// incomingMessageReceived -> ChatMessage; неподдерживаемые типы -> null
export function mapIncomingMessage(body: NotificationBody): IncomingMessage | null {
  if (body.typeWebhook !== 'incomingMessageReceived') return null;
  const sender = body.senderData;
  const md = body.messageData;
  if (!sender || !md || !body.idMessage || !body.timestamp) return null;

  const payload = messagePayload(md);
  if (!payload) return null;

  const title =
    sender.senderContactName ?? sender.senderName ?? sender.chatName ?? sender.chatId;

  return {
    chatId: sender.chatId,
    title,
    message: {
      id: body.idMessage,
      timestamp: body.timestamp,
      outgoing: false,
      senderName: sender.senderName ?? sender.senderContactName,
      quote: mapQuote(md.quotedMessage) ?? quoteFromReply(md),
      forwarded: isForwarded(md),
      ...payload,
    },
  };
}

// outgoingMessageReceived / outgoingAPIMessageReceived -> наше сообщение
// (в т.ч. отправленное с телефона или вернувшееся эхо API-отправки с downloadUrl)
export function mapOutgoingMessage(
  body: NotificationBody,
): { chatId: string; message: ChatMessage } | null {
  if (
    body.typeWebhook !== 'outgoingMessageReceived' &&
    body.typeWebhook !== 'outgoingAPIMessageReceived'
  ) {
    return null;
  }
  const md = body.messageData;
  const chatId = body.chatId ?? body.senderData?.chatId;
  if (!md || !chatId || !body.idMessage || !body.timestamp) return null;

  const payload = messagePayload(md);
  if (!payload) return null;

  return {
    chatId,
    message: {
      id: body.idMessage,
      timestamp: body.timestamp,
      outgoing: true,
      status: 'sent',
      quote: mapQuote(md.quotedMessage) ?? quoteFromReply(md),
      forwarded: isForwarded(md),
      ...payload,
    },
  };
}

// reactionMessage -> эмодзи-реакция на конкретное сообщение
// (пустой text = реакция снята)
export function mapReaction(
  body: NotificationBody,
): { chatId: string; messageId: string; emoji: string } | null {
  if (
    body.typeWebhook !== 'incomingMessageReceived' &&
    body.typeWebhook !== 'outgoingMessageReceived' &&
    body.typeWebhook !== 'outgoingAPIMessageReceived'
  ) {
    return null;
  }
  const md = body.messageData;
  if (md?.typeMessage !== 'reactionMessage') return null;
  const chatId = body.senderData?.chatId ?? body.chatId;
  const messageId = md.quotedMessage?.stanzaId;
  if (!chatId || !messageId) return null;
  return {
    chatId,
    messageId,
    emoji: md.extendedTextMessageData?.text ?? '',
  };
}

const isMessageWebhook = (typeWebhook?: string) =>
  typeWebhook === 'incomingMessageReceived' ||
  typeWebhook === 'outgoingMessageReceived' ||
  typeWebhook === 'outgoingAPIMessageReceived';

const webhookChatId = (body: NotificationBody) =>
  body.senderData?.chatId ?? body.chatId;

// editedMessage -> новый текст сообщения (своё или чужое - вебхук один)
export function mapEditedMessage(
  body: NotificationBody,
): { chatId: string; messageId: string; text: string } | null {
  if (!isMessageWebhook(body.typeWebhook)) return null;
  const md = body.messageData;
  if (md?.typeMessage !== 'editedMessage') return null;
  const chatId = webhookChatId(body);
  const messageId = md.editedMessageData?.stanzaId;
  const text = md.editedMessageData?.textMessage;
  if (!chatId || !messageId || text == null) return null;
  return { chatId, messageId, text };
}

// deletedMessage -> сообщение удалено у всех участников
export function mapDeletedMessage(
  body: NotificationBody,
): { chatId: string; messageId: string } | null {
  if (!isMessageWebhook(body.typeWebhook)) return null;
  const md = body.messageData;
  if (md?.typeMessage !== 'deletedMessage') return null;
  const chatId = webhookChatId(body);
  const messageId = md.deletedMessageData?.stanzaId;
  if (!chatId || !messageId) return null;
  return { chatId, messageId };
}

export type CallStatus = NonNullable<MessageExtra['callStatus']>;

// 'invalid' и прочие служебные статусы из API приводим к каноническим
export const normalizeCallStatus = (status?: string): CallStatus =>
  status === 'invalid' ? 'declined' : (status as CallStatus);

/** Подпись карточки звонка по статусу и направлению */
export const callLabel = (status: string | undefined, outgoing: boolean): string => {
  if (outgoing) {
    return status === 'invalid' ? 'Звонок не состоялся' : 'Исходящий звонок';
  }
  return status === 'pickUp' || status === 'offer'
    ? 'Входящий звонок'
    : 'Пропущенный звонок';
};

// incomingCall/outgoingCall -> карточка звонка в чате.
// На 'offer' не добавляем - ждём итоговый статус, чтобы не было дублей.
export function mapCall(
  body: NotificationBody,
): { chatId: string; title?: string; message: ChatMessage } | null {
  if (body.typeWebhook !== 'incomingCall' && body.typeWebhook !== 'outgoingCall') {
    return null;
  }
  const status = body.status;
  if (!status || status === 'offer' || !body.idMessage || !body.timestamp) return null;
  const outgoing = body.typeWebhook === 'outgoingCall';
  const chatId = outgoing ? body.chatId : body.from;
  if (!chatId) return null;
  return {
    chatId,
    title: body.senderData?.senderName ?? body.senderData?.senderContactName,
    message: {
      id: body.idMessage,
      timestamp: body.timestamp,
      outgoing,
      kind: 'call',
      text: callLabel(status, outgoing),
      extra: { callStatus: normalizeCallStatus(status) },
    },
  };
}

// Служебные уведомления -> текст для баннера связи
export function mapServiceNotice(body: NotificationBody): string | null {
  if (body.typeWebhook === 'quotaExceeded') {
    return 'Превышены ограничения тарифа GREEN-API';
  }
  if (body.typeWebhook === 'stateInstanceChanged') {
    const state = body.stateInstance;
    if (!state || state === 'authorized') return null;
    return `Инстанс не авторизован (${state}). Отсканируйте QR-код в личном кабинете GREEN-API.`;
  }
  return null;
}

// outgoingMessageStatus -> статус исходящего сообщения
export function mapOutgoingStatus(
  body: NotificationBody,
): { chatId: string; idMessage: string; status: MessageStatus } | null {
  if (body.typeWebhook !== 'outgoingMessageStatus' || !body.chatId || !body.idMessage) {
    return null;
  }
  const status = STATUS_MAP[body.status ?? ''];
  return status ? { chatId: body.chatId, idMessage: body.idMessage, status } : null;
}
