import type { ChatMessage, Credentials, MessageExtra, MessageKind } from '../../types';

export interface OutgoingDraft {
  text: string;
  kind: MessageKind;
  /** blob:-превью файла до прихода настоящего downloadUrl из уведомления */
  url?: string;
  /** Данные карточки: контакт/локация/опрос */
  extra?: MessageExtra;
  /** Цитата, если это ответ на сообщение */
  quote?: ChatMessage['quote'];
}

/** Общий контекст для модалок вложений */
export interface AttachmentContext {
  credentials: Credentials;
  chatId: string;
  /** Сообщение, на которое отвечаем - уходит в quotedMessageId и draft.quote */
  replyTo?: ChatMessage | null;
  /** Добавить исходящее сообщение и запустить его отправку */
  onSend: (draft: OutgoingDraft, send: () => Promise<{ idMessage: string }>) => void;
}

export const replyQuoteOf = (
  replyTo?: ChatMessage | null,
): OutgoingDraft['quote'] =>
  replyTo
    ? {
        id: replyTo.id,
        sender: replyTo.outgoing ? 'Вы' : (replyTo.senderName ?? undefined),
        text: replyTo.text,
      }
    : undefined;
