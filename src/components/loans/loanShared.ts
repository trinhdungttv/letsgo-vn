// Helpers dung chung cho module Khoan vay
import type { Loan, LoanMonthlyConfirmation, LoanConfirmationStatus, LoanRenewalStatus, LoanDisbursementStatus } from '../../lib/types';
import { calcInterest, daysInMonth } from '../../lib/loanCalculations';

// Format day du: 1.234.567.890 đ (khac fmtVND ngan gon)
export function fmtFull(n: number): string {
  return Math.round(n).toLocaleString('vi-VN') + ' đ';
}

// 'YYYY-MM' cua hom nay hoac Date bat ky
export function monthKeyOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysTo(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr).getTime() - today.getTime()) / 86400000);
}

// Lai uoc tinh 1 thang cua 1 khoan — ngay thuc/365 tren du no goc hien tai.
// (reducing/emi: xap xi theo principal hien tai — GĐ cap nhat principal khi tra bot goc)
export function estimateMonthInterest(loan: Loan, year: number, month: number): number {
  return calcInterest(loan.principal, loan.interest_rate, daysInMonth(year, month));
}

// Khoan dai han co dang trong thoi gian an han goc khong? (chi tra lai)
export function inGracePeriod(loan: Loan): boolean {
  if (!loan.grace_months || !loan.disbursement_date) return false;
  const start = new Date(loan.disbursement_date);
  const graceEnd = new Date(start); graceEnd.setMonth(graceEnd.getMonth() + loan.grace_months);
  return new Date() < graceEnd;
}

// Ngay het an han goc (bat dau tra ca goc + lai)
export function graceEndDate(loan: Loan): Date | null {
  if (!loan.grace_months || !loan.disbursement_date) return null;
  const d = new Date(loan.disbursement_date);
  d.setMonth(d.getMonth() + loan.grace_months);
  return d;
}

// Xac nhan thang hien tai cua 1 khoan
export function confOf(confirmations: LoanMonthlyConfirmation[], loanId: string, month: string): LoanMonthlyConfirmation | undefined {
  return confirmations.find(c => c.loan_id === loanId && c.month === month);
}

// ── Mau chip trang thai ──
export const CONF_STATUS_CLS: Record<LoanConfirmationStatus, string> = {
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overdue: 'bg-red-50 text-red-700 border-red-200',
};

export const RENEWAL_STATUS_CLS: Record<LoanRenewalStatus, string> = {
  pending: 'bg-red-50 text-red-700 border-red-200',
  contacted: 'bg-blue-50 text-blue-700 border-blue-200',
  deposited: 'bg-amber-50 text-amber-700 border-amber-200',
  redisbursed: 'bg-violet-50 text-violet-700 border-violet-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-gray-100 text-gray-500 border-gray-300',
};

export const DISB_STATUS_CLS: Record<LoanDisbursementStatus, string> = {
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  disbursed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// Bang mau cho charts (dong bo palette app)
export const CHART_COLORS = ['#dc2626', '#2563eb', '#0d9488', '#7c3aed', '#d97706', '#059669', '#db2777', '#64748b'];
