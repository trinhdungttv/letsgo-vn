import { useState } from 'react';
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { BASE_LABELS, allowedBases, newLine } from '../../../lib/costPlan/engine';
import type { CostLine, LineMode, PercentBase, PlanResult } from '../../../lib/costPlan/types';
import { MoneyInput, NumInput, fmt, fmtShort } from './fields';
import { Popover, MenuItem, Select, Seg, Switch, Row, card, field, labelCls } from './ui';

export type Sec = 'worker' | 'compliance' | 'other' | 'service';

const SECS: { key: Sec; title: string; sub: string; dot: string }[] = [
  { key: 'worker', title: 'Trả người lao động', sub: 'Lương và phụ cấp NLĐ nhận trực tiếp', dot: '#0071e3' },
  { key: 'compliance', title: 'Bảo hiểm & chế độ', sub: 'Nghĩa vụ của doanh nghiệp theo luật', dot: '#34c759' },
  { key: 'other', title: 'Chi phí khác', sub: 'Tuyển dụng, quản lý tại chỗ, bảo hộ…', dot: '#8e8e93' },
  { key: 'service', title: 'Phí dịch vụ', sub: 'Phần lợi nhuận của Let’s Go VN', dot: '#5e5ce6' },
];

/** Nhóm của 1 khoản — suy từ cờ của chính nó, nên bảng cũ lưu trước đây vẫn gom đúng. */
export const secOf = (l: CostLine): Sec => (l.isServiceFee ? 'service' : l.paidToWorker ? 'worker' : l.group === 'compliance' ? 'compliance' : 'other');

/** Đưa 1 khoản sang nhóm khác: cờ "trả NLĐ / Phí DV" đi theo nhóm, khỏi phải bật tắt tay. */
export function withSection(l: CostLine, s: Sec): CostLine {
  const out: CostLine = { ...l, group: s, paidToWorker: s === 'worker', isServiceFee: s === 'service' };
  if (s !== 'worker') { out.isBaseWage = false; }
  if (s !== 'service' && out.mode === 'percent' && (out.base === 'cost_total' || out.base === 'worker_total')) out.base = 'base_wage';
  return out;
}

export const blankFor = (s: Sec): CostLine => ({
  worker: newLine({ name: 'Khoản trả NLĐ mới', group: 'worker', paidToWorker: true, unit: 'month' }),
  compliance: newLine({ name: 'Bảo hiểm / chế độ mới', group: 'compliance' }),
  other: newLine({ name: 'Chi phí khác', group: 'other' }),
  service: newLine({ name: 'Phí dịch vụ', group: 'service', isServiceFee: true }),
}[s]);

export interface LineSuggestion { line: CostLine; hint?: string }

const MODES: { value: LineMode; label: string }[] = [{ value: 'fixed', label: 'Nhập số' }, { value: 'percent', label: 'Theo %' }, { value: 'leave', label: 'Phép năm' }];

