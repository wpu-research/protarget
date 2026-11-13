/** Formats a decimal string without converting it to a float: integer part via BigInt, fraction kept as text. */
export function formatDecimal(value: string, locale: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const separator = new Intl.NumberFormat(locale).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
  const fraction = (match[3] ?? '').replace(/0+$/, '').padEnd(2, '0');
  return `${match[1]}${new Intl.NumberFormat(locale).format(BigInt(match[2]))}${separator}${fraction}`;
}
