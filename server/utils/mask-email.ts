/**
 * Маскирует email для отображения
 * Правило: 2 символа + ***** + @домен
 * Пример: friend042791@gmail.com -> fr*****@gmail.com
 */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  
  if (!localPart || !domain) {
    return "**@***.***";
  }

  // Показываем первые 2 символа
  const visibleLength = Math.min(2, localPart.length);
  const visible = localPart.slice(0, visibleLength);
  
  // Фиксированное количество звёздочек (5)
  const masked = "*****";

  return `${visible}${masked}@${domain}`;
}