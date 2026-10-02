import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { Dropdown, type MenuProps } from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentFilled,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PhoneOutlined,
  ShareAltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { formatMessageTime } from '../lib/format';
import { tilesCovering, tileUrl } from '../lib/geo';
import { linkify } from '../lib/linkify';
import { GENERIC_TEXT } from '../lib/notifications';
import type { ChatMessage } from '../types';
import { ImageLightbox } from './ImageLightbox';

type UrlResolver = (message: ChatMessage) => Promise<string | null>;

// Мёртвая ссылка на медиа - один раз пробуем обновить через downloadFile
function useUrlRefresh(message: ChatMessage, onResolveUrl?: UrlResolver) {
  const refreshed = useRef(false);
  return () => {
    if (!onResolveUrl || refreshed.current) return;
    refreshed.current = true;
    void onResolveUrl(message);
  };
}

const MAP_W = 320;
const MAP_H = 150;
const MAP_ZOOM = 15;

// Мини-карта из растровых тайлов OSM - отдельный сервис статических карт
// не нужен (staticmap.openstreetmap.de умер), тайлы грузит любой CDN OSM
function TileMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  return (
    <span className="bubble__map">
      <span className="bubble__map-tiles">
        {tilesCovering(latitude, longitude, MAP_ZOOM, MAP_W, MAP_H).map((t) => (
          <img
            key={`${t.x}/${t.y}`}
            src={tileUrl(t.x, t.y, MAP_ZOOM)}
            alt=""
            loading="lazy"
            style={{ left: t.left, top: t.top }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ))}
      </span>
      <EnvironmentFilled className="bubble__map-pin" />
    </span>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isGroupStart: boolean;
  /** Подпись отправителя - показывается на первом сообщении группы */
  senderLabel?: string;
  onRetry?: (message: ChatMessage) => void;
  onReply?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  /** Удаление сообщения (только исходящие - ограничение GREEN-API) */
  onDelete?: (message: ChatMessage) => void;
  /** Клик по цитате - скролл к исходному сообщению */
  onQuoteClick?: (quoteId: string) => void;
  /** Свежая ссылка на файл через downloadFile (старые url протухают) */
  onResolveUrl?: (message: ChatMessage) => Promise<string | null>;
  /** Вспышка-подсветка после перехода по цитате */
  highlighted?: boolean;
}

export function MessageBubble({
  message,
  isGroupStart,
  senderLabel,
  onRetry,
  onReply,
  onEdit,
  onForward,
  onDelete,
  onQuoteClick,
  onResolveUrl,
  highlighted,
}: MessageBubbleProps) {
  const dir = message.outgoing ? 'out' : 'in';
  const kind = message.kind ?? 'text';
  const isImage = kind === 'image' && !!message.url;
  const isVideo = kind === 'video' && !!message.url;
  const isMedia = isImage || isVideo;
  const isCard = !isMedia && kind !== 'text';
  const [lightbox, setLightbox] = useState(false);
  const meta = (
    <span className={`bubble__meta${isMedia ? ' bubble__meta--media' : ''}`}>
      {message.edited && !message.deleted && (
        <span className="bubble__edited">изменено</span>
      )}
      {formatMessageTime(message.timestamp)}
      {message.outgoing && !message.deleted && (
        <StatusIcon status={message.status} message={message} onRetry={onRetry} />
      )}
    </span>
  );

  // local- сообщения ещё не имеют настоящего idMessage - действия с ними невозможны
  const isLocal = message.id.startsWith('local-');
  const menuItems: MenuProps['items'] = [];
  if (!message.deleted && !isLocal) {
    if (onReply) {
      menuItems.push({ key: 'reply', icon: <CommentOutlined />, label: 'Ответить' });
    }
    if (onForward) {
      menuItems.push({ key: 'forward', icon: <ShareAltOutlined />, label: 'Переслать' });
    }
  }
  if (message.outgoing && !message.deleted && !isLocal) {
    if (onEdit && kind === 'text') {
      menuItems.push({ key: 'edit', icon: <EditOutlined />, label: 'Редактировать' });
    }
    if (onDelete) {
      menuItems.push({
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Удалить сообщение',
        danger: true,
      });
    }
  }
  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    setMenuOpen(false);
    if (key === 'reply') onReply?.(message);
    if (key === 'forward') onForward?.(message);
    if (key === 'edit') onEdit?.(message);
    if (key === 'delete') onDelete?.(message);
  };
  const caption = !GENERIC_TEXT.has(message.text) ? message.text : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressPos = useRef({ x: 0, y: 0 });
  /** true, если меню открыто long-press'ом - следующий click гасим */
  const longPressed = useRef(false);
  const refreshMediaUrl = useUrlRefresh(message, onResolveUrl);

  // Таймер long-press не должен пережить компонент
  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  // Long-press на тачах = ПКМ на десктопе
  const onBubbleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!menuItems.length || !t) return;
    pressPos.current = { x: t.clientX, y: t.clientY };
    longPressed.current = false;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setMenuOpen(true);
    }, 500);
  };

  // Скролл/сдвиг пальца отменяет long-press
  const onBubbleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    if (
      Math.hypot(t.clientX - pressPos.current.x, t.clientY - pressPos.current.y) >
      10
    ) {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    }
  };

  const onBubbleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  // Отпускание пальца после long-press порождает click -
  // гасим, чтобы не открылся лайтбокс/ссылка под меню
  const onBubbleClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (longPressed.current) {
      longPressed.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const bubble = (
    <div
      className={`bubble bubble--${dir}${isGroupStart ? ` bubble--${dir}-tail` : ''}${isMedia ? ' bubble--media' : ''}${isCard ? ' bubble--card' : ''}${highlighted ? ' bubble--highlight' : ''}`}
      data-message-id={message.id}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={onBubbleTouchStart}
      onTouchMove={onBubbleTouchMove}
      onTouchEnd={onBubbleTouchEnd}
      onTouchCancel={onBubbleTouchEnd}
      onClickCapture={onBubbleClickCapture}
    >
      {isGroupStart && senderLabel && (
        <span className="bubble__sender">{senderLabel}</span>
      )}
      {message.forwarded && !message.deleted && (
        <span className="bubble__forwarded">
          <ShareAltOutlined /> Переслано
        </span>
      )}
      {message.quote && !message.deleted && (
        <QuoteBlock quote={message.quote} onQuoteClick={onQuoteClick} />
      )}
      {message.deleted ? (
        <>
          <span className="bubble__text bubble__text--deleted">
            Сообщение удалено
          </span>
          {meta}
        </>
      ) : isMedia ? (
        <>
          <div
            className="bubble__media"
            onClick={isImage ? () => setLightbox(true) : undefined}
          >
            {isVideo ? (
              <video
                src={message.url}
                poster={message.extra?.thumbnail}
                controls
                preload="metadata"
                onError={refreshMediaUrl}
              />
            ) : (
              <img src={message.url} alt={message.text} onError={refreshMediaUrl} />
            )}
            {meta}
          </div>
          {caption && (
            <span className="bubble__text bubble__caption">
              <LinkedText text={caption} />
            </span>
          )}
          {lightbox && (
            <ImageLightbox
              src={message.url!}
              caption={caption}
              onClose={() => setLightbox(false)}
            />
          )}
        </>
      ) : (
        <>
          <MessageBody message={message} onResolveUrl={onResolveUrl} />
          {meta}
        </>
      )}
      {message.reaction && !message.deleted && (
        <span className={`bubble__reaction bubble__reaction--${dir}`}>
          {message.reaction}
        </span>
      )}
    </div>
  );

  // ПКМ открывает меню через antd; long-press - через управляемый open
  return menuItems.length > 0 ? (
    <Dropdown
      trigger={['contextMenu']}
      placement={dir === 'out' ? 'bottomRight' : 'bottomLeft'}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menu={{ items: menuItems, onClick: onMenuClick }}
    >
      {bubble}
    </Dropdown>
  ) : (
    bubble
  );
}

