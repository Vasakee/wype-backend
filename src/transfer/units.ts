export const QUAI_DECIMALS = 18;

export function toMinorUnits(amount: string): string {
  const [whole = '0', fraction = ''] = amount.trim().split('.');
  const padded = (fraction + '0'.repeat(QUAI_DECIMALS)).slice(0, QUAI_DECIMALS);
  const value =
    BigInt(whole) * 10n ** BigInt(QUAI_DECIMALS) + BigInt(padded || '0');
  return value.toString();
}

export function fromMinorUnits(minor: string): string {
  const value = BigInt(minor);
  const whole = value / 10n ** BigInt(QUAI_DECIMALS);
  const fraction = (value % 10n ** BigInt(QUAI_DECIMALS))
    .toString()
    .padStart(QUAI_DECIMALS, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
