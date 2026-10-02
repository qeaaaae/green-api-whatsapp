import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { Avatar, Button, Empty, Input, Modal, Typography, message, type InputRef } from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  CloseOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  deleteMessage,
  downloadFile,
  editMessage,
  forwardMessages,
  readChat,
  sendFileByUpload,
  sendFileByUrl,
  sendMessage,
  sendTyping,
  uploadFile,
} from '../api/greenApi';
import { ensureChatTitle } from '../lib/chatTitle';
import { ensureChatHistory } from '../lib/history';
import { avatarColor, formatMessageDate, isSameDay } from '../lib/format';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import type { ChatMessage } from '../types';
import { AttachmentMenu, type OutgoingDraft } from './AttachmentMenu';
import { replyQuoteOf } from './attachments/types';
import { MessageBubble } from './MessageBubble';

// readChat на Developer-тарифе ограничен месячной квотой (466 при исчерпании) -
// не дёргаем чаще раза в 15 с на чат
const READ_CHAT_INTERVAL = 15_000;
const lastReadChatAt = new Map<string, number>();

export function ChatWindow({ onBack }: { onBack?: () => void }) {
  const chat = useChatStore((s) => (s.activeChatId ? s.chats[s.activeChatId] : undefined));
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const credentials = useAuthStore((s) => s.credentials);
  const chats = useChatStore((s) => s.chats);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const messagesRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<InputRef>(null);
  const lastTypingSent = useRef(0);
  const atBottomRef = useRef(true);
  const prevListHeightRef = useRef(0);
  const prevListChatRef = useRef<string | null>(null);

  const chatId = chat?.chatId;
  const lastMessageId = chat?.messages.at(-1)?.id;

  // Скролл: вход в чат - мгновенно вниз (без smooth-анимации), новые сообщения
  // опускают вниз только если юзер уже у низа, prepend истории - позиция стоит
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (prevListChatRef.current !== (chatId ?? null)) {
      prevListChatRef.current = chatId ?? null;
      atBottomRef.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      const grown = el.scrollHeight - prevListHeightRef.current;
      if (grown > 0) el.scrollTop += grown;
    }
    prevListHeightRef.current = el.scrollHeight;
  }, [chatId, chat?.messages.length]);

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    prevListHeightRef.current = el.scrollHeight;
  };

  // Таймер подсветки чистим на unmount - иначе setState на мёртвом компоненте
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  // Подтягиваем имя контакта и историю (сообщения до входа в приложение)
  useEffect(() => {
    if (credentials && chatId) {
      void ensureChatTitle(credentials, chatId);
      void ensureChatHistory(credentials, chatId);
    }
  }, [credentials, chatId]);

  // При смене чата сбрасываем режимы ответа/правки (adjust-state-on-render)
  const [prevChatId, setPrevChatId] = useState(chatId);
  if (prevChatId !== chatId) {
    setPrevChatId(chatId);
    setReplyTo(null);
    setEditing(null);
    setText('');
    setHighlightId(null);
  }

  // readChat: помечаем прочитанным при открытии и приходе новых сообщений
  // (авто-прочтение на инстансе выключено - markIncomingMessagesReaded: 'no')
  useEffect(() => {
    if (!credentials || !chatId || !lastMessageId) return;
    const last = lastReadChatAt.get(chatId) ?? 0;
    if (Date.now() - last < READ_CHAT_INTERVAL) return;
    lastReadChatAt.set(chatId, Date.now());
    void readChat(credentials, chatId).catch(() => {});
  }, [credentials, chatId, lastMessageId]);

  // Без чата показываем заглушку; без credentials окно не рендерится вовсе
  // (ChatScreen открывается только после логина) - гард убирает вопросительные
  if (!chat || !chatId || !credentials) {
    return (
      <div className="chat-window chat-window--empty">
        <Empty description="Выберите чат или создайте новый" />
      </div>
    );
  }

  // Оптимистичная отправка: локальное сообщение + реальный запрос к GREEN-API
  const sendOutgoing = (
    draft: OutgoingDraft,
    call: () => Promise<{ idMessage: string }>,
  ) => {
    setReplyTo(null);
    const localId = `local-${crypto.randomUUID()}`;
    addMessage(chatId, {
      id: localId,
      text: draft.text,
      timestamp: Math.floor(Date.now() / 1000),
      outgoing: true,
      status: 'pending',
      kind: draft.kind,
      url: draft.url,
      quote: draft.quote,
      extra: draft.extra,
    });
    void call()
      .then(({ idMessage }) => updateMessage(chatId, localId, { id: idMessage, status: 'sent' }))
      .catch((error) => {
        updateMessage(chatId, localId, { status: 'error' });
        messageApi.error(error instanceof Error ? error.message : 'Ошибка отправки');
      });
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    // Режим правки: меняем существующее сообщение через editMessage
    if (editing) {
      const target = editing;
      setEditing(null);
      setText('');
      if (target.text === value) return;
      void editMessage(credentials, chatId, target.id, value)
        .then(() => updateMessage(chatId, target.id, { text: value, edited: true }))
        .catch((error) => {
          messageApi.error(
            error instanceof Error ? error.message : 'Не удалось отредактировать',
          );
        });
      return;
    }
    const quoted = replyTo;
    const quote = replyQuoteOf(quoted);
    // У входящего без senderName показываем имя чата
    if (quote && !quote.sender) quote.sender = chat.title;
    setText('');
    sendOutgoing({ text: value, kind: 'text', quote }, () =>
      sendMessage(credentials, chatId, value, quoted?.id),
    );
  };

  // 'Печатает...' у собеседника - только при наборе (текст растёт),
  // стирание не считаем. Throttle, чтобы не спамить API.
  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const typing = value.length > text.length;
    setText(value);
    if (!typing || editing || !credentials) return;
    const now = Date.now();
    if (now - lastTypingSent.current > 4000) {
      lastTypingSent.current = now;
      void sendTyping(credentials, chatId, 5000).catch(() => {});
    }
  };

  const startReply = (m: ChatMessage) => {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  };

  const startEdit = (m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.text);
    inputRef.current?.focus();
  };

  // Клик по цитате - скролл к оригиналу + вспышка.
  // Скроллим только messages-контейнер вручную (scrollIntoView крутил бы предков)
  const jumpToMessage = (id: string) => {
    const container = messagesRef.current;
    const el = container?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(id)}"]`,
    );
    if (!container || !el) {
      messageApi.info('Сообщение вне загруженной истории');
      return;
    }
    container.scrollTo({
      top: el.offsetTop + el.offsetHeight / 2 - container.clientHeight / 2,
      behavior: 'smooth',
    });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1400);
  };

  const doForward = async (targetChatId: string) => {
    const m = forwarding;
    setForwarding(null);
    if (!m || !credentials) return;
    try {
      await forwardMessages(credentials, targetChatId, chatId, [m.id]);
      messageApi.success('Сообщение переслано');
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : 'Не удалось переслать',
      );
    }
  };

  // Фото с камеры (на телефоне capture открывает камеру, на ПК - выбор файла)
  const sendPhoto = (file: File) => {
    const quoted = replyTo;
    const quote = replyQuoteOf(quoted);
    if (quote && !quote.sender) quote.sender = chat.title;
    sendOutgoing(
      {
        text: 'Изображение',
        kind: 'image',
        url: URL.createObjectURL(file),
        quote,
      },
      () => sendFileByUpload(credentials, chatId, file, undefined, quoted?.id),
    );
  };

  // Удаление исходящего сообщения у всех участников (GREEN-API deleteMessage)
  // Пузырь остаётся плейсхолдером 'Сообщение удалено', как в WhatsApp
  const remove = async (m: ChatMessage) => {
    if (!credentials) return;
    try {
      await deleteMessage(credentials, chatId, m.id);
      // blob:-превью больше не нужно - отзываем, не копим утечки
      if (m.url?.startsWith('blob:')) URL.revokeObjectURL(m.url);
      updateMessage(chatId, m.id, {
        deleted: true,
        text: 'Сообщение удалено',
        url: undefined,
        extra: undefined,
        quote: undefined,
        reaction: undefined,
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Не удалось удалить');
    }
  };

  // Свежая ссылка на файл сообщения: downloadUrl у GREEN-API протухает,
  // downloadFile по idMessage возвращает актуальную
  const resolveUrl = async (m: ChatMessage): Promise<string | null> => {
    if (!credentials || m.id.startsWith('local-')) return m.url ?? null;
    try {
      const { downloadUrl } = await downloadFile(credentials, chatId, m.id);
      if (downloadUrl) {
        updateMessage(chatId, m.id, { url: downloadUrl });
        return downloadUrl;
      }
    } catch {
      // файл уже удалён с хранилища - остаётся старая ссылка
    }
    return m.url ?? null;
  };

  // Ретрай: текст шлём заново; у медиа берём блоб по сохранённому url
  // (blob:-ссылка живёт в рамках сессии), заливаем через uploadFile
  // и отправляем sendFileByUrl
  const retry = (m: ChatMessage) => {
    if (!credentials) return;
    const kind = m.kind ?? 'text';
    updateMessage(chatId, m.id, { status: 'pending' });
    if (kind === 'text') {
      void sendMessage(credentials, chatId, m.text)
        .then(({ idMessage }) =>
          updateMessage(chatId, m.id, { id: idMessage, status: 'sent' }),
        )
        .catch(() => updateMessage(chatId, m.id, { status: 'error' }));
      return;
    }
    void (async () => {
      if (!m.url) throw new Error('no url');
      const blob = await fetch(m.url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      });
      const ext = blob.type.split('/')[1]?.split(';')[0] || 'bin';
      const name = kind === 'file' && m.text ? m.text : `${kind}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      const { urlFile } = await uploadFile(credentials, file);
      const { idMessage } = await sendFileByUrl(credentials, chatId, urlFile, name);
      updateMessage(chatId, m.id, { id: idMessage, status: 'sent', url: urlFile });
    })().catch(() => updateMessage(chatId, m.id, { status: 'error' }));
  };

  return (
    <div className="chat-window">
      {contextHolder}
      <div className="chat-window__header">
        {onBack && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            aria-label="Назад к списку чатов"
            onClick={onBack}
            className="chat-window__back"
          />
        )}
        <Avatar
          size={40}
          src={chat.avatar}
          style={{ backgroundColor: avatarColor(chatId), flexShrink: 0 }}
        >
          {chat.title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'}
        </Avatar>
        <div>
          <Typography.Text strong>{chat.title}</Typography.Text>
          <Typography.Text type="secondary" className="chat-window__chatid">
            {chatId}
          </Typography.Text>
        </div>
      </div>
      <div
        ref={messagesRef}
        className="chat-window__messages"
        // На весь список сообщений - наше меню, браузерное не нужно
        onContextMenu={(e) => e.preventDefault()}
        onScroll={onMessagesScroll}
      >
        {chat.messages.map((m, i) => {
          const prev = chat.messages[i - 1];
          const isGroupStart = !prev || prev.outgoing !== m.outgoing;
          const showDate = !prev || !isSameDay(prev.timestamp, m.timestamp);
          return (
            <Fragment key={m.id}>
              {showDate && (
                <div className="chat-date">
                  <span>{formatMessageDate(m.timestamp)}</span>
                </div>
              )}
              <MessageBubble
                message={m}
                isGroupStart={isGroupStart}
                senderLabel={
                  isGroupStart
                    ? m.outgoing
                      ? 'Вы'
                      : (m.senderName ?? chat.title)
                    : undefined
                }
                onRetry={retry}
                onReply={startReply}
                onEdit={startEdit}
                onForward={setForwarding}
                onDelete={remove}
                onQuoteClick={jumpToMessage}
                onResolveUrl={resolveUrl}
                highlighted={m.id === highlightId}
              />
            </Fragment>
          );
        })}
      </div>
      {(replyTo || editing) && (
        <div className="compose-context">
          <div className="compose-context__body">
            <span className="compose-context__title">
              {editing
                ? 'Редактирование'
                : replyTo?.outgoing
                  ? 'Вы'
                  : (replyTo?.senderName ?? chat.title)}
            </span>
            <span className="compose-context__text">
              {editing ? editing.text : replyTo?.text}
            </span>
          </div>
          <Button
            type="text"
            icon={<CloseOutlined />}
            aria-label="Отмена"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              setText('');
            }}
          />
        </div>
      )}
      <div className="chat-window__input">
        <AttachmentMenu
          credentials={credentials}
          chatId={chatId}
          replyTo={replyTo}
          onSend={sendOutgoing}
        />
        <Input
          ref={inputRef}
          placeholder={editing ? 'Изменить сообщение' : 'Сообщение'}
          value={text}
          onChange={onInputChange}
          onPressEnter={send}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif,image/bmp"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) sendPhoto(f);
          }}
        />
        <Button
          type="text"
          icon={<CameraOutlined />}
          aria-label="Сделать фото"
          onClick={() => cameraInputRef.current?.click()}
        />
        <Button
          type="primary"
          shape="circle"
          icon={editing ? <EditIcon /> : <SendOutlined />}
          aria-label={editing ? 'Сохранить изменения' : 'Отправить'}
          onClick={send}
          disabled={!text.trim()}
        />
      </div>
      <Modal
        title="Переслать сообщение"
        open={!!forwarding}
        footer={null}
        onCancel={() => setForwarding(null)}
      >
        <div className="forward-list">
          {Object.values(chats)
            .filter((c) => c.chatId !== chatId)
            .map((c) => (
              <div
                key={c.chatId}
                className="chat-list__item forward-list__item"
                role="button"
                tabIndex={0}
                onClick={() => void doForward(c.chatId)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && void doForward(c.chatId)
                }
              >
                <Avatar
                  size={40}
                  src={c.avatar}
                  style={{ backgroundColor: avatarColor(c.chatId), flexShrink: 0 }}
                >
                  {c.title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'}
                </Avatar>
                <div className="chat-list__item-body">
                  <Typography.Text strong ellipsis>
                    {c.title}
                  </Typography.Text>
                  <Typography.Text ellipsis type="secondary">
                    {c.chatId}
                  </Typography.Text>
                </div>
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
}

function EditIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}


