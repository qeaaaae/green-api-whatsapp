// Нормализация ввода пользователя в chatId GREEN-API (WhatsApp):
// - содержит '@'  -> уже готовый chatId (xxx@c.us / xxx@g.us), как есть
// - остальное     -> номер телефона -> '<цифры>@c.us'
//   (11-значный номер на 8 -> международный формат на 7)
export function toChatId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return trimmed;
  }
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length < 10) return null;
  return `${digits}@c.us`;
}

// Маска ввода номера. '0' в шаблоне - позиция цифры; статические
// символы добавляются, только пока есть неподставленные цифры.
const PHONE_CHARS_RE = /^[\d\s()+-]*$/;
const PHONE_MASKS: { test: (digits: string) => boolean; pattern: string }[] = [
  { test: (d) => d.startsWith('7'), pattern: '+0 (000) 000-00-00' }, // Россия/Казахстан
  { test: (d) => d.startsWith('1'), pattern: '+0 (000) 000-0000' }, // США/Канада
  { test: () => true, pattern: '+000 000 000 000 000' }, // прочие (E.164, до 15 цифр)
];

export function formatPhoneInput(value: string): string {
  if (!PHONE_CHARS_RE.test(value)) return value; // готовый chatId - без маски
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';
  // 8-ка -> 7 только без явного '+': '+81...' - это Япония, не Россия
  if (!value.trim().startsWith('+') && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  const { pattern } = PHONE_MASKS.find((m) => m.test(digits))!;
  let i = 0;
  let result = '';
  for (const ch of pattern) {
    if (i >= digits.length) break;
    result += ch === '0' ? digits[i++] : ch;
  }
  if (i < digits.length) result += ` ${digits.slice(i)}`;
  return result;
}

// Заголовок вида '+7 (908) 474-97-33' или '79084749733@c.us' - не имя
export const isPhoneLike = (title: string) =>
  /^[\d+\s()\-@.a-z]*$/i.test(title) && /\d{5,}/.test(title);

/**
 * chatId, принимаемый GREEN-API в send-методах: phone@c.us (номер
 * от 5 цифр - короткие вроде '0@c.us' это системный мусор),
 * group@g.us, либо lid-идентификатор
 */
export const isSendableChatId = (id: string) =>
  /^\d{5,}@c\.us$/.test(id) || /^[^@\s]+@(g\.us|lid)$/.test(id);
