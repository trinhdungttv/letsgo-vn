import { describe, it, expect } from 'vitest';
import { computePlan, normalizePlanData, solveServiceFee, summarizePlan, withAmountEdit, DEFAULT_SETTINGS, newLine } from './engine';
import { baseLines, findPreset, starterLines, optionalFor, lineKey } from './presets';
import { matchPlans, suggestLines, benchmarkFromPlans } from './suggest';
import type { CostLine, CostPlanRow, PlanData } from './types';

// Bảng mẫu của công ty (file demo): số nhập tay để đối chiếu với kết quả demo
//   chi phí trực tiếp 409.600 · phí DV 60.000 · thuế 15.000 · giá báo 424.600 · NLĐ nhận 280.600
const demoLines = (): CostLine[] => [
  newLine({ name: 'Lương cơ bản', unit: 'day', value: 240000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 29000, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp chuyên cần', unit: 'day', value: 11600, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'BHXH', unit: 'day', value: 51000, group: 'compliance' }),
  newLine({ name: 'Phép năm', unit: 'day', value: 9000, group: 'compliance' }),
  newLine({ name: 'Công đoàn', unit: 'day', value: 5000, group: 'compliance' }),
  newLine({ name: 'Khám SK', unit: 'day', value: 4000, group: 'compliance' }),
  newLine({ name: 'Phí dịch vụ', unit: 'day', value: 60000, isServiceFee: true, group: 'service' }),
];
const plan = (lines: CostLine[], settings: Partial<PlanData['settings']> = {}): PlanData =>
  ({ settings: { ...DEFAULT_SETTINGS, ...settings }, lines, notes: '' });

describe('computePlan — khớp bảng demo', () => {
  const r = computePlan(plan(demoLines()));
  it('tổng chi phí trực tiếp / công', () => expect(r.directDaily).toBe(409_600));
  it('thuế TNDN dự phòng = 25% phí DV (giữ nguyên lãi sau thuế 20%)', () => expect(r.taxDaily).toBeCloseTo(15_000, 6));
  it('giá báo khách / công', () => expect(r.quoteDaily).toBeCloseTo(424_600, 6));
  it('thu nhập trả NLĐ / công và / tháng', () => {
    expect(r.workerDaily).toBe(280_600);
    expect(r.workerMonthly).toBe(280_600 * 26);
  });
  it('lợi nhuận 20 LĐ × 26 công = 31.200.000, chia 30/70', () => {
    expect(r.profitMonthly).toBe(31_200_000);
    expect(r.companyProfit).toBe(9_360_000);
    expect(r.branchProfit).toBe(21_840_000);
    expect(r.companyPerDay).toBeCloseTo(18_000, 6);
    expect(r.branchPerDay).toBeCloseTo(42_000, 6);
  });
  it('giá tháng / 1 LĐ = giá công × 26', () => expect(r.quoteMonthly).toBeCloseTo(424_600 * 26, 4));
});

describe('thuế TNDN', () => {
  it('20% trên tổng đơn giá', () => {
    const r = computePlan(plan(demoLines(), { taxOption: 'total20' }));
    expect(r.taxDaily).toBeCloseTo(409_600 * 0.2, 6);
  });
  it('không tính thuế', () => {
    const r = computePlan(plan(demoLines(), { taxOption: 'none' }));
    expect(r.taxDaily).toBe(0);
    expect(r.quoteDaily).toBe(409_600);
  });
});

describe('quy đổi ngày ⇄ tháng không lệch', () => {
  it('gõ theo tháng: giữ nguyên số tháng, ngày chỉ là số quy đổi', () => {
    const l = withAmountEdit(newLine({ name: 'x' }), 'monthly', 6_100_000);
    const r = computePlan(plan([{ ...l, isBaseWage: true, paidToWorker: true }]));
    expect(r.lines[l.id].monthly).toBe(6_100_000);
    expect(r.lines[l.id].daily).toBeCloseTo(6_100_000 / 26, 6);
  });
  it('đổi ngày công chuẩn: dòng nhập theo tháng giữ nguyên số tháng', () => {
    const l = withAmountEdit(newLine({ name: 'x' }), 'monthly', 5_200_000);
    const r22 = computePlan(plan([l], { baseDays: 22 }));
    expect(r22.lines[l.id].monthly).toBe(5_200_000);
    expect(r22.lines[l.id].daily).toBeCloseTo(5_200_000 / 22, 6);
  });
  it('đổi ngày công chuẩn: dòng nhập theo ngày giữ nguyên số ngày', () => {
    const l = withAmountEdit(newLine({ name: 'x' }), 'daily', 200_000);
    const r = computePlan(plan([l], { baseDays: 22 }));
    expect(r.lines[l.id].daily).toBe(200_000);
    expect(r.lines[l.id].monthly).toBe(4_400_000);
  });
});

describe('công thức theo % / phép năm', () => {
  const lines = baseLines({ baseWageMonthly: 6_240_000 }); // = 240.000/công
  const feeIdx = lines.findIndex(l => l.isServiceFee);
  lines[feeIdx] = { ...lines[feeIdx], value: 60_000 };
  const r = computePlan(plan(lines));
  const by = (n: string) => lines.find(l => l.name.startsWith(n))!;

  it('BHXH 21,5% trên lương đóng BH', () => expect(r.lines[by('BHXH').id].daily).toBeCloseTo(240_000 * 0.215, 6));
  it('công đoàn 2%', () => expect(r.lines[by('Kinh phí Công đoàn').id].daily).toBeCloseTo(4_800, 6));
  it('phép năm 12 ngày = lương/công × 12 ÷ (12 × 26)', () => expect(r.lines[by('Dự phòng phép').id].daily).toBeCloseTo(240_000 / 26, 6));
  it('khoản % được đánh dấu "tính ra", khoản gõ tay thì không', () => {
    expect(r.lines[by('BHXH').id].derived).toBe(true);
    expect(r.lines[by('Lương cơ bản').id].derived).toBe(false);
  });
  it('trần đóng BHXH: lương rất cao chỉ tính BHXH trên phần trần', () => {
    const rich = baseLines({ baseWageMonthly: 100_000_000 });
    const rr = computePlan(plan(rich));
    const bh = rich.find(l => l.name.startsWith('BHXH'))!;
    expect(rr.lines[bh.id].daily * 26).toBeCloseTo(46_800_000 * 0.215, 4);
    expect(rr.warnings.some(w => w.lineId === bh.id && w.level === 'info')).toBe(true);
  });
  it('thêm phụ cấp tính BH thì BHXH tăng theo', () => {
    const ls = baseLines({ baseWageMonthly: 6_240_000 });
    ls.splice(1, 0, newLine({ name: 'PC chức vụ', unit: 'month', value: 1_000_000, paidToWorker: true, insurable: true }));
    const rr = computePlan(plan(ls));
    const bh = ls.find(l => l.name.startsWith('BHXH'))!;
    expect(rr.lines[bh.id].monthly).toBeCloseTo(7_240_000 * 0.215, 4);
  });
});

describe('Phí DV tính theo %', () => {
  it('% trên tổng chi phí trực tiếp (không vòng tròn)', () => {
    const ls = demoLines();
    const fee = ls.find(l => l.isServiceFee)!;
    fee.mode = 'percent'; fee.base = 'cost_total'; fee.value = 10;
    const r = computePlan(plan(ls, { taxOption: 'none' }));
    expect(r.lines[fee.id].daily).toBeCloseTo(349_600 * 0.1, 6);
    expect(r.quoteDaily).toBeCloseTo(349_600 * 1.1, 6);
  });
  it('dòng thường chọn cơ sở dành cho Phí DV → báo lỗi, tính 0, KHÔNG treo', () => {
    const ls = demoLines();
    const bad = newLine({ name: 'Quỹ dự phòng', mode: 'percent', base: 'cost_total', value: 5 });
    const r = computePlan(plan([...ls, bad]));
    expect(r.lines[bad.id].daily).toBe(0);
    expect(r.warnings.some(w => w.level === 'error' && w.lineId === bad.id)).toBe(true);
  });
});

describe('làm tròn giá báo khách', () => {
  it('làm tròn LÊN, phần dôi ra cộng vào lợi nhuận', () => {
    const r = computePlan(plan(demoLines(), { roundTo: 1000 }));
    expect(r.quoteDaily).toBe(425_000);
    expect(r.roundingGainDaily).toBeCloseTo(400, 6);
    expect(r.profitDaily).toBeCloseTo(60_400, 6);
  });
  it('đã tròn sẵn thì không đổi (không nhảy lên 1 bậc vì số lẻ float)', () => {
    const ls = demoLines();
    const r = computePlan(plan(ls, { taxOption: 'none', roundTo: 100 }));
    expect(r.quoteDaily).toBe(409_600);
  });
});

describe('cảnh báo', () => {
  it('lương cơ bản thấp hơn lương tối thiểu vùng', () => {
    const r = computePlan(plan(baseLines({ baseWageMonthly: 4_000_000 })), { minWageMonthly: 4_730_000, minWageLabel: 'Vùng II' });
    expect(r.warnings.some(w => w.level === 'error' && /tối thiểu/.test(w.text))).toBe(true);
  });
  it('không có dòng lương cơ bản', () => {
    const r = computePlan(plan([newLine({ name: 'Phụ cấp', value: 1000 })]));
    expect(r.warnings.some(w => /Lương cơ bản/.test(w.text))).toBe(true);
  });
  it('dữ liệu rác không ném lỗi', () => {
    expect(() => computePlan(normalizePlanData(null))).not.toThrow();
    expect(() => computePlan({ settings: { ...DEFAULT_SETTINGS, baseDays: 0, workers: NaN }, lines: [], notes: '' })).not.toThrow();
  });
});

describe('solveServiceFee — bài toán ngược', () => {
  for (const taxOption of ['profit20', 'total20', 'none'] as const) {
    it(`khách chốt 430.000/công → phí DV mới cho đúng giá đó (${taxOption})`, () => {
      const d = plan(demoLines(), { taxOption });
      const fee = solveServiceFee(d, 430_000)!;
      expect(fee).not.toBeNull();
      const back = computePlan({ ...d, lines: d.lines.map(l => (l.id === fee.id ? fee : l)) });
      expect(Math.abs(back.quoteDaily - 430_000)).toBeLessThanOrEqual(2); // sai số do làm tròn phí về đồng
    });
  }
  it('giá khách chốt thấp hơn cả chi phí → null (không trả phí âm)', () => {
    expect(solveServiceFee(plan(demoLines()), 300_000)).toBeNull();
  });
});

describe('summarizePlan', () => {
  it('lưu đúng các số chốt', () => {
    const d = plan(demoLines());
    const s = summarizePlan(d, computePlan(d));
    expect(s.quoteDaily).toBe(424_600);
    expect(s.serviceFeeDaily).toBe(60_000);
    expect(s.baseWageMonthly).toBe(240_000 * 26);
    expect(s.profitMonthly).toBe(31_200_000);
  });
});

describe('preset theo ngành', () => {
  it('nhận đúng ngành theo TỪ, không khớp giữa chữ', () => {
    expect(findPreset('Sản xuất hóa chất khác / Nhựa nhũ tương')?.key).toBe('hoa_chat');
    expect(findPreset('Gia công cơ khí')?.key).toBe('co_khi');
    expect(findPreset('Nhân sự')).toBeNull();          // "han" nằm giữa chữ "nhan" — không được khớp cơ khí
    expect(findPreset('Điện tử')?.key).toBe('dien_tu');
    expect(findPreset(null)).toBeNull();
  });
  it('khởi tạo phương án hóa chất: lương CB đứng đầu, Phí DV đứng cuối, có phụ cấp độc hại', () => {
    const ls = starterLines('Hóa chất', { baseWageMonthly: 4_730_000 });
    expect(ls[0].isBaseWage).toBe(true);
    expect(ls[ls.length - 1].isServiceFee).toBe(true);
    expect(ls.some(l => l.name.includes('độc hại'))).toBe(true);
    expect(ls.find(l => l.mode === 'leave')?.value).toBe(14);
    expect(computePlan(plan(ls)).warnings.some(w => w.level === 'error')).toBe(false);
  });
  it('ngành lạ vẫn có bộ nền đủ BHXH / công đoàn / phép năm / phí DV', () => {
    const ls = starterLines('Ngành chưa biết', { baseWageMonthly: 4_730_000 });
    expect(ls.map(l => l.mode)).toContain('leave');
    expect(ls.filter(l => l.isServiceFee)).toHaveLength(1);
  });
  it('chip gợi ý bỏ khoản đã có', () => {
    const ls = starterLines('Điện tử', { baseWageMonthly: 4_730_000 });
    const opt = optionalFor('Điện tử', [...ls, newLine({ name: 'Phụ cấp chuyên cần (301.600)' })]);
    expect(opt.some(l => lineKey(l.name) === lineKey('Phụ cấp chuyên cần'))).toBe(false);
    expect(opt.length).toBeGreaterThan(3);
  });
});

// ── gợi ý từ lịch sử ───────────────────────────────────────────────────────────────────
const row = (p: Partial<CostPlanRow> & { id: string }): CostPlanRow => ({
  title: p.id, industry: null, zone_name: null, zone_id: null, branch_id: null, pipeline_id: null, client_id: null,
  company_name: null, status: 'draft', data: plan(demoLines()), summary: null, version: 1, created_by: null,
  created_by_name: null, updated_by_name: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...p,
});

describe('gợi ý từ phương án đã lưu', () => {
  const plans = [
    row({ id: 'a', industry: 'Hóa chất', zone_name: 'KCN Nhơn Trạch', status: 'final', updated_at: '2026-03-01T00:00:00Z' }),
    row({ id: 'b', industry: 'Hóa chất', zone_name: 'KCN Long Bình', updated_at: '2026-04-01T00:00:00Z' }),
    row({ id: 'c', industry: 'Điện tử', zone_name: 'KCN Nhơn Trạch', updated_at: '2026-05-01T00:00:00Z' }),
    row({ id: 'd', industry: 'Điện tử', zone_name: 'KCN Biên Hòa', status: 'archived' }),
  ];
  it('khớp theo mức: cùng KCN+ngành → cùng ngành → cùng KCN, bỏ phương án lưu trữ', () => {
    const m = matchPlans(plans, { industry: 'hóa chất', zone: 'KCN Nhơn Trạch' });
    expect(m.map(x => [x.plan.id, x.level])).toEqual([['a', 'zone_industry'], ['b', 'industry'], ['c', 'zone']]);
  });
  it('không gợi ý chính phương án đang sửa', () => {
    expect(matchPlans(plans, { industry: 'Hóa chất', zone: 'KCN Nhơn Trạch', excludeId: 'a' }).map(x => x.plan.id)).not.toContain('a');
  });
  it('gợi ý khoản mục hay dùng của ngành mà phương án hiện tại chưa có', () => {
    const current = [newLine({ name: 'Lương cơ bản', isBaseWage: true }), newLine({ name: 'Công đoàn' })];
    const s = suggestLines(plans, { industry: 'Hóa chất', zone: 'KCN Nhơn Trạch', currentLines: current });
    const names = s.map(x => x.line.name);
    expect(names).toContain('Phụ cấp độc hại');
    expect(names).not.toContain('Công đoàn');           // đã có
    expect(names).not.toContain('Lương cơ bản');        // luôn có sẵn
    const dh = s.find(x => x.line.name === 'Phụ cấp độc hại')!;
    expect(dh.count).toBe(2);
    expect(dh.zoneCount).toBe(1);
    expect(dh.avgDaily).toBe(29_000);
  });
  it('mặt bằng giá: ưu tiên cùng KCN+ngành, không có thì cùng ngành', () => {
    const sum = (q: number, fee: number) => ({ quoteDaily: q, serviceFeeDaily: fee, workerDaily: 0, profitDaily: fee, profitMonthly: 0, marginPct: 0, workers: 1, baseWageMonthly: 6_000_000, companyPct: 30, lineCount: 1 });
    const ps = [
      row({ id: 'a', industry: 'Hóa chất', zone_name: 'KCN A', summary: sum(420_000, 60_000) }),
      row({ id: 'b', industry: 'Hóa chất', zone_name: 'KCN B', summary: sum(450_000, 80_000) }),
    ];
    const z = benchmarkFromPlans(ps, { industry: 'Hóa chất', zone: 'KCN A' });
    expect(z.scope).toBe('zone_industry');
    expect(z.fee).toMatchObject({ n: 1, min: 60_000, max: 60_000 });
    const i = benchmarkFromPlans(ps, { industry: 'Hóa chất', zone: 'KCN Z' });
    expect(i.scope).toBe('industry');
    expect(i.fee).toMatchObject({ n: 2, min: 60_000, max: 80_000, avg: 70_000 });
    expect(benchmarkFromPlans(ps, { industry: 'Dệt may' }).scope).toBeNull();
  });
});
