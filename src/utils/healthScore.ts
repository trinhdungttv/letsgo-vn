// ─── Health Score Utility ────────────────────────────────────────────────────
// Hỗ trợ hai loại hình dịch vụ:
//   'leasing'     - Chấm điểm theo 6 tiêu chí chu kỳ tháng cố định (logic cũ).
//   'recruitment' - Chấm điểm theo trạng thái công nợ hóa đơn (overdue invoice).
// Khi serviceType không được truyền, mặc định 'leasing' để đảm bảo tương thích ngược.

import type { ServiceType } from '../lib/types';

export interface HealthScore {
  total: number;
  stability: number;
  payment: number;
  contact: number;
  contract: number;
  growth: number;
}

// Tham số chung cho cả hai loại hình.
interface BaseParams {
  serviceType?: ServiceType;
  contractEnd: string;
  lastContactDate: string;
}

// Tham số riêng cho leasing (chu kỳ tháng cố định).
interface LeasingParams extends BaseParams {
  serviceType?: 'leasing';
  currentWorkers: number;
  minWorkers: number;
  paidThisMonth: boolean;
  progCutoff: boolean;
  workerHistory: number[];
}

// Tham số riêng cho recruitment (công nợ hóa đơn).
// overdueInvoiceCount: số hóa đơn đã quá hạn thanh toán (created_at + payment_term_days < today, paid_status = false).
// unpaidInvoiceCount:  số hóa đơn chưa thanh toán (kể cả chưa đến hạn).
interface RecruitmentParams extends BaseParams {
  serviceType: 'recruitment';
  overdueInvoiceCount: number;
  unpaidInvoiceCount: number;
}

export type CalcHealthScoreParams = LeasingParams | RecruitmentParams;

// ─── Leasing scoring ─────────────────────────────────────────────────────────
function calcLeasingScore(params: LeasingParams): HealthScore {
  const today = new Date();

  // Tỷ lệ lao động thực tế / tối thiểu cam kết (tối đa 30 điểm).
  const ratio = params.minWorkers > 0
    ? params.currentWorkers / params.minWorkers : 1;
  const stability = Math.round(Math.min(1, ratio) * 30);

  // Trạng thái thanh toán tháng này (tối đa 25 điểm).
  const payment = params.paidThisMonth ? 25
    : params.progCutoff ? 12 : 0;

  // Ngày liên hệ gần nhất (tối đa 20 điểm).
  let contact = 2;
  if (params.lastContactDate) {
    const last = new Date(params.lastContactDate);
    const daysSince = Math.round(
      (today.getTime() - last.getTime()) / 86400000
    );
    contact = daysSince <= 7 ? 20
      : daysSince <= 14 ? 14
      : daysSince <= 30 ? 8 : 2;
  }

  // Ngày còn lại của hợp đồng (tối đa 15 điểm).
  const daysLeft = params.contractEnd
    ? Math.round(
        (new Date(params.contractEnd).getTime() - today.getTime()) / 86400000
      )
    : 0;
  const contract = daysLeft > 180 ? 15
    : daysLeft > 90 ? 10
    : daysLeft > 30 ? 5
    : daysLeft > 0 ? 2 : 0;

  // Xu hướng tăng/giảm lao động (tối đa 10 điểm).
  let growth = 7;
  if (params.workerHistory.length >= 2) {
    const delta =
      params.workerHistory[params.workerHistory.length - 1]
      - params.workerHistory[0];
    growth = delta > 0 ? 10
      : delta === 0 ? 7
      : Math.max(0, 10 + delta / 5);
  }
  growth = Math.round(growth);

  const total = Math.min(100, stability + payment + contact + contract + growth);
  return { total, stability, payment, contact, contract, growth };
}

// ─── Recruitment scoring ─────────────────────────────────────────────────────
// Thang điểm tổng 100:
//   - stability (40đ): không có hóa đơn quá hạn = 40đ, mỗi hóa đơn quá hạn trừ 20đ.
//   - payment   (30đ): không có hóa đơn chưa thanh toán = 30đ, giảm theo số lượng.
//   - contact   (20đ): ngày liên hệ gần nhất (giống leasing).
//   - contract  (10đ): ngày còn lại hợp đồng (rút gọn).
//   - growth    (0đ):  không áp dụng cho recruitment (không theo dõi số lao động tuần).
function calcRecruitmentScore(params: RecruitmentParams): HealthScore {
  const today = new Date();

  // Hóa đơn quá hạn: mỗi cái trừ 20 điểm, tối đa về 0.
  const stability = Math.max(0, 40 - params.overdueInvoiceCount * 20);

  // Hóa đơn chưa thanh toán (kể cả chưa đến hạn): mỗi cái trừ 10 điểm.
  const payment = Math.max(0, 30 - params.unpaidInvoiceCount * 10);

  // Ngày liên hệ gần nhất (tối đa 20 điểm).
  let contact = 2;
  if (params.lastContactDate) {
    const last = new Date(params.lastContactDate);
    const daysSince = Math.round(
      (today.getTime() - last.getTime()) / 86400000
    );
    contact = daysSince <= 7 ? 20
      : daysSince <= 14 ? 14
      : daysSince <= 30 ? 8 : 2;
  }

  // Ngày còn lại hợp đồng (tối đa 10 điểm — ít trọng số hơn vì recruitment thường ngắn hạn).
  const daysLeft = params.contractEnd
    ? Math.round(
        (new Date(params.contractEnd).getTime() - today.getTime()) / 86400000
      )
    : 0;
  const contract = daysLeft > 90 ? 10
    : daysLeft > 30 ? 6
    : daysLeft > 0 ? 2 : 0;

  const growth = 0; // Không áp dụng.
  const total = Math.min(100, stability + payment + contact + contract + growth);
  return { total, stability, payment, contact, contract, growth };
}

// ─── Hàm xuất khẩu chính ─────────────────────────────────────────────────────
export function calcHealthScore(params: CalcHealthScoreParams): HealthScore {
  // Phân nhánh theo loại hình dịch vụ.
  if (params.serviceType === 'recruitment') {
    return calcRecruitmentScore(params as RecruitmentParams);
  }
  // Mặc định 'leasing' — tương thích ngược với toàn bộ mã cũ.
  return calcLeasingScore(params as LeasingParams);
}

// ─── Tiện ích màu sắc và nhãn ────────────────────────────────────────────────
export function hsColor(score: number): string {
  return score >= 75 ? '#059669'
    : score >= 50 ? '#D97706'
    : '#DC2626';
}

export function hsLabel(score: number): string {
  return score >= 75 ? 'Tot'
    : score >= 50 ? 'Can chu y'
    : 'Nguy hiem';
}

export type ChurnLevel = 'high' | 'medium' | null;

// Chỉ áp dụng cho leasing (theo dõi lịch sử lao động hàng tuần).
export function detectChurnRisk(workerHistory: number[]): ChurnLevel {
  if (workerHistory.length < 3) return null;
  const first = workerHistory[0];
  const last = workerHistory[workerHistory.length - 1];
  if (first === 0) return null;
  const pctChange = (last - first) / first * 100;
  const recent = workerHistory.slice(-3);
  const trendDown = recent.every((v, i) => i === 0 || v <= recent[i - 1]);
  if (pctChange <= -15 && trendDown) return 'high';
  if (pctChange <= -5 && trendDown) return 'medium';
  return null;
}
