// Trang ứng tuyển công khai #/apply/<mã>[/<id CTV>] — người lao động mở từ link / mã QR, KHÔNG cần đăng nhập.
// Chỉ gọi 2 hàm recruit_public_get / recruit_public_apply (migration 181): xem vị trí đang tuyển + gửi hồ sơ.
import { useEffect, useMemo, useState } from 'react';
import { Briefcase, CheckCircle2, ChevronDown, Clock, MapPin, ShieldCheck, Wallet } from 'lucide-react';
import { APPLY_REASON_TEXT, fetchPublicProject, submitPublicApplication } from '../lib/recruit/publicLink';
import type { PublicPosition, PublicProject } from '../lib/recruit/publicLink';
import { bullets, requirementLines, salaryText } from '../lib/recruit/jobPost';
import { cleanName, normalizePhone } from '../lib/recruit/normalize';
import { EDUCATION_LABEL, EDUCATION_ORDER } from '../lib/recruit/types';
import type { RecruitPosition } from '../lib/recruit/types';

const field = 'w-full h-12 px-3.5 rounded-[12px] bg-white border border-black/[0.12] text-[16px] text-[#1D1D1F] placeholder:text-[#AEAEB2] outline-none focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15';
const label = 'block text-[13px] font-medium text-[#6E6E73] mb-1.5';

