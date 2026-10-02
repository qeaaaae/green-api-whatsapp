export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl?: string;
  /** Хост загрузки файлов (uploadFile) - отдельный от apiUrl у GREEN-API */
  mediaUrl?: string;
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'error';
export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'contact'
  | 'location'
  | 'poll'
  | 'call';

/** Структурированные данные для нетекстовых сообщений */
export interface MessageExtra {
  contactName?: string;
  phone?: string;
  company?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  /** Текстовый адрес локации */
  address?: string;
  options?: string[];
  /** base64-превью для видео/документов (jpegThumbnail из GREEN-API) */
  thumbnail?: string;
  /** Статус звонка из уведомления incomingCall */
  callStatus?: 'offer' | 'pickUp' | 'hungUp' | 'declined' | 'missed';
}

/** Цитата - сообщение, на которое ответили */
export interface MessageQuote {
  /** id цитируемого сообщения (stanzaId) */
  id?: string;
  /** автор цитируемого сообщения (jid/имя) */
  sender?: string;
  text: string;
  thumbnail?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  timestamp: number;
  outgoing: boolean;
  /** Только для исходящих: статус доставки до GREEN-API */
  status?: MessageStatus;
  kind?: MessageKind;
  /** Ссылка на файл/изображение для скачивания или превью */
  url?: string;
  /** Имя отправителя входящего сообщения (из senderData уведомления) */
  senderName?: string;
  /** Эмодзи-реакция на сообщение */
  reaction?: string;
  /** Цитируемое сообщение, если это ответ */
  quote?: MessageQuote;
  /** Текст был изменён (своё через editMessage или editedMessage-вебхук) */
  edited?: boolean;
  /** Собеседник удалил сообщение у всех - показываем плейсхолдер */
  deleted?: boolean;
  /** Сообщение переслано из другого чата (isForwarded из вебхука/журнала) */
  forwarded?: boolean;
  extra?: MessageExtra;
}

export interface Chat {
  chatId: string;
  title: string;
  /** URL фото профиля из getContactInfo */
  avatar?: string;
  /** Непрочитанные входящие (локальный счётчик, сбрасывается при открытии) */
  unread?: number;
  messages: ChatMessage[];
}

interface TextMessageData {
  textMessage: string;
  isForwarded?: boolean;
  forwardingScore?: number;
}

interface ExtendedTextMessageData {
  text: string;
  isForwarded?: boolean;
  forwardingScore?: number;
  /** У quotedMessage: id цитируемого сообщения и jid его автора */
  stanzaId?: string;
  participant?: string;
}

export interface IncomingMessageBody {
  typeWebhook: 'incomingMessageReceived';
  timestamp: number;
  idMessage: string;
  senderData: {
    chatId: string;
    chatType?: 'user' | 'group' | 'supergroup';
    sender: string;
    chatName?: string;
    senderName?: string;
    senderType?: string;
    senderContactName?: string;
    senderPhoneNumber?: number;
  };
  messageData: {
    typeMessage: string;
    textMessageData?: TextMessageData;
    extendedTextMessageData?: ExtendedTextMessageData;
    fileMessageData?: {
      downloadUrl?: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
      jpegThumbnail?: string;
      isForwarded?: boolean;
      forwardingScore?: number;
    };
    locationMessageData?: {
      latitude?: number;
      longitude?: number;
      nameLocation?: string;
      addressLocation?: string;
      isForwarded?: boolean;
      forwardingScore?: number;
    };
    contactMessageData?: {
      displayName?: string;
      vcard?: string;
      isForwarded?: boolean;
      forwardingScore?: number;
    };
    pollMessageData?: { name?: string; options?: { optionName: string }[] };
    editedMessageData?: { textMessage?: string; stanzaId?: string };
    deletedMessageData?: { stanzaId?: string };
    /**
     * У reply-сообщений - цитируемое сообщение.
     * У reactionMessage: stanzaId - id сообщения, на которое отреагировали.
     */
    quotedMessage?: QuotedMessage;
  };
}

export interface QuotedMessage {
  stanzaId?: string;
  participant?: string;
  typeMessage?: string;
  textMessage?: string;
  caption?: string;
  downloadUrl?: string;
  fileName?: string;
  jpegThumbnail?: string;
  senderName?: string;
  location?: { nameLocation?: string; latitude?: number; longitude?: number };
  contact?: { displayName?: string };
  pollMessage?: { name?: string };
}

export interface Notification {
  receiptId: number;
  body: {
    typeWebhook: string;
    /** outgoingMessageStatus: чат и сообщение, у которого сменился статус */
    chatId?: string;
    idMessage?: string;
    status?: string;
    /** incomingCall: инициатор звонка */
    from?: string;
    /** stateInstanceChanged: новое состояние инстанса */
    stateInstance?: string;
  } & Partial<Omit<IncomingMessageBody, 'typeWebhook'>>;
}
