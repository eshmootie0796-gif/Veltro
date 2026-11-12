export function formatToman(amount: number): string {
  return new Intl.NumberFormat("fa-IR").format(amount);
}
