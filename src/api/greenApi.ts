import type { Credentials, Notification, QuotedMessage } from '../types';

const DEFAULT_API_URL = 'https://api.green-api.com';
// uploadFile живёт на отдельном media-хосте, а не на apiUrl
const DEFAULT_MEDIA_URL = 'https://media.green-api.com';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`GREEN-API ${status}: ${message}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function endpoint(creds: Credentials, method: string, suffix = ''): string {
  const apiUrl = creds.apiUrl?.replace(/\/+$/, '') || DEFAULT_API_URL;
  return `${apiUrl}/waInstance${creds.idInstance}/${method}/${creds.apiTokenInstance}${suffix}`;
}

function mediaEndpoint(creds: Credentials, method: string): string {
  const mediaUrl = creds.mediaUrl?.replace(/\/+$/, '') || DEFAULT_MEDIA_URL;
  return `${mediaUrl}/waInstance${creds.idInstance}/${method}/${creds.apiTokenInstance}`;
}

// В теле ошибок GREEN-API лежит JSON: { message, description, invokeStatus.description }
function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      description?: string;
      invokeStatus?: { description?: string };
    };
    return (
      parsed.invokeStatus?.description ?? parsed.description ?? parsed.message ?? body
    );
  } catch {
    return body;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      extractErrorMessage(details) || response.statusText,
    );
  }
  // Часть методов (deleteMessage и др.) отвечает пустым телом - не парсим его
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function post<T>(creds: Credentials, method: string, body: unknown): Promise<T> {
  return request<T>(endpoint(creds, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getStateInstance(creds: Credentials): Promise<{ stateInstance: string }> {
  return request(endpoint(creds, 'getStateInstance'));
}

export interface InstanceSettings {
  webhookUrl?: string;
  webhookUrlToken?: string;
  incomingWebhook?: string;
  outgoingWebhook?: string;
  outgoingMessageWebhook?: string;
  outgoingAPIMessageWebhook?: string;
  stateWebhook?: string;
  markIncomingMessagesReaded?: string;
  editedMessageWebhook?: string;
  deletedMessageWebhook?: string;
  incomingCallWebhook?: string;
  outgoingCallWebhook?: string;
}

function getSettings(creds: Credentials): Promise<InstanceSettings> {
  return request(endpoint(creds, 'getSettings'));
}

function setSettings(creds: Credentials): Promise<Record<string, unknown>> {
  return post(creds, 'setSettings', {
    webhookUrl: '',
    webhookUrlToken: '',
    incomingWebhook: 'yes',
    outgoingWebhook: 'yes',
    // Статусы доставки/прочтения: API-сообщения и сообщения с телефона
    outgoingAPIMessageWebhook: 'yes',
    outgoingMessageWebhook: 'yes',
    editedMessageWebhook: 'yes',
    deletedMessageWebhook: 'yes',
    incomingCallWebhook: 'yes',
    outgoingCallWebhook: 'yes',
    // Прочтение помечаем сами через readChat при открытии чата,
    // иначе собеседник видит синие галочки до реального прочтения
    markIncomingMessagesReaded: 'no',
    stateWebhook: 'yes',
  });
}

// Приём по HTTP API требует пустой webhookUrl. Если у инстанса уже
// настроен webhook - вернём его, чтобы UI мог предупредить пользователя.
export async function ensureReceivingSettings(
  creds: Credentials,
): Promise<{ overwrittenWebhookUrl: string | null }> {
  try {
    const settings = await getSettings(creds);
    const alreadyConfigured =
      !settings.webhookUrl &&
      settings.incomingWebhook === 'yes' &&
      settings.outgoingWebhook === 'yes' &&
      settings.outgoingAPIMessageWebhook === 'yes' &&
      settings.outgoingMessageWebhook === 'yes' &&
      settings.editedMessageWebhook === 'yes' &&
      settings.deletedMessageWebhook === 'yes' &&
      settings.incomingCallWebhook === 'yes' &&
      settings.outgoingCallWebhook === 'yes' &&
      settings.markIncomingMessagesReaded === 'no';
    if (alreadyConfigured) return { overwrittenWebhookUrl: null };
    await setSettings(creds);
    return { overwrittenWebhookUrl: settings.webhookUrl || null };
  } catch {
    return { overwrittenWebhookUrl: null };
  }
}

export function getGroupData(creds: Credentials, chatId: string): Promise<{ chatId: string }> {
  return post(creds, 'getGroupData', { chatId });
}

export interface ContactInfo {
  name?: string;
  /** Имя, как записано в телефонной книге аккаунта */
  contact?: string;
  avatar?: string;
  chatId?: string;
}

export function getContactInfo(creds: Credentials, chatId: string): Promise<ContactInfo> {
  return post(creds, 'getContactInfo', { chatId });
}

export interface JournalMessage {
  type?: 'incoming' | 'outgoing';
  idMessage?: string;
  timestamp?: number;
  statusMessage?: string;
  typeMessage?: string;
  chatId?: string;
  senderName?: string;
  senderContactName?: string;
  textMessage?: string;
  downloadUrl?: string;
  caption?: string;
  fileName?: string;
  jpegThumbnail?: string;
  isForwarded?: boolean;
  forwardingScore?: number;
  location?: {
    latitude?: number;
    longitude?: number;
    nameLocation?: string;
    addressLocation?: string;
    isForwarded?: boolean;
  };
  contact?: { displayName?: string; vcard?: string; isForwarded?: boolean };
  extendedTextMessage?: { text?: string; isForwarded?: boolean };
  pollMessage?: { name?: string; options?: { optionName: string }[] };
  quotedMessage?: QuotedMessage;
}

export function getChatHistory(
  creds: Credentials,
  chatId: string,
  count = 100,
): Promise<JournalMessage[]> {
  return post(creds, 'getChatHistory', { chatId, count });
}

/** Удаление сообщения из чата (только исходящие, у всех участников) */
export function deleteMessage(
  creds: Credentials,
  chatId: string,
  idMessage: string,
): Promise<void> {
  return post(creds, 'deleteMessage', { chatId, idMessage });
}

export function checkWhatsapp(
  creds: Credentials,
  phoneNumber: string,
): Promise<{ existsWhatsapp: boolean }> {
  return post(creds, 'checkWhatsapp', { phoneNumber: Number(phoneNumber) });
}

export function sendMessage(
  creds: Credentials,
  chatId: string,
  message: string,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'sendMessage', {
    chatId,
    message,
    ...(quotedMessageId ? { quotedMessageId } : {}),
  });
}

export function sendFileByUpload(
  creds: Credentials,
  chatId: string,
  file: File,
  caption?: string,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  const form = new FormData();
  form.append('chatId', chatId);
  form.append('file', file, file.name);
  if (caption) form.append('caption', caption);
  if (quotedMessageId) form.append('quotedMessageId', quotedMessageId);
  return request(endpoint(creds, 'sendFileByUpload'), { method: 'POST', body: form });
}

export function sendFileByUrl(
  creds: Credentials,
  chatId: string,
  urlFile: string,
  fileName: string,
  caption?: string,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'sendFileByUrl', {
    chatId,
    urlFile,
    fileName,
    ...(caption ? { caption } : {}),
    ...(quotedMessageId ? { quotedMessageId } : {}),
  });
}

/** Правка своего текстового сообщения (только API-сообщения, окно ~15 минут) */
export function editMessage(
  creds: Credentials,
  chatId: string,
  idMessage: string,
  message: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'editMessage', { chatId, idMessage, message });
}

/** Отметить чат прочитанным (весь чат или до конкретного сообщения) */
export function readChat(
  creds: Credentials,
  chatId: string,
  idMessage?: string,
): Promise<void> {
  return post(creds, 'readChat', { chatId, ...(idMessage ? { idMessage } : {}) });
}

/** 'Печатает...' у собеседника; typingTime 1000-20000 мс, typingType 'recording' для аудио */
export function sendTyping(
  creds: Credentials,
  chatId: string,
  typingTime = 5000,
): Promise<void> {
  return post(creds, 'sendTyping', { chatId, typingTime });
}

/** Пересылка сообщений из одного чата в другой */
export function forwardMessages(
  creds: Credentials,
  chatId: string,
  chatIdFrom: string,
  messages: string[],
): Promise<{ messages: string[] }> {
  return post(creds, 'forwardMessages', { chatId, chatIdFrom, messages });
}

export interface ContactPayload {
  phoneContact: number;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  company?: string;
}

export function sendContact(
  creds: Credentials,
  chatId: string,
  contact: ContactPayload,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'sendContact', {
    chatId,
    contact,
    ...(quotedMessageId ? { quotedMessageId } : {}),
  });
}

export function sendLocation(
  creds: Credentials,
  chatId: string,
  latitude: number,
  longitude: number,
  nameLocation?: string,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'sendLocation', {
    chatId,
    latitude,
    longitude,
    ...(nameLocation ? { nameLocation } : {}),
    ...(quotedMessageId ? { quotedMessageId } : {}),
  });
}

export function sendPoll(
  creds: Credentials,
  chatId: string,
  message: string,
  options: string[],
  multipleAnswers: boolean,
  quotedMessageId?: string,
): Promise<{ idMessage: string }> {
  return post(creds, 'sendPoll', {
    chatId,
    message,
    options: options.map((optionName) => ({ optionName })),
    multipleAnswers,
    ...(quotedMessageId ? { quotedMessageId } : {}),
  });
}

const RECEIVE_TIMEOUT_SEC = 30;

export function receiveNotification(
  creds: Credentials,
  signal?: AbortSignal,
): Promise<Notification | null> {
  return request<Notification | null>(
    endpoint(creds, 'receiveNotification') + `?receiveTimeout=${RECEIVE_TIMEOUT_SEC}`,
    { signal },
  );
}

export function deleteNotification(creds: Credentials, receiptId: number): Promise<unknown> {
  return request(endpoint(creds, 'deleteNotification', `/${receiptId}`), {
    method: 'DELETE',
  });
}

// ---------- Сервисные: список чатов и контактов ----------

export interface ChatListItem {
  id: string;
  name?: string;
  type?: 'user' | 'group';
  archive?: boolean;
  unreadCount?: number;
  ephemeralExpiration?: number;
  newChatId?: string;
}

export function getChats(creds: Credentials, count?: number): Promise<ChatListItem[]> {
  return request(endpoint(creds, 'getChats') + (count ? `?count=${count}` : ''));
}

export interface ContactListItem {
  id: string;
  /** Имя профиля WhatsApp (пустое, если переписки не было) */
  name?: string;
  /** Имя из телефонной книги аккаунта */
  contactName?: string;
  type?: 'user' | 'group';
  newChatId?: string;
}

export function getContacts(creds: Credentials): Promise<ContactListItem[]> {
  return request(endpoint(creds, 'getContacts'));
}

export function getAvatar(
  creds: Credentials,
  chatId: string,
): Promise<{ urlAvatar?: string; available?: boolean }> {
  return post(creds, 'getAvatar', { chatId });
}

// ---------- Журналы ----------

/** Одно сообщение по id - нужно, чтобы подтянуть оригинал цитаты вне истории */
export function getMessage(
  creds: Credentials,
  chatId: string,
  idMessage: string,
): Promise<JournalMessage> {
  return post(creds, 'getMessage', { chatId, idMessage });
}

export function lastIncomingMessages(
  creds: Credentials,
  minutes = 1440,
): Promise<JournalMessage[]> {
  return request(endpoint(creds, 'lastIncomingMessages') + `?minutes=${minutes}`);
}

export function lastOutgoingMessages(
  creds: Credentials,
  minutes = 1440,
): Promise<JournalMessage[]> {
  return request(endpoint(creds, 'lastOutgoingMessages') + `?minutes=${minutes}`);
}

export interface CallJournalItem {
  type?: 'incoming' | 'outgoing';
  idMessage?: string;
  timestamp?: number;
  typeMessage?: 'incomingCall' | 'outgoingCall';
  chatId?: string;
  /** Длительность в секундах; timestamp - время завершения звонка */
  duration?: number;
  isVideo?: boolean;
  isGroup?: boolean;
  status?: 'pickUp' | 'hungUp' | 'missed' | 'declined' | 'invalid' | string;
  participants?: { id?: string; status?: string }[];
}

export function lastIncomingCalls(
  creds: Credentials,
  minutes = 1440,
): Promise<CallJournalItem[]> {
  return request(endpoint(creds, 'lastIncomingCalls') + `?minutes=${minutes}`);
}

export function lastOutgoingCalls(
  creds: Credentials,
  minutes = 1440,
): Promise<CallJournalItem[]> {
  return request(endpoint(creds, 'lastOutgoingCalls') + `?minutes=${minutes}`);
}

// ---------- Файлы ----------

/** Свежая ссылка на файл сообщения - downloadUrl из вебхуков протухает */
export function downloadFile(
  creds: Credentials,
  chatId: string,
  idMessage: string,
): Promise<{ downloadUrl: string }> {
  return post(creds, 'downloadFile', { chatId, idMessage });
}

/** Залить файл в облако GREEN-API -> urlFile для sendFileByUrl (переиспользуемо) */
export function uploadFile(
  creds: Credentials,
  file: File,
): Promise<{ urlFile: string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request(mediaEndpoint(creds, 'uploadFile'), { method: 'POST', body: form });
}

// ---------- Аккаунт / состояние инстанса ----------

export interface WaSettings {
  avatar?: string;
  chatId?: string;
  phone?: string;
  stateInstance?: string;
  historySyncProgress?: number;
  deviceId?: string;
}

export function getWaSettings(creds: Credentials): Promise<WaSettings> {
  return request(endpoint(creds, 'getWaSettings'));
}

export interface StateInstanceRecord {
  stateInstance?: string;
  timestamp?: number;
  phoneNumber?: string;
}

export function getStateInstanceHistory(
  creds: Credentials,
  count = 100,
): Promise<StateInstanceRecord[]> {
  return request(endpoint(creds, 'getStateInstanceHistory') + `?count=${count}`);
}

export function reboot(creds: Credentials): Promise<{ isReboot: boolean }> {
  return request(endpoint(creds, 'reboot'));
}

/** Разлогинивает инстанс (WhatsApp-сессия слетает, нужен QR заново) */
export function logoutInstance(creds: Credentials): Promise<{ isLogout: boolean }> {
  return request(endpoint(creds, 'logout'));
}

// ---------- Очереди ----------

export interface QueuedMessage {
  messageID?: string;
  messagesIDs?: string[];
  /** Тип исходящего метода: sendMessage, sendFileByUrl, ForwardMessages... */
  type?: string;
  /** Тело исходного запроса на отправку */
  body?: { chatId?: string; message?: string; fileName?: string; urlFile?: string };
}

export function showMessagesQueue(creds: Credentials): Promise<QueuedMessage[]> {
  return request(endpoint(creds, 'showMessagesQueue'));
}

export function getMessagesCount(creds: Credentials): Promise<{ count: number }> {
  return request(endpoint(creds, 'getMessagesCount'));
}

export function clearMessagesQueue(creds: Credentials): Promise<{ isCleared: boolean }> {
  return request(endpoint(creds, 'clearMessagesQueue'));
}

export function getWebhooksCount(creds: Credentials): Promise<{ count: number }> {
  return request(endpoint(creds, 'getWebhooksCount'));
}

export function clearWebhooksQueue(
  creds: Credentials,
): Promise<{ isCleared: boolean; reason?: string; leftTime?: number }> {
  return request(endpoint(creds, 'clearWebhooksQueue'));
}
