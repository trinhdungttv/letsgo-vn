import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { legalChecklist } from './legal';
import { baseLines, starterLines } from './presets';
import { applyTemplate, linesForTemplate, templateKey } from './template';
import type { CostLine, PlanData } from './types';

const plan = (lines: CostLine[]): PlanData => ({ settings: { ...DEFAULT_SETTINGS }, notes: '', lines });
const toxic = () => newLine({ name: 'Hỗ trợ độc hại xưởng sơn', group: 'worker', paidToWorker: true, unit: 'day', value: 35_000 });

describe('mẫu ngành', () => {
  const lines = [...starterLines('Điện tử', { baseWageMonthly: 5_310_000 }), toxic()];
  it('lưu mẫu: bỏ Phí DV, giữ mọi khoản chi phí còn lại (kèm số tiền)', () => {
    const t = linesForTemplate(lines);
    expect(t.some(l => l.isServiceFee)).toBe(false);
    expect(t.find(l => /độc hại/.test(l.name))!.value).toBe(35_000);
    expect(t.length).toBe(lines.length - 1);
  });
  it('áp mẫu: id mới, lương CB theo lương tối thiểu KCN, có đúng 1 dòng Phí DV trống', () => {
    const out = applyTemplate({ lines: linesForTemplate(lines) }, { baseWageMonthly: 4_730_000 });
    const base = out.find(l => l.isBaseWage)!;
    expect(base.unit).toBe('month'); expect(base.value).toBe(4_730_000);
    expect(out.filter(l => l.isServiceFee)).toHaveLength(1);
    expect(out.find(l => l.isServiceFee)!.value).toBe(0);
    expect(new Set(out.map(l => l.id)).size).toBe(out.length);
    expect(out.map(l => l.id)).not.toContain(lines[0].id);
    expect(out.find(l => /độc hại/.test(l.name))!.value).toBe(35_000);
  });
  it('mẫu thiếu dòng lương cơ bản → tự thêm vào đầu', () => {
    const out = applyTemplate({ lines: [toxic()] }, { baseWageMonthly: 4_730_000 });
    expect(out[0].isBaseWage).toBe(true);
    expect(computePlan(plan(out)).warnings.some(w => /Lương cơ bản/.test(w.text))).toBe(false);
  });
  it('áp mẫu không làm đổi mẫu gốc', () => {
    const tpl = { lines: linesForTemplate(lines) };
    const before = JSON.stringify(tpl);
    applyTemplate(tpl, { baseWageMonthly: 1 });
    expect(JSON.stringify(tpl)).toBe(before);
  });
  it('khoá ngành bỏ dấu, không phân biệt hoa thường', () => {
    expect(templateKey('Sản Xuất Hóa Chất')).toBe(templateKey('san xuat hoa chat'));
  });
});

describe('kiểm tra luật theo mẫu ngành', () => {
  const tpl = [...baseLines({ baseWageMonthly: 4_730_000 }), toxic()];
  const check = (d: PlanData, templateLines: CostLine[] | null) => legalChecklist(d, computePlan(d), { industry: 'Sơn', minWageMonthly: null, templateLines });
  it('mẫu có khoản đặc thù mà phương án chưa có → báo thiếu, kèm khoản mẫu để thêm', () => {
    const it = check(plan(baseLines({ baseWageMonthly: 4_730_000 })), tpl).find(i => i.id.startsWith('tpl:'))!;
    expect(it.status).toBe('missing');
    expect(it.required).toBe(false);
    expect(it.fix?.value).toBe(35_000);
  });
  it('có khoản đó (tên khớp, số > 0) → đạt', () => {
    const it = check(plan([...baseLines({ baseWageMonthly: 4_730_000 }), toxic()]), tpl).find(i => i.id.startsWith('tpl:'))!;
    expect(it.status).toBe('ok');
  });
  it('khoản luật định chung (BHXH, phép năm…) không bị lặp thành mục "đặc thù"', () => {
    const items = check(plan(baseLines({ baseWageMonthly: 4_730_000 })), tpl).filter(i => i.id.startsWith('tpl:'));
    expect(items).toHaveLength(1);
  });
  it('có mẫu thì không dùng bộ gợi ý gắn cứng của ngành độc hại', () => {
    const ids = legalChecklist(plan(baseLines({ baseWageMonthly: 4_730_000 })), computePlan(plan(baseLines({ baseWageMonthly: 4_730_000 }))), { industry: 'Cơ khí', templateLines: tpl }).map(i => i.id);
    expect(ids).not.toContain('toxic');
  });
});
