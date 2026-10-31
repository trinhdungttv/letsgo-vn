// Form hồ sơ ứng viên (thêm mới / sửa) — chống trùng SĐT / CCCD ngay khi gõ xong.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { FOCUS_PROVINCES } from '../../pages/market/populationData';
import { findCandidates } from '../../lib/recruit/api';
import { cleanName, formatPhone, isValidIdNumber, isValidPhone, normalizeIdNumber, normalizePhone } from '../../lib/recruit/normalize';
import { EDUCATION_LABEL, EDUCATION_ORDER, SOURCE_CHANNELS } from '../../lib/recruit/types';
import type { CandidateMatch, RecruitCandidate } from '../../lib/recruit/types';
import { loadCommunes, useRecruit } from './context';
import type { CommuneRef } from './context';
import { Field, Switch, TriState, inputCls, sectionCls } from './ui';

export type CandidateDraft = Omit<RecruitCandidate, 'id' | 'created_by' | 'created_at' | 'updated_at'>;

export const blankCandidate = (): CandidateDraft => ({
  full_name: '', phone: '', phone_alt: '', id_number: '', birth_year: null, gender: null, province: '', commune: '', address: '',
  hometown: '', lat: null, lng: null, education: '', major: '', diploma_pending: false, diploma_due: null, experience: '',
  shift_ok: null, cleanroom_ok: null, source_channel: '', referrer_contact_id: null, referrer_name: '', referrer_phone: '',
  consent_at: null, consent_source: '', blacklisted: false, blacklist_reason: '', notes: '', tags: [],
});

/** Kiểm tra trước khi lưu — trả câu lỗi hoặc ''. */
export function validateCandidate(d: CandidateDraft): string {
  if (!cleanName(d.full_name)) return 'Nhập họ tên';
  const phone = normalizePhone(d.phone);
  const idn = normalizeIdNumber(d.id_number);
  if (!phone && !idn) return 'Nhập số điện thoại (hoặc CCCD) để chống trùng hồ sơ';
  if (phone && !isValidPhone(phone)) return 'Số điện thoại phải có 10 số, bắt đầu bằng 0';
  if (idn && !isValidIdNumber(idn)) return 'CCCD phải có 12 số (CMND cũ 9 số)';
  if (d.birth_year && (d.birth_year < 1940 || d.birth_year > new Date().getFullYear() - 14)) return 'Năm sinh không hợp lệ';
  return '';
}

/** Chuẩn hoá trước khi gửi. */
export function cleanCandidate(d: CandidateDraft): CandidateDraft {
  return {
    ...d,
    full_name: cleanName(d.full_name),
    phone: normalizePhone(d.phone),
    phone_alt: normalizePhone(d.phone_alt),
    id_number: normalizeIdNumber(d.id_number),
    referrer_phone: normalizePhone(d.referrer_phone),
    diploma_due: d.diploma_pending ? d.diploma_due || null : null,
  };
}