export default function CostSections({ lines, result, baseDays, readOnly, onChange, suggestions, show }: {
  lines: CostLine[];
  result: PlanResult;
  baseDays: number;
  readOnly?: boolean;
  onChange: (next: CostLine[]) => void;
  suggestions: LineSuggestion[];
  /** Chỉ hiện các nhóm này (bước 1: chi phí lao động; bước 2: phí dịch vụ). Mặc định hiện tất cả. */
  show?: Sec[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const replace = (l: CostLine) => onChange(lines.map(x => (x.id === l.id ? l : x)));
  const patch = (id: string, p: Partial<CostLine>) => onChange(lines.map(l => (l.id === id ? { ...l, ...p } : l)));
  const remove = (id: string) => { onChange(lines.filter(l => l.id !== id)); setOpenId(null); };
  const move = (l: CostLine, d: -1 | 1) => {
    const peers = lines.filter(x => secOf(x) === secOf(l));
    const j = peers.findIndex(x => x.id === l.id) + d;
    if (j < 0 || j >= peers.length) return;
    const a = lines.findIndex(x => x.id === l.id), b = lines.findIndex(x => x.id === peers[j].id);
    const next = [...lines]; [next[a], next[b]] = [next[b], next[a]];
    onChange(next);
  };

  const add = (line: CostLine, s: Sec) => {
    const l = withSection({ ...line, id: newLine({ name: '' }).id }, s);
    if (s === 'service') onChange([...lines, l]);
    else {
      const i = lines.findIndex(x => x.isServiceFee);
      onChange(i < 0 ? [...lines, l] : [...lines.slice(0, i), l, ...lines.slice(i)]);
    }
    setOpenId(l.id);
  };

  // Chỉ 1 dòng được là Lương cơ bản — gốc của mọi khoản tính theo %
  const setBaseWage = (l: CostLine, on: boolean) => onChange(lines.map(x => {
    if (x.id !== l.id) return on ? { ...x, isBaseWage: false } : x;
    if (!on) return { ...x, isBaseWage: false };
    const asFixed = x.mode === 'fixed' ? {} : { mode: 'fixed' as const, unit: 'day' as const, value: Math.round(result.lines[x.id]?.daily ?? 0), base: undefined, cap: undefined };
    return { ...withSection(x, 'worker'), ...asFixed, isBaseWage: true, insurable: true };
  }));

  const setMode = (l: CostLine, mode: LineMode) => {
    if (mode === l.mode) return;
    if (mode === 'fixed') replace({ ...l, mode, unit: 'day', value: Math.round(result.lines[l.id]?.daily ?? 0), base: undefined, cap: undefined });
    else if (mode === 'percent') replace({ ...l, mode, base: l.base ?? (l.isServiceFee ? 'cost_total' : 'base_wage'), value: l.mode === 'leave' ? 0 : l.value });
    else replace({ ...l, mode, value: l.mode === 'leave' ? l.value : 12, base: undefined, cap: undefined });
  };

  /** Đổi đơn vị đang hiển thị/nhập (công ⇄ tháng) mà KHÔNG đổi số tiền thật. */
  const flipUnit = (l: CostLine) => {
    const to = l.unit === 'day' ? 'month' : 'day';
    const v = to === 'month' ? l.value * baseDays : l.value / baseDays;
    replace({ ...l, unit: to, value: Math.round(v) });
  };

  const caption = (l: CostLine): string => {
    const r = result.lines[l.id];
    if (!r) return '';
    if (l.mode === 'percent' && !l.isBaseWage) {
      const cap = l.cap && l.cap > 0 ? ` · trần ${fmtShort(l.cap)}/tháng` : '';
      return `${String(l.value).replace('.', ',')}% × ${BASE_LABELS[l.base ?? 'base_wage'].toLowerCase()}${cap} · ≈ ${fmt(r.monthly)} đ/tháng`;
    }
    if (l.mode === 'leave') return `${l.value} ngày phép/năm · ≈ ${fmt(r.monthly)} đ/tháng`;
    return l.unit === 'month' ? `≈ ${fmt(r.daily)} đ/công` : `≈ ${fmt(r.monthly)} đ/tháng`;
  };

  return (
    <div className="space-y-4">
      {SECS.filter(sec => !show || show.includes(sec.key)).map(sec => {
        const items = lines.filter(l => secOf(l) === sec.key);
        if (sec.key === 'other' && items.length === 0) return null;
        const subtotal = items.reduce((s, l) => s + (result.lines[l.id]?.daily ?? 0), 0);
        const opt = suggestions.filter(s => secOf(s.line) === sec.key || (sec.key === 'other' && secOf(s.line) === 'other'));
        const empty = items.length === 0;

        return (
          <section key={sec.key} className={`${card} overflow-visible`}>
            <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" style={{ background: sec.dot }} />
                <h3 className="text-[14px] font-semibold text-[#1d1d1f] truncate">{sec.title}</h3>
                <span className="hidden sm:inline text-[12px] text-[#86868b] truncate">{sec.sub}</span>
              </div>
              {!empty && <div className="text-[14px] font-semibold tabular-nums whitespace-nowrap" style={{ color: sec.dot }}>{fmt(subtotal)} <span className="text-[11px] font-normal text-[#86868b]">đ/công</span></div>}
            </header>

            {empty && <div className="px-5 pb-1 text-[12.5px] text-[#86868b]">Chưa có khoản nào.</div>}

            <div className="divide-y divide-[#f2f2f4]">
              {items.map(l => {
                const r = result.lines[l.id] ?? { daily: 0, monthly: 0, derived: false };
                const issue = result.warnings.find(w => w.lineId === l.id && w.level === 'error');
                const exp = openId === l.id && !readOnly;
                const derived = r.derived;
                return (
                  <div key={l.id} className={exp ? 'bg-[#fafafc]' : ''}>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <input value={l.name} disabled={readOnly} onChange={e => patch(l.id, { name: e.target.value })} placeholder="Tên khoản mục"
                          className="w-full bg-transparent text-[14px] font-medium text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] truncate" />
                        <div className={`text-[11.5px] truncate ${issue ? 'text-[#d70015]' : 'text-[#86868b]'}`}>
                          {l.isBaseWage && <span className="font-semibold text-[#0071e3]">Lương cơ bản · </span>}
                          {issue ? issue.text.replace(/^".*?":\s*/, '') : caption(l)}
                        </div>
                      </div>

                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        {derived || readOnly ? (
                          <span className="w-[112px] text-right text-[14px] font-semibold tabular-nums text-[#1d1d1f]">{fmt(derived ? r.daily : l.unit === 'day' ? l.value : r.monthly)}</span>
                        ) : (
                          <MoneyInput value={l.value} onChange={n => patch(l.id, { value: n })} disabled={readOnly}
                            className="w-[112px] h-8 px-2 rounded-lg bg-transparent hover:bg-[#f5f5f7] focus:bg-white focus:ring-2 focus:ring-[#0071e3]/40 text-right text-[14px] font-semibold tabular-nums text-[#1d1d1f] outline-none transition" />
                        )}
                        {derived || readOnly ? (
                          <span className="w-10 text-[11px] text-[#86868b]">{derived ? '/công' : l.unit === 'day' ? '/công' : '/tháng'}</span>
                        ) : (
                          <button type="button" onClick={() => flipUnit(l)} title="Đổi đơn vị nhập (công ⇄ tháng) — số tiền không đổi"
                            className="w-10 text-left text-[11px] font-medium text-[#0071e3] hover:text-[#0077ed]">{l.unit === 'day' ? '/công' : '/tháng'}</button>
                        )}
                      </div>

                      {!readOnly && (
                        <button type="button" onClick={() => setOpenId(exp ? null : l.id)} aria-label="Tuỳ chọn khoản mục"
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 ${exp ? 'bg-[#e8e8ed] text-[#1d1d1f]' : 'text-[#86868b] hover:bg-[#f0f0f2]'}`}><MoreHorizontal size={15} /></button>
                      )}
                    </div>

                    {exp && (
                      <div className="px-5 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                        <div>
                          <span className={labelCls}>Cách tính</span>
                          <Seg value={l.isBaseWage ? 'fixed' : l.mode} onChange={m => setMode(l, m)} disabled={l.isBaseWage} options={MODES} />
                          {l.mode === 'percent' && !l.isBaseWage && (
                            <div className="flex items-center gap-2 mt-2">
                              <NumInput value={l.value} step={0.1} max={1000} onChange={n => patch(l.id, { value: n })} className={`${field} w-20 text-right font-semibold`} />
                              <span className="text-[12px] text-[#6e6e73]">% của</span>
                              <Select value={l.base ?? 'base_wage'} onChange={v => patch(l.id, { base: v as PercentBase })} className="flex-1 min-w-0">
                                {allowedBases(l).map(b => <option key={b} value={b}>{BASE_LABELS[b]}</option>)}
                              </Select>
                            </div>
                          )}
                          {l.mode === 'leave' && !l.isBaseWage && (
                            <div className="flex items-center gap-2 mt-2">
                              <NumInput value={l.value} max={30} onChange={n => patch(l.id, { value: n })} className={`${field} w-20 text-right font-semibold`} />
                              <span className="text-[12px] text-[#6e6e73]">ngày phép có lương mỗi năm</span>
                            </div>
                          )}
                        </div>

                        <div>
                          <span className={labelCls}>Nhóm</span>
                          <Select value={secOf(l)} onChange={v => replace(withSection(l, v as Sec))}>
                            {SECS.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}
                          </Select>
                        </div>

                        {!l.isServiceFee && (
                          <div className="sm:col-span-2 rounded-xl bg-white ring-1 ring-black/5 px-3.5 divide-y divide-[#f2f2f4]">
                            {l.paidToWorker && <Row label="Là lương cơ bản" hint="Gốc để tính BHXH, công đoàn, phép năm"><Switch on={!!l.isBaseWage} onChange={v => setBaseWage(l, v)} /></Row>}
                            {!l.isBaseWage && l.mode === 'fixed' && <Row label="Tính vào lương đóng BHXH" hint="BHXH và công đoàn sẽ tăng theo khoản này"><Switch on={!!l.insurable} onChange={v => patch(l.id, { insurable: v })} /></Row>}
                          </div>
                        )}

                        <div className="sm:col-span-2">
                          <span className={labelCls}>Căn cứ / ghi chú</span>
                          <input value={l.note} onChange={e => patch(l.id, { note: e.target.value })} placeholder="Điều khoản, thoả thuận…" className={`${field} w-full`} />
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-between pt-1">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => move(l, -1)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#e8e8ed]" title="Lên"><ArrowUp size={15} /></button>
                            <button type="button" onClick={() => move(l, 1)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#e8e8ed]" title="Xuống"><ArrowDown size={15} /></button>
                          </div>
                          <button type="button" onClick={() => remove(l.id)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium text-[#d70015] hover:bg-[#fff1f0]"><Trash2 size={14} />Xoá khoản này</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!readOnly && (
              <div className="px-5 py-2.5 border-t border-[#f2f2f4]">
                {sec.key === 'service' && !empty ? null : (
                  <Popover align="left" width="w-80" button={({ toggle }) => (
                    <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed]"><Plus size={14} />Thêm khoản</button>
                  )}>
                    {close => (
                      <div className="max-h-80 overflow-y-auto py-1">
                        <MenuItem onClick={() => { add(blankFor(sec.key), sec.key); close(); }}>Khoản trống</MenuItem>
                        {opt.length > 0 && <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]">Gợi ý</div>}
                        {opt.map(s => (
                          <MenuItem key={s.line.id} hint={s.hint} onClick={() => { add(s.line, sec.key); close(); }}>{s.line.name}</MenuItem>
                        ))}
                      </div>
                    )}
                  </Popover>
                )}
              </div>
            )}
          </section>
        );
      })}

      {!readOnly && (!show || show.includes('other')) && !lines.some(l => secOf(l) === 'other') && (
        <button type="button" onClick={() => add(blankFor('other'), 'other')} className="text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed] inline-flex items-center gap-1 px-1"><Plus size={14} />Thêm chi phí khác</button>
      )}
    </div>
  );
}
