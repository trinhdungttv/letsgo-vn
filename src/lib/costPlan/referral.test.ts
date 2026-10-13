import { describe, it, expect } from 'vitest';
import {
  computeReferral, defaultReferral, normalizeReferral, referralTerms, referralNotes, referralPriceRow,
  termsToText, viNumberWords, feeText, termShort, isReferralPlan,
} from './referral';
import { DEFAULT_SETTINGS, normalizePlanData, summarizePlan, computePlan } from './engine';
import { matchPlans } from './suggest';
import type { CostPlanRow, PlanData } from './types';

const S = { ...DEFAULT_SETTINGS, workers: 10, simDays: 26, companyPct: 30, taxOption: 'profit20' as const };

describe('Giới thiệu lao động — tính phí', () => {
  it('theo giờ: 10.000 đ/giờ × 8 giờ × 26 công × 6 tháng', () => {
    const r = computeReferral({ ...defaultReferral(), costs: [] }, S);
    expect(r.feePerDay).toBe(80_000);
    expect(r.feePerWorkerMonth).toBe(2_080_000);
    expect(r.feePerWorker).toBe(12_480_000);
    expect(r.revenueMonthly).toBe(20_800_000);
    expect(r.revenueTotal).toBe(124_800_000);
    expect(r.tax).toBeCloseTo(24_960_000);
    expect(r.profit).toBeCloseTo(99_840_000);
    expect(r.profitMonthly).toBeCloseTo(16_640_000);
    expect(r.companyProfit + r.branchProfit).toBe(Math.round(r.profit));
    expect(r.companyProfit).toBe(Math.round(99_840_000 * 0.3));
  });
  it('theo ngày: đơn giá là phí / ngày, không nhân giờ', () => {
    const r = computeReferral({ ...defaultReferral(), rateUnit: 'day', rate: 50_000, durationMonths: 3, costs: [] }, { ...S, taxOption: 'none' });
    expect(r.feePerDay).toBe(50_000);
    expect(r.revenueTotal).toBe(50_000 * 26 * 3 * 10);
    expect(r.tax).toBe(0);
  });
  it('trọn gói: 3 triệu/người × số người đủ điều kiện, chi phí tuyển tính trên mọi người tuyển', () => {
    const cfg = { ...defaultReferral(), mode: 'lump' as const, retentionPct: 80, costs: [
      { id: 'a', name: 'Đăng tin', kind: 'per_worker' as const, value: 200_000 },
      { id: 'b', name: 'Hoa hồng CTV', kind: 'pct_fee' as const, value: 20 },
    ] };
    const r = computeReferral(cfg, { ...S, taxOption: 'none' });
    expect(r.billedWorkers).toBe(8);
    expect(r.revenueTotal).toBe(24_000_000);
    expect(r.costs).toEqual([{ id: 'a', amount: 2_000_000 }, { id: 'b', amount: 4_800_000 }]);
    expect(r.profit).toBe(17_200_000);
    expect(r.months).toBe(0);
    expect(r.profitMonthly).toBe(r.profit);
  });
  it('lỗ thì cảnh báo, thuế không âm', () => {
    const r = computeReferral({ ...defaultReferral(), mode: 'lump', lumpFee: 100_000, costs: [{ id: 'x', name: 'x', kind: 'per_worker', value: 500_000 }] }, S);
    expect(r.profitBeforeTax).toBeLessThan(0);
    expect(r.tax).toBe(0);
    expect(r.warnings.some(w => w.level === 'error')).toBe(true);
  });
  it('dữ liệu rác không làm vỡ', () => {
    const c = normalizeReferral({ mode: 'x', rate: 'abc', maxHoursPerDay: 99, durationMonths: -3, costs: [{ kind: 'zzz', value: -5 }], effectiveFrom: 'hôm qua' });
    expect(c.mode).toBe('time');
    expect(c.rate).toBe(10_000);
    expect(c.maxHoursPerDay).toBe(24);
    expect(c.durationMonths).toBe(1);
    expect(c.costs[0]).toMatchObject({ kind: 'per_worker', value: 0 });
    expect(c.effectiveFrom).toBe('');
  });
});

