// "Ngày sinh & ngày quan trọng" ngay trong hồ sơ (port PRM OccasionEditor): nhiều dòng, mỗi
// dòng = loại + tên + ngày/tháng/năm (năm không bắt buộc) + Âm lịch + Nhắc trước 1/3/7 ngày
// hoặc chỉ đúng ngày. Dưới mỗi dòng: "Lần tới … (còn N ngày)"; sinh nhật có năm thì hiện tuổi
// âm (can chi + mệnh) kèm phần mở rộng hợp / kỵ (tử vi dân gian, tham khảo).
import { useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { compatibility, lunarYearOf, yearSign } from '../../../lib/cskh/canChi';
import { formatDateVN } from '../../../lib/cskh/dates';
import {
  alertWhen, draftError, isBlankDraft, isProfileBirthdayId, maxDay, nextOccurrenceInfo, REMIND_OPTIONS,
  remindLabel, type OccasionDraft,
} from '../../../lib/cskh/occasions';
import { newOccasionRow, type OccasionRow } from './occasionRows';
import type { OccasionType } from '../../../lib/cskh/types';
import { OCCASION_LABEL } from '../../../lib/cskh/types';

/** Tuổi âm (can chi + mệnh nạp âm) và gợi ý hợp / kỵ — bấm để xem chi tiết. */
export function YearSignInfo({ day, month, year, isLunar }: { day: number; month: number; year: number; isLunar: boolean }) {
  const [open, setOpen] = useState(false);
  const sign = yearSign(lunarYearOf(day, month, year, isLunar));
  const c = compatibility(sign);
  return (
    <div className="mt-1.5 rounded-[10px] bg-[#AF52DE]/[0.08] px-3 py-2">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left text-[12.5px] text-[#1D1D1F] min-h-[28px]">
        <span><b className="font-semibold text-[#8944AB]">{sign.name}</b> · Mệnh {sign.napAm}</span>
        <span className="inline-flex items-center gap-0.5 shrink-0 text-[12px] font-medium text-[#8944AB]">
          Hợp / kỵ <ChevronDown size={13} strokeWidth={2.2} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <dl className="mt-1.5 space-y-1 text-[12.5px] leading-snug">
          <div><dt className="inline font-semibold text-[#248A3D]">Hợp làm ăn: </dt><dd className="inline">tuổi {c.goodChi.join(', ')} · mệnh {c.goodElements.join(', ')}</dd></div>
          <div><dt className="inline font-semibold text-[#D70015]">Kỵ: </dt><dd className="inline">tuổi {c.badChi.join(', ')} · mệnh {c.badElements.join(', ')}</dd></div>
          <div>
            <dt className="inline font-semibold text-[#8944AB]">Năm hợp kết hôn: </dt>
            <dd className="inline">{c.goodYears.length > 0 ? c.goodYears.map(y => `${y.lunarYear} ${y.name}`).join(', ') : `tuổi ${c.goodChi.join(', ')}`}</dd>
          </div>
          <p className="text-[11.5px] text-[#86868B]">Theo tử vi dân gian (tam hợp, lục hợp, xung, hại, ngũ hành) — để tham khảo, gợi chuyện xã giao.</p>
        </dl>
      )}
    </div>
  );
}


const TYPES: OccasionType[] = ['birthday', 'anniversary', 'memorial', 'other'];
const EXAMPLE: Readonly<Record<OccasionType, string>> = {
  birthday: 'Sinh nhật con gái',
  anniversary: 'Kỷ niệm ngày cưới',
  memorial: 'Giỗ bố',
  other: 'Ngày thành lập công ty',
};
const MAX_ROWS = 10;
const SELECT = 'h-10 md:h-9 rounded-[10px] border border-black/[0.12] bg-white px-2.5 text-[13px] text-[#1D1D1F] outline-none focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15 transition';

