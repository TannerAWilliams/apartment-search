/** A number field as it is typed: digits only, no leading zeros, and never above `max` (blank stays blank). */
export function wholeNumber(text: string, max: number) {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? String(Math.min(Number(digits.slice(0, 9)), max)) : '';
}
