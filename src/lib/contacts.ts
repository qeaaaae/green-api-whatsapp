import type { ContactListItem } from '../api/greenApi';

// Имя для отображения: запись в телефонной книге > имя профиля > chatId
export function contactLabel(c: ContactListItem): string {
  return c.contactName || c.name || c.id;
}

/**
 * Поиск по контактам: совпадение по имени/chatId подстрокой
 * или по цифрам номера (ввод отформатирован маской, сравниваем цифры)
 */
export function matchContact(input: string, c: ContactListItem): boolean {
  const digits = input.replace(/\D/g, '');
  if (digits.length >= 3 && c.id.replace(/\D/g, '').includes(digits)) return true;
  const q = input.trim().toLowerCase();
  if (!q) return true;
  return (
    contactLabel(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
  );
}