export default function PublicApply({ code, refId }: { code: string; refId: string | null }) {
  const [data, setData] = useState<PublicProject | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [openPos, setOpenPos] = useState<string | null>(null);
  const [f, setF] = useState({ full_name: '', phone: '', birth_year: '', gender: '', position_id: '', site_id: '', province: '', address: '', education: '', experience: '', note: '', consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchPublicProject(code).then(setData, e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [code]);
  useEffect(() => { if (data?.project.name) document.title = `Tuyển dụng — ${data.project.name}`; }, [data]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(cur => ({ ...cur, [k]: v }));
  const sites = data?.sites ?? [];
  const positions = data?.positions ?? [];
  const sitesForPos = useMemo(() => {
    const p = positions.find(x => x.id === f.position_id);
    return p && p.site_ids.length ? sites.filter(s => p.site_ids.includes(s.id)) : sites;
  }, [positions, sites, f.position_id]);

  const submit = async () => {
    setError('');
    if (!cleanName(f.full_name)) { setError(APPLY_REASON_TEXT.name); return; }
    if (!/^0\d{9}$/.test(normalizePhone(f.phone))) { setError(APPLY_REASON_TEXT.phone); return; }
    if (!f.consent) { setError(APPLY_REASON_TEXT.consent); return; }
    setBusy(true);
    try {
      const r = await submitPublicApplication(code, { ...f, full_name: cleanName(f.full_name), phone: normalizePhone(f.phone), ref: refId });
      if (r.ok) setDone(true);
      else setError(APPLY_REASON_TEXT[r.reason ?? 'closed']);
    } catch {
      setError('Không gửi được, vui lòng kiểm tra mạng rồi thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] bg-[#F5F5F7] px-4 py-6 md:py-10">
      <div className="max-w-[560px] mx-auto space-y-4">{children}</div>
    </div>
  );

  if (data === undefined && !loadError) return shell(<div className="py-24 flex justify-center"><div className="w-6 h-6 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" /></div>);
  if (loadError || !data) {
    return shell(
      <div className="bg-white rounded-[22px] p-6 text-center">
        <h1 className="text-[20px] font-bold text-[#1D1D1F]">Đợt tuyển không còn mở</h1>
        <p className="text-[14px] text-[#6E6E73] mt-2">Link đã hết hạn hoặc nhập sai. Vui lòng liên hệ người đã gửi link cho bạn.</p>
      </div>,
    );
  }
  if (done) {
    return shell(
      <div className="bg-white rounded-[22px] p-7 text-center">
        <CheckCircle2 size={44} className="mx-auto text-[#34C759]" />
        <h1 className="text-[22px] font-bold text-[#1D1D1F] mt-3">Đã nhận hồ sơ!</h1>
        <p className="text-[15px] text-[#6E6E73] mt-2">Cảm ơn {cleanName(f.full_name)}. Bộ phận tuyển dụng sẽ gọi cho bạn qua số {f.phone} trong 1–2 ngày làm việc.</p>
      </div>,
    );
  }

  return shell(
    <>
      <header className="px-1">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#86868B]">Tuyển dụng</p>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] leading-tight text-[#1D1D1F] mt-1">{data.project.name}</h1>
        {data.project.no_worker_fee && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1E7B34] bg-[#34C759]/[0.14] rounded-full px-3 py-1">
            <ShieldCheck size={14} /> Không thu bất kỳ khoản phí nào của người lao động
          </p>
        )}
      </header>

      <section className="space-y-2.5">
        {positions.length === 0 && <p className="text-[14px] text-[#6E6E73] px-1">Hiện chưa có vị trí mở tuyển.</p>}
        {positions.map(p => <PositionCard key={p.id} p={p} sites={sites} open={openPos === p.id}
          onToggle={() => setOpenPos(openPos === p.id ? null : p.id)}
          onApply={() => { set('position_id', p.id); document.getElementById('apply-form')?.scrollIntoView({ behavior: 'smooth' }); }} />)}
      </section>

      <section id="apply-form" className="bg-white rounded-[22px] p-5 space-y-4 scroll-mt-4">
        <h2 className="text-[20px] font-bold text-[#1D1D1F]">Gửi hồ sơ ứng tuyển</h2>
        <div><span className={label}>Họ và tên *</span><input value={f.full_name} onChange={e => set('full_name', e.target.value)} autoComplete="name" className={field} /></div>
        <div><span className={label}>Số điện thoại (Zalo) *</span><input value={f.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" className={field} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className={label}>Năm sinh</span><input value={f.birth_year} onChange={e => set('birth_year', e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="2000" className={field} /></div>
          <div><span className={label}>Giới tính</span>
            <select value={f.gender} onChange={e => set('gender', e.target.value)} className={field}>
              <option value="">—</option><option value="male">Nam</option><option value="female">Nữ</option>
            </select>
          </div>
        </div>
        {positions.length > 0 && (
          <div><span className={label}>Vị trí muốn ứng tuyển</span>
            <select value={f.position_id} onChange={e => set('position_id', e.target.value)} className={field}>
              <option value="">— Chọn vị trí —</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}
        {sitesForPos.length > 1 && (
          <div><span className={label}>Nơi muốn làm</span>
            <select value={f.site_id} onChange={e => set('site_id', e.target.value)} className={field}>
              <option value="">— Nơi nào cũng được —</option>
              {sitesForPos.map(s => <option key={s.id} value={s.id}>{s.name}{s.zone_name && s.zone_name !== s.name ? ` (${s.zone_name})` : ''}</option>)}
            </select>
          </div>
        )}
        <div><span className={label}>Trình độ</span>
          <select value={f.education} onChange={e => set('education', e.target.value)} className={field}>
            <option value="">—</option>
            {EDUCATION_ORDER.map(k => <option key={k} value={k}>{EDUCATION_LABEL[k]}</option>)}
          </select>
        </div>
        <div><span className={label}>Đang ở (xã/phường, tỉnh)</span><input value={f.address} onChange={e => set('address', e.target.value)} placeholder="VD: P. Tân Uyên, TP.HCM" className={field} /></div>
        <div><span className={label}>Kinh nghiệm (nếu có)</span><textarea value={f.experience} onChange={e => set('experience', e.target.value)} rows={2} className={`${field} h-auto py-3`} /></div>
        <label className="flex items-start gap-3 text-[14px] text-[#1D1D1F] cursor-pointer">
          <input type="checkbox" checked={f.consent} onChange={e => set('consent', e.target.checked)} aria-label="Đồng ý cho lưu thông tin để giới thiệu việc làm"
            className="mt-1 w-5 h-5 accent-[#0071E3] shrink-0" />
          <span>Tôi đồng ý để Let's Go VN lưu thông tin trên và liên hệ giới thiệu việc làm phù hợp.</span>
        </label>
        {error && <p className="text-[14px] text-[#D70015]">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}
          className="w-full h-12 rounded-full bg-[#0071E3] text-white text-[16px] font-semibold active:scale-[0.98] transition disabled:opacity-50">
          {busy ? 'Đang gửi…' : 'Gửi hồ sơ'}
        </button>
      </section>
      <p className="text-center text-[12px] text-[#86868B]">Let's Go VN — cung ứng & giới thiệu lao động</p>
    </>,
  );
}

function PositionCard({ p, sites, open, onToggle, onApply }: {
  p: PublicPosition;
  sites: PublicProject['sites'];
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
}) {
  const where = (p.site_ids.length ? sites.filter(s => p.site_ids.includes(s.id)) : sites).map(s => s.name).join(', ');
  const time = [p.hours_per_week ? `${p.hours_per_week} giờ/tuần` : '', p.shift_note].filter(Boolean).join(' · ');
  const req = requirementLines({ ...p, project_id: '', employment_type: 'direct', confirmed: true, is_open: true, fee_override: null, sort_order: 0 } as RecruitPosition);
  return (
    <div className="bg-white rounded-[18px] overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full text-left p-4 flex items-start gap-3">
        <span className="w-10 h-10 rounded-[11px] bg-[#0071E3]/10 text-[#0066CC] flex items-center justify-center shrink-0"><Briefcase size={19} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-[#1D1D1F]">{p.title}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-[#6E6E73]">
            <span className="inline-flex items-center gap-1"><Wallet size={13} /> {salaryText(p)}</span>
            {where && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {where}</span>}
            {time && <span className="inline-flex items-center gap-1"><Clock size={13} /> {time}</span>}
          </span>
        </span>
        <ChevronDown size={18} className={`text-[#AEAEB2] mt-2 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 text-[14px] text-[#1D1D1F] space-y-3">
          {bullets(p.description).length > 0 && <Block title="Mô tả công việc" lines={bullets(p.description)} />}
          {req.length > 0 && <Block title="Yêu cầu" lines={req} />}
          {bullets(p.benefits).length > 0 && <Block title="Quyền lợi" lines={bullets(p.benefits)} />}
          <button type="button" onClick={onApply} className="w-full h-11 rounded-full bg-[#0071E3]/10 text-[#0066CC] font-semibold">Ứng tuyển vị trí này</button>
        </div>
      )}
    </div>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1">{title}</h3>
      <ul className="space-y-0.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}
