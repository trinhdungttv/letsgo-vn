// Tinh lai theo NGAY THUC / 365
export function calcInterest(principal: number, ratePercent: number, days: number): number {
  return Math.round(principal * (ratePercent / 100 / 365) * days);
}

// Tinh so ngay giua 2 moc
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// So ngay trong 1 thang
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Tinh lai 1 thang (interest_only)
export function monthlyInterest(principal: number, ratePercent: number, year: number, month: number): number {
  const days = daysInMonth(year, month);
  return calcInterest(principal, ratePercent, days);
}

// Tinh EMI (nien kim co dinh)
export function calcEMI(principal: number, ratePercent: number, termMonths: number): number {
  const r = ratePercent / 100 / 12;
  if (r === 0) return Math.round(principal / termMonths);
  const factor = Math.pow(1 + r, termMonths);
  return Math.round(principal * r * factor / (factor - 1));
}

// Format tien VND ngan gon
export function fmtVND(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) {
    return (amount / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + ' ty';
  }
  if (Math.abs(amount) >= 1_000_000) {
    return (amount / 1_000_000).toFixed(0) + 'M';
  }
  return amount.toLocaleString('vi-VN');
}

export function fmtRate(rate: number): string {
  return rate.toFixed(2).replace(/\.?0+$/, '') + '%';
}
