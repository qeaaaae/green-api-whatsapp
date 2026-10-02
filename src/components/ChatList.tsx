import { useEffect, useMemo, useState } from 'react';
import { AutoComplete, Avatar, Button, Empty, Input, Listy, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  checkWhatsapp,
  getContacts,
  getGroupData,
  type ContactListItem,
} from '../api/greenApi';
import { ensureChatAvatar, ensureChatTitle } from '../lib/chatTitle';
import { contactLabel, matchContact } from '../lib/contacts';
import { useAuthStore } from '../store/authStore';
import { formatPhoneInput, isSendableChatId, toChatId } from '../lib/chatId';
import { avatarColor, formatMessageTime } from '../lib/format';
import { useChatStore } from '../store/chatStore';

export function ChatList() {
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const addChat = useChatStore((s) => s.addChat);
  const selectChat = useChatStore((s) => s.selectChat);
  const credentials = useAuthStore((s) => s.credentials);
  const [phone, setPhone] = useState('');
  const [checking, setChecking] = useState(false);
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  // Автодополнение по телефонной книге аккаунта (getContacts).
  // Служебные id вроде 0@c.us отсекаем - в них писать всё равно нельзя
  useEffect(() => {
    if (!credentials) return;
    void getContacts(credentials)
      .then((list) =>
        setContacts(list.filter((c) => isSendableChatId(c.newChatId ?? c.id))),
      )
      .catch(() => {});
  }, [credentials]);

  const items = Object.values(chats).sort(
    (a, b) =>
      (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0),
  );

  // Эффект зависит от состава чатов, а не от их сообщений
  const chatIds = useMemo(() => items.map((c) => c.chatId).join(','), [items]);

  // Лениво дотягиваем аватары чатов, у которых их ещё нет
  useEffect(() => {
    if (!credentials) return;
    for (const chatId of chatIds.split(',')) {
      if (chatId && !chats[chatId]?.avatar) {
        void ensureChatAvatar(credentials, chatId);
      }
    }
  }, [credentials, chatIds, chats]);

  const contactByChatId = useMemo(
    () => new Map(contacts.map((c) => [c.newChatId ?? c.id, c])),
    [contacts],
  );

  const pickContact = (chatId: string) => {
    const contact = contactByChatId.get(chatId);
    addChat(chatId, contact ? contactLabel(contact) : chatId);
    if (credentials) void ensureChatTitle(credentials, chatId);
    setPhone('');
  };

  const createChat = async () => {
    const raw = phone.trim();
    const chatId = toChatId(raw);
    if (!chatId || !credentials) {
      messageApi.warning('Введите номер телефона или chatId');
      return;
    }
    const isUser = chatId.endsWith('@c.us');
    const isGroup = chatId.endsWith('@g.us');
    if (isUser || isGroup) {
      // служебные id (0@c.us, status@broadcast) GREEN-API сам не принимает
      if (!isSendableChatId(chatId)) {
        messageApi.warning('Некорректный chatId');
        return;
      }
    } else {
      // нестандартный chatId - создаём как есть
      addChat(chatId, raw);
      setPhone('');
      return;
    }
    setChecking(true);
    try {
      if (isGroup) {
        await getGroupData(credentials, chatId);
      } else {
        const phoneNumber = chatId.slice(0, chatId.indexOf('@'));
        const { existsWhatsapp } = await checkWhatsapp(credentials, phoneNumber);
        if (!existsWhatsapp) {
          messageApi.error('На этом номере нет WhatsApp');
          return;
        }
      }
      addChat(chatId, raw);
      void ensureChatTitle(credentials, chatId);
      setPhone('');
    } catch {
      // Проверка best-effort: ошибки API (квота, сеть) не блокируют создание
      addChat(chatId, raw);
      void ensureChatTitle(credentials, chatId);
      setPhone('');
      messageApi.warning('Не удалось проверить - чат создан без проверки');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="chat-list">
      {contextHolder}
      <div className="chat-list__new">
        <AutoComplete
          className="chat-list__autocomplete"
          value={phone}
          options={contacts.map((c) => {
            const chatId = c.newChatId ?? c.id;
            return {
              value: chatId,
              label: `${contactLabel(c)} · ${chatId}`,
            };
          })}
          filterOption={(input, option) => {
            const c = contactByChatId.get(String(option?.value ?? ''));
            return c ? matchContact(input, c) : false;
          }}
          onChange={(v) => {
            // при выборе опции onChange тоже стреляет - её обрабатывает pickContact
            if (!contactByChatId.has(v)) setPhone(formatPhoneInput(v));
          }}
          onSelect={pickContact}
          disabled={checking}
        >
          <Input
            placeholder="Номер телефона или chatId"
            onPressEnter={createChat}
            disabled={checking}
          />
        </AutoComplete>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="Создать чат"
          onClick={createChat}
          loading={checking}
        />
      </div>
      {items.length === 0 ? (
        <Empty description="Нет чатов" className="chat-list__empty" />
      ) : (
        <Listy
          className="chat-list__items"
          items={items}
          rowKey="chatId"
          itemRender={(chat) => {
            const last = chat.messages.at(-1);
            return (
              <div
                className={`chat-list__item${chat.chatId === activeChatId ? ' chat-list__item--active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => selectChat(chat.chatId)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && selectChat(chat.chatId)
                }
              >
                <Avatar
                  size={40}
                  src={chat.avatar}
                  style={{ backgroundColor: avatarColor(chat.chatId), flexShrink: 0 }}
                >
                  {chat.title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'}
                </Avatar>
                <div className="chat-list__item-body">
                  <div className="chat-list__title-row">
                    <Typography.Text strong ellipsis>
                      {chat.title}
                    </Typography.Text>
                    {last && (
                      <span
                        className={`chat-list__time${chat.unread ? ' chat-list__time--unread' : ''}`}
                      >
                        {formatMessageTime(last.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="chat-list__preview-row">
                    <Typography.Text ellipsis type="secondary" className="chat-list__preview">
                      {last ? (last.deleted ? 'Сообщение удалено' : last.text) : 'Нет сообщений'}
                    </Typography.Text>
                    {!!chat.unread && (
                      <span className="chat-list__unread">{chat.unread}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