function MessageBody({
  message,
  onResolveUrl,
}: {
  message: ChatMessage;
  onResolveUrl?: UrlResolver;
}) {
  const kind = message.kind ?? 'text';
  const extra = message.extra;
  const refreshUrl = useUrlRefresh(message, onResolveUrl);

  if (kind === 'audio' && message.url) {
    return (
      <audio
        className="bubble__audio"
        controls
        preload="metadata"
        src={message.url}
        onError={refreshUrl}
      />
    );
  }

  if (kind === 'file' || kind === 'image') {
    const body = (
      <span className="bubble__card">
        <span className="bubble__card-icon">
          <FileTextOutlined />
        </span>
        <span className="bubble__card-body">
          <span className="bubble__card-title">{message.text}</span>
          {message.url && <span className="bubble__card-sub">Скачать</span>}
        </span>
      </span>
    );
    return message.url ? (
      <a
        className="bubble__link"
        href={message.url}
        target="_blank"
        rel="noreferrer"
        // Ссылка могла протухнуть - перед открытием просим свежую у GREEN-API
        onClick={
          onResolveUrl
            ? (e) => {
                e.preventDefault();
                void onResolveUrl(message).then(
                  (u) => u && window.open(u, '_blank', 'noopener,noreferrer'),
                );
              }
            : undefined
        }
      >
        {body}
      </a>
    ) : (
      body
    );
  }

  if (kind === 'contact') {
    return (
      <span className="bubble__card">
        <span className="bubble__card-icon">
          <UserOutlined />
        </span>
        <span className="bubble__card-body">
          <span className="bubble__card-title">
            {extra?.contactName || 'Контакт'}
          </span>
          {extra?.phone && <span className="bubble__card-sub">{extra.phone}</span>}
          {extra?.company && (
            <span className="bubble__card-sub">{extra.company}</span>
          )}
        </span>
      </span>
    );
  }

  if (kind === 'location') {
    const { latitude, longitude, locationName, address } = extra ?? {};
    const hasCoords = latitude != null && longitude != null;
    const card = (
      <>
        {hasCoords && <TileMap latitude={latitude} longitude={longitude} />}
        <span className="bubble__card">
          <span className="bubble__card-icon">
            <EnvironmentOutlined />
          </span>
          <span className="bubble__card-body">
            <span className="bubble__card-title">{locationName || 'Геолокация'}</span>
            {address && <span className="bubble__card-sub">{address}</span>}
            {hasCoords && (
              <span className="bubble__card-sub">
                {latitude}, {longitude}
              </span>
            )}
          </span>
        </span>
      </>
    );
    return hasCoords ? (
      <a
        className="bubble__link"
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`}
        target="_blank"
        rel="noreferrer"
      >
        {card}
      </a>
    ) : (
      card
    );
  }

  if (kind === 'call') {
    const status = extra?.callStatus;
    const missed =
      status === 'hungUp' || status === 'declined' || status === 'missed';
    return (
      <span className={`bubble__card${missed ? ' bubble__card--missed' : ''}`}>
        <span className="bubble__card-icon">
          <PhoneOutlined />
        </span>
        <span className="bubble__card-body">
          <span className="bubble__card-title">{message.text}</span>
        </span>
      </span>
    );
  }

  if (kind === 'poll') {
    return (
      <span className="bubble__poll">
        <span className="bubble__poll-question">
          {message.text === 'Опрос' ? 'Опрос' : message.text}
        </span>
        {extra?.options?.map((option, i) => (
          <span key={i} className="bubble__poll-option">
            <span className="bubble__poll-radio" />
            {option}
          </span>
        ))}
        <span className="bubble__poll-hint">
          {extra?.options?.length
            ? 'Выберите один или несколько вариантов'
            : 'Опрос'}
        </span>
      </span>
    );
  }

  return (
    <span className="bubble__text">
      <LinkedText text={message.text} />
    </span>
  );
}

// Ссылки в тексте - кликабельные, открываются в новой вкладке
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.url ? (
          <a
            key={i}
            className="bubble__url"
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {seg.text}
          </a>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

function QuoteBlock({
  quote,
  onQuoteClick,
}: {
  quote: NonNullable<ChatMessage['quote']>;
  onQuoteClick?: (quoteId: string) => void;
}) {
  return (
    <span
      className={`bubble__quote${onQuoteClick && quote.id ? ' bubble__quote--clickable' : ''}`}
      role={onQuoteClick && quote.id ? 'button' : undefined}
      tabIndex={onQuoteClick && quote.id ? 0 : undefined}
      onClick={quote.id ? () => onQuoteClick?.(quote.id!) : undefined}
      onKeyDown={
        quote.id && onQuoteClick
          ? (e) => e.key === 'Enter' && onQuoteClick(quote.id!)
          : undefined
      }
    >
      {quote.sender && (
        <span className="bubble__quote-sender">{quote.sender}</span>
      )}
      <span className="bubble__quote-body">
        {quote.thumbnail && (
          <img className="bubble__quote-thumb" src={quote.thumbnail} alt="" />
        )}
        <span className="bubble__quote-text">{quote.text}</span>
      </span>
    </span>
  );
}

function StatusIcon({
  status,
  message,
  onRetry,
}: {
  status: ChatMessage['status'];
  message: ChatMessage;
  onRetry?: (message: ChatMessage) => void;
}) {
  if (status === 'pending') return <ClockCircleOutlined className="bubble__status" />;
  if (status === 'error') {
    // Ретрай: текст всегда; медиа - пока жив url (blob: в сессии или downloadUrl)
    const retriable =
      onRetry && ((message.kind ?? 'text') === 'text' || !!message.url);
    return (
      <ExclamationCircleOutlined
        className="bubble__status bubble__status--error"
        title={retriable ? 'Не отправлено. Нажмите, чтобы повторить' : 'Не отправлено'}
        onClick={retriable ? () => onRetry(message) : undefined}
      />
    );
  }
  if (status === 'delivered' || status === 'read') {
    return (
      <DoubleCheck
        className={`bubble__status${status === 'read' ? ' bubble__status--read' : ''}`}
      />
    );
  }
  return <CheckOutlined className="bubble__status" />;
}

function DoubleCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="12"
      viewBox="0 0 18 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 6.8 4.8 10.6 11.5 1.6" />
      <path d="M6.8 10.6 15.5 1.6" />
    </svg>
  );
}