describe('Giới thiệu lao động — điều khoản', () => {
  const cfg = { ...defaultReferral(), effectiveFrom: '2026-02-02' };
  it('khớp câu chữ phụ lục mẫu của công ty (bản Phụ lục HĐ, Việt–Trung)', () => {
    const t = referralTerms(cfg, 'zh', 'contract');
    expect(t[0]).toEqual({ a: 'Áp dụng mức cho người lao động vào làm từ 02/02/2026 về sau.', b: '适用于自2026/02/02起报到的人员。' });
    expect(t[1].a).toBe('Đơn giá thỏa thuận: 10.000 VNĐ/giờ, được tính trên thời gian làm việc thực tế của người lao động được giới thiệu thành công, tối đa 08 giờ/ngày. Thời gian làm thêm (tăng ca) không được tính vào đơn giá này.');
    expect(t[1].b).toBe('约定单价：10,000 越南盾/小时，以成功介绍并实际工作的劳动者的实际工作时间为计算依据，每日最多不超过 8 小时，加班时间不计入该单价。');
    expect(t[2].a).toBe('Thời gian chi trả phí: Trong vòng 06 (sáu) tháng kể từ ngày người lao động chính thức nhận việc tại Công ty.');
    expect(t[2].b).toBe('费用支付期限：自劳动者正式到岗之日起 6 个月内支付。');
    expect(t[3].a).toContain('Bên B giới thiệu người cho Bên A');
  });
  it('bản báo giá dùng "Quý Công ty", không có Bên A/B', () => {
    const txt = termsToText(referralTerms({ ...cfg, mode: 'lump', guaranteeDays: 30 }, 'vi', 'quote'));
    expect(txt).toContain('3.000.000 VNĐ/người');
    expect(txt).toContain('đủ 07 (bảy) ngày');
    expect(txt).toContain('chúng tôi giới thiệu người thay thế miễn phí');
    expect(txt).not.toMatch(/Bên [AB]/);
  });
  it('Anh–Việt: tiếng Anh trên, tiếng Việt dưới', () => {
    const t = referralTerms({ ...cfg, effectiveFrom: '' }, 'en');
    expect(t[0].a).toMatch(/^Agreed rate: VND 10,000\/hour/);
    expect(t[0].b).toMatch(/^Đơn giá thỏa thuận/);
  });
  it('dòng bảng giá + ghi chú mặc định / tự sửa', () => {
    expect(referralPriceRow(cfg, 'vi')).toMatchObject({ unit: { a: 'VNĐ/giờ' }, price: 10_000 });
    expect(referralPriceRow({ ...cfg, mode: 'lump' }, 'zh').unit).toEqual({ a: 'VNĐ/người', b: '越南盾/人' });
    expect(referralNotes(cfg, 'zh')[0].b).toBeTruthy();
    expect(referralNotes({ ...cfg, notes: 'Ghi chú riêng\n\nDòng 2' }, 'zh')).toEqual([{ a: 'Ghi chú riêng' }, { a: 'Dòng 2' }]);
  });
  it('số bằng chữ', () => {
    expect([1, 5, 6, 10, 12, 15, 21, 24, 25, 30].map(viNumberWords)).toEqual(['một', 'năm', 'sáu', 'mười', 'mười hai', 'mười lăm', 'hai mươi mốt', 'hai mươi tư', 'hai mươi lăm', 'ba mươi']);
  });
  it('nhãn gọn cho danh sách', () => {
    expect(feeText(cfg)).toBe('10.000 đ/giờ');
    expect(termShort(cfg)).toBe('tối đa 8 giờ/ngày · thu 6 tháng');
    expect(feeText({ ...cfg, mode: 'lump' })).toBe('3.000.000 đ/người');
  });
});

describe('Giới thiệu lao động — tích hợp phương án', () => {
  const data: PlanData = { service: 'referral', referral: { ...defaultReferral(), costs: [] }, settings: S, lines: [], notes: '' };
  it('normalizePlanData giữ loại dịch vụ; phương án cũ không thêm khoá mới', () => {
    expect(normalizePlanData(data).service).toBe('referral');
    expect('service' in normalizePlanData({ settings: S, lines: [], notes: '' })).toBe(false);
  });
  it('summarizePlan tóm tắt theo phí giới thiệu', () => {
    const sm = summarizePlan(data, computePlan(data));
    expect(sm).toMatchObject({ service: 'referral', feeText: '10.000 đ/giờ', quoteDaily: 80_000, profitTotal: 99_840_000 });
  });
  it('không dùng phương án giới thiệu làm mẫu cho cung ứng', () => {
    const row = (id: string, d: PlanData) => ({ id, title: id, industry: 'Hóa chất', zone_name: 'VSIP', status: 'draft', data: d, summary: null, updated_at: '2026-10-01' }) as unknown as CostPlanRow;
    const plans = [row('ref', data), row('sup', { settings: S, lines: [], notes: '' })];
    expect(isReferralPlan(plans[0])).toBe(true);
    expect(matchPlans(plans, { industry: 'Hóa chất', zone: 'VSIP' }).map(m => m.plan.id)).toEqual(['sup']);
  });
});
