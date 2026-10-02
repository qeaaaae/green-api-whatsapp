export function formatMessageTime(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isSameDay(aSec: number, bSec: number): boolean {
  return new Date(aSec * 1000).toDateString() === new Date(bSec * 1000).toDateString();
}

// Длительность звонка: 0:42 / 12:05 / 1:02:30
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatMessageDate(timestampSec: number): string {
  const date = new Date(timestampSec * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

// Детерминированный цвет аватарки по chatId, как в WhatsApp
const AVATAR_COLORS = [
  '#00a884', '#53bdeb', '#e91e63', '#9c27b0',
  '#3f51b5', '#ff9800', '#795548', '#607d8b',
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? '#00a884';
}
