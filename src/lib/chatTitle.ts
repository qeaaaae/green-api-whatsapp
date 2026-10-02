import { getAvatar, getContactInfo } from '../api/greenApi';
import { isPhoneLike } from './chatId';
import { useChatStore } from '../store/chatStore';
import type { Credentials } from '../types';

const attempted = new Set<string>();
const avatarAttempted = new Set<string>();

/**
 * Если у чата нет человекочитаемого имени, подтягивает его через getContactInfo.
 * Вызывается лениво - один раз на chatId за сессию, ошибки API игнорируются.
 */
export async function ensureChatTitle(creds: Credentials, chatId: string): Promise<void> {
  if (!chatId.endsWith('@c.us') || attempted.has(chatId)) return;
  attempted.add(chatId);
  const chat = useChatStore.getState().chats[chatId];
  const needName = !chat?.title || isPhoneLike(chat.title);
  try {
    const info = await getContactInfo(creds, chatId);
    const name = info.contact || info.name;
    if (needName && name) useChatStore.getState().setChatTitle(chatId, name);
    if (info.avatar) {
      useChatStore.getState().setChatAvatar(chatId, info.avatar);
    } else {
      void ensureChatAvatar(creds, chatId);
    }
  } catch {
    // квота/сеть - остаётся номер, повторим в следующей сессии
    attempted.delete(chatId);
  }
}

/**
 * Фоллбэк аватара через getAvatar - когда getContactInfo не вернул фото
 * (приватность) или для групп. Лениво, один раз на chatId за сессию.
 */
export async function ensureChatAvatar(
  creds: Credentials,
  chatId: string,
): Promise<void> {
  const chat = useChatStore.getState().chats[chatId];
  if (chat?.avatar || avatarAttempted.has(chatId)) return;
  avatarAttempted.add(chatId);
  try {
    const { urlAvatar } = await getAvatar(creds, chatId);
    if (urlAvatar) useChatStore.getState().setChatAvatar(chatId, urlAvatar);
  } catch {
    avatarAttempted.delete(chatId);
  }
}