export default function CandidateForm({ value, onChange, excludeId, onOpenExisting }: {
  value: CandidateDraft;
  onChange: (d: CandidateDraft) => void;
  /** Hồ sơ đang sửa (bỏ qua khi dò trùng) */
  excludeId?: string | null;
  /** Bấm "Mở hồ sơ" ở cảnh báo trùng */
  onOpenExisting?: (id: string) => void;
}) {
  const { sales } = useRecruit();
  const d = value;
  const set = <K extends keyof CandidateDraft>(k: K, v: CandidateDraft[K]) => onChange({ ...d, [k]: v });
  const [dups, setDups] = useState<CandidateMatch[]>([]);
  const [communes, setCommunes] = useState<CommuneRef[]>([]);
  useEffect(() => { loadCommunes().then(setCommunes, () => {}); }, []);

  // dò trùng khi SĐT / CCCD đủ độ dài
  const phone = normalizePhone(d.phone);
  const idn = normalizeIdNumber(d.id_number);
  useEffect(() => {
    const q = { phone: isValidPhone(phone) ? phone : '', id_number: isValidIdNumber(idn) ? idn : '', exclude_id: excludeId ?? null };
    if (!q.phone && !q.id_number) { setDups([]); return; }
    let alive = true;
    const t = setTimeout(() => { findCandidates(q).then(r => { if (alive) setDups(r); }, () => {}); }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [phone, idn, excludeId]);

  const provinces = useMemo(() => {
    const fromData = [...new Set(communes.map(c => c.province))];
    return [...new Set([...FOCUS_PROVINCES.map(p => p.name), ...fromData])];
  }, [communes]);
  const communeList = useMemo(() => communes.filter(c => !d.province || c.province === d.province), [communes, d.province]);

  const pickCommune = (name: string) => {
    const c = communeList.find(x => x.commune === name);
    onChange({ ...d, commune: name, lat: c?.lat ?? null, lng: c?.lng ?? null, province: c?.province ?? d.province });
  };
  const pickReferrer = (id: string) => {
    const s = sales.find(x => x.id === id);
    onChange({ ...d, referrer_contact_id: id || null, referrer_name: s?.name ?? d.referrer_name, referrer_phone: s?.phone ? normalizePhone(s.phone) : d.referrer_phone,
      source_channel: id && !d.source_channel ? 'CTV giới thiệu' : d.source_channel });
  };

  return (
    <div className="space-y-3">
      {dups.length > 0 && (
        <div className="rounded-[12px] bg-[#FF9500]/[0.12] text-[#8A4B00] text-[13px] px-3.5 py-2.5 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Đã có hồ sơ trùng SĐT / CCCD</div>
          {dups.map(m => (
            <div key={m.id} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate">{m.full_name}{m.birth_year ? ` (${m.birth_year})` : ''} · {formatPhone(m.phone)}{m.blacklisted ? ' · DANH SÁCH ĐEN' : ''}</span>
              {onOpenExisting && <button type="button" onClick={() => onOpenExisting(m.id)} className="font-semibold text-[#0066CC] hover:opacity-70">Mở hồ sơ</button>}
            </div>
          ))}
        </div>
      )}

      <section className={sectionCls}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Họ tên *" className="col-span-2">
            <input value={d.full_name} onChange={e => set('full_name', e.target.value)} onBlur={() => set('full_name', cleanName(d.full_name))} className={inputCls} />
          </Field>
          <Field label="Số điện thoại *">
            <input value={d.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" placeholder="09xx xxx xxx" className={inputCls} />
          </Field>
          <Field label="Năm sinh">
            <input type="number" value={d.birth_year ?? ''} onChange={e => set('birth_year', e.target.value === '' ? null : Number(e.target.value))} placeholder="1999" className={inputCls} />
          </Field>
          <Field label="Giới tính">
            <select value={d.gender ?? ''} onChange={e => set('gender', (e.target.value || null) as CandidateDraft['gender'])} className={inputCls}>
              <option value="">—</option>
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>
          </Field>
          <Field label="CCCD">
            <input value={d.id_number} onChange={e => set('id_number', e.target.value)} inputMode="numeric" placeholder="12 số" className={inputCls} />
          </Field>
          <Field label="SĐT khác / Zalo">
            <input value={d.phone_alt} onChange={e => set('phone_alt', e.target.value)} inputMode="tel" className={inputCls} />
          </Field>
          <Field label="Quê quán">
            <input value={d.hometown} onChange={e => set('hometown', e.target.value)} placeholder="VD: Thanh Hoá" className={inputCls} />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Đang ở — Tỉnh/TP">
            <select value={d.province} onChange={e => onChange({ ...d, province: e.target.value, commune: '', lat: null, lng: null })} className={inputCls}>
              <option value="">—</option>
              {provinces.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Xã / Phường" hint={communeList.length ? 'Chọn từ danh mục để lên bản đồ nguồn lao động' : undefined}>
            <input value={d.commune} onChange={e => pickCommune(e.target.value)} list="recruit-commune-list" className={inputCls} />
            <datalist id="recruit-commune-list">{communeList.slice(0, 600).map(c => <option key={`${c.province}|${c.commune}`} value={c.commune} />)}</datalist>
          </Field>
          <Field label="Địa chỉ / khu trọ" className="col-span-2">
            <input value={d.address} onChange={e => set('address', e.target.value)} className={inputCls} />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Trình độ">
            <select value={d.education} onChange={e => set('education', e.target.value as CandidateDraft['education'])} className={inputCls}>
              <option value="">—</option>
              {EDUCATION_ORDER.map(k => <option key={k} value={k}>{EDUCATION_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Chuyên ngành">
            <input value={d.major} onChange={e => set('major', e.target.value)} placeholder="VD: Điện công nghiệp" className={inputCls} />
          </Field>
          <Field label="Làm ca">
            <TriState value={d.shift_ok} onChange={v => set('shift_ok', v)} yes="Được" />
          </Field>
          <Field label="Phòng sạch">
            <TriState value={d.cleanroom_ok} onChange={v => set('cleanroom_ok', v)} yes="Được" />
          </Field>
          <div className="col-span-2 flex items-center gap-3 flex-wrap">
            <Switch checked={d.diploma_pending} onChange={v => set('diploma_pending', v)} label="Đã tốt nghiệp, đang chờ bằng" />
          </div>
          {d.diploma_pending && (
            <Field label="Hạn nộp bằng">
              <input type="date" value={d.diploma_due ?? ''} onChange={e => set('diploma_due', e.target.value || null)} className={inputCls} />
            </Field>
          )}
          <Field label="Kinh nghiệm" className="col-span-2 md:col-span-4">
            <input value={d.experience} onChange={e => set('experience', e.target.value)} placeholder="VD: 2 năm vận hành máy CNC ở KCN Mỹ Phước" className={inputCls} />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Nguồn">
            <input value={d.source_channel} onChange={e => set('source_channel', e.target.value)} list="recruit-source-list" className={inputCls} />
            <datalist id="recruit-source-list">{SOURCE_CHANNELS.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="CTV giới thiệu (Mạng lưới Sale)">
            <select value={d.referrer_contact_id ?? ''} onChange={e => pickReferrer(e.target.value)} className={inputCls}>
              <option value="">— Không / ngoài danh bạ —</option>
              {sales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Tên người giới thiệu">
            <input value={d.referrer_name} onChange={e => set('referrer_name', e.target.value)} className={inputCls} />
          </Field>
          <Field label="SĐT người giới thiệu">
            <input value={d.referrer_phone} onChange={e => set('referrer_phone', e.target.value)} inputMode="tel" className={inputCls} />
          </Field>
          <Field label="Ghi chú" className="col-span-2 md:col-span-4">
            <textarea value={d.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} />
          </Field>
          <div className="col-span-2 md:col-span-4 space-y-1">
            <Switch checked={!!d.consent_at} onChange={v => onChange({ ...d, consent_at: v ? new Date().toISOString() : null, consent_source: v ? d.consent_source || 'verbal' : '' })}
              label={<span>Ứng viên đồng ý cho lưu & dùng thông tin để giới thiệu việc làm <span className="text-[#86868B]">(Luật Bảo vệ dữ liệu cá nhân)</span></span>} />
            <Switch checked={d.blacklisted} onChange={v => set('blacklisted', v)} label="Danh sách đen (không giới thiệu nữa)" />
          </div>
          {d.blacklisted && (
            <Field label="Lý do" className="col-span-2 md:col-span-4">
              <input value={d.blacklist_reason} onChange={e => set('blacklist_reason', e.target.value)} placeholder="VD: bỏ việc không báo 2 lần" className={inputCls} />
            </Field>
          )}
        </div>
      </section>
    </div>
  );
}