export function OccasionEditor({ rows, onChange, today, notCared }: {
  rows: readonly OccasionRow[];
  onChange: (next: OccasionRow[]) => void;
  /** "YYYY-MM-DD" giờ VN. */
  today: string;
  /** Người chưa chọn Nhóm chăm sóc — hệ thống sẽ không nhắc. */
  notCared: boolean;
}) {
  const currentYear = Number(today.slice(0, 4));
  const patch = (uid: number, p: Partial<OccasionDraft>) => onChange(rows.map(r => (r.uid === uid ? { ...r, ...p } : r)));
  const remove = (uid: number) => {
    const next = rows.filter(r => r.uid !== uid);
    onChange(next.length > 0 ? next : [newOccasionRow()]);
  };
  const anyFilled = rows.some(r => !isBlankDraft(r));

  return (
    <div className="md:col-span-2 space-y-2.5">
      {rows.map(r => {
        const info = nextOccurrenceInfo(r, today);
        // Chỉ báo lỗi khi đã chọn đủ ngày + tháng, hoặc gõ đủ 4 số năm
        const err = (r.day !== null && r.month !== null) || (r.year !== null && String(r.year).length >= 4) ? draftError(r, currentYear) : null;
        const dayMax = Math.max(maxDay(r.month, r.isLunar), r.day ?? 0);
        const remindChoices = REMIND_OPTIONS.includes(r.remindDaysBefore) ? REMIND_OPTIONS : [...REMIND_OPTIONS, r.remindDaysBefore];
        const canRemove = rows.length > 1 || !isBlankDraft(r) || r.title.trim() !== '';
        return (
          <div key={r.uid} className="rounded-[12px] bg-white md:bg-white/80 p-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2">
              <select value={r.occasionType} onChange={e => patch(r.uid, { occasionType: e.target.value as OccasionType })} aria-label="Loại ngày" className={`${SELECT} shrink-0`}>
                {TYPES.map(t => <option key={t} value={t}>{OCCASION_LABEL[t]}</option>)}
              </select>
              <input type="text" value={r.title} onChange={e => patch(r.uid, { title: e.target.value })} maxLength={120}
                placeholder={`Tên (VD: ${EXAMPLE[r.occasionType]})`} aria-label="Tên ngày" className={`${SELECT} flex-1 min-w-0`} />
              {canRemove && (
                <button type="button" onClick={() => remove(r.uid)} aria-label="Bỏ ngày này" title="Bỏ ngày này"
                  className="shrink-0 w-7 h-7 rounded-full bg-[#FF3B30] text-white flex items-center justify-center hover:brightness-95 active:scale-95 transition">
                  <Minus size={14} strokeWidth={3} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <select value={r.day ?? ''} onChange={e => patch(r.uid, { day: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Ngày" className={`${SELECT} w-[72px]`}>
                <option value="">Ngày</option>
                {Array.from({ length: dayMax }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={r.month ?? ''} onChange={e => patch(r.uid, { month: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Tháng" className={`${SELECT} w-[122px]`}>
                <option value="">Tháng</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>Tháng {m}</option>)}
              </select>
              {/* type=text + inputMode=numeric: tránh kiểu ô số xấu trên iPhone */}
              <input type="text" inputMode="numeric" value={r.year ?? ''} placeholder="Năm" aria-label="Năm (không bắt buộc)"
                onChange={e => { const digits = e.target.value.replace(/\D/g, '').slice(0, 4); patch(r.uid, { year: digits === '' ? null : Number(digits) }); }}
                className={`${SELECT} w-[80px]`} />
              <button type="button" aria-pressed={r.isLunar} onClick={() => patch(r.uid, { isLunar: !r.isLunar })}
                className={`h-9 md:h-8 px-3 rounded-full text-[12.5px] font-medium transition active:scale-[0.97] ${r.isLunar ? 'bg-[#0071E3] text-white' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]'}`}>
                Âm lịch
              </button>
              <select value={r.remindDaysBefore} onChange={e => patch(r.uid, { remindDaysBefore: Number(e.target.value) })} aria-label="Nhắc trước" className={`${SELECT} md:ml-auto`}>
                {remindChoices.map(n => <option key={n} value={n}>{remindLabel(n)}</option>)}
              </select>
            </div>
            {err ? (
              <p className="mt-1.5 text-[12px] text-[#D70015]">{err}</p>
            ) : info && (
              <p className="mt-1.5 text-[12px] text-[#6E6E73]">
                Lần tới {formatDateVN(info.nextIso)}{r.isLunar ? ' (dương lịch)' : ''} · {alertWhen(info.daysUntil).toLowerCase()}
                {info.age !== null && ` · tròn ${info.age} tuổi`}
                {r.relatedPerson ? ` · của ${r.relatedPerson}` : ''}
                {isProfileBirthdayId(r.id) && ' · ngày sinh trong hồ sơ'}
              </p>
            )}
            {!err && info && r.occasionType === 'birthday' && r.year !== null && r.year >= 1900 && r.day !== null && r.month !== null && (
              <YearSignInfo day={r.day} month={r.month} year={r.year} isLunar={r.isLunar} />
            )}
          </div>
        );
      })}
      {rows.length < MAX_ROWS && rows.every(r => !isBlankDraft(r)) && (
        <button type="button" onClick={() => onChange([...rows, newOccasionRow('anniversary')])}
          className="inline-flex items-center gap-2 min-h-[36px] text-[13px] font-medium text-[#0066CC] hover:opacity-70">
          <span className="w-[22px] h-[22px] rounded-full bg-[#34C759] text-white flex items-center justify-center"><Plus size={14} strokeWidth={3} /></span>
          Thêm ngày quan trọng
        </button>
      )}
      <p className={`text-[11.5px] leading-snug ${notCared && anyFilled ? 'text-[#B25000]' : 'text-[#86868B]'}`}>
        {notCared && anyFilled
          ? 'Chưa chọn Nhóm chăm sóc — chọn Nhóm để được nhắc các ngày này.'
          : 'Mở app sẽ nhắc trước số ngày đã chọn và nhắc lại đúng ngày. Sinh nhật của chính người này (dương lịch, có năm) dùng chung với hồ sơ Khách hàng.'}
      </p>
    </div>
  );
}
