// Trang xem / chỉnh "Phương án giá" qua LINK NGẮN — không cần đăng nhập, chỉ cần mã 4 số (kiểu mở khoá iPhone).
// Đường dẫn: <tên miền>/#/p/<mã link>. Mã được kiểm tra ở server (hàm cost_plan_share_*), sai 5 lần thì khoá tạm.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Lock, RefreshCw, User } from 'lucide-react';
import { lockMessage, shareOpen, sharePeek, shareSave, type SharedPlan } from '../lib/costPlan/api';
import { computePlan, normalizePlanData, summarizePlan } from '../lib/costPlan/engine';
import type { PlanData } from '../lib/costPlan/types';
import PlanEditor from '../components/workspace/costplan/PlanEditor';
import PinPad from '../components/workspace/costplan/PinPad';
import { FONT, btnGhost, btnPrimary, card, field } from '../components/workspace/costplan/ui';
import { useBeforeUnloadWarning } from '../hooks/useBeforeUnloadWarning';
import { useAuth } from '../lib/auth';

const NAME_KEY = 'lgvn_share_name';
const pinKey = (code: string) => `lgvn_share_pin_${code}`;
const POLL_MS = 10000;

const readStore = (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } };
const writeStore = (s: Storage, k: string, v: string | null) => { try { if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { /* chế độ riêng tư — bỏ qua */ } };

type Phase = 'pin' | 'opening' | 'ready' | 'dead';

const FAIL_TEXT: Record<string, string> = {
  not_found: 'Link không tồn tại hoặc đã bị thu hồi.',
  expired: 'Link này đã hết hạn.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]" style={{ minHeight: '100dvh', fontFamily: FONT }}>
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-black/[0.06] px-4 h-12 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-[#1d1d1f] text-white font-bold text-[9px] flex items-center justify-center tracking-tight">GO</div>
        <div className="text-[13px] font-semibold tracking-tight">Let's Go VN</div>
        <div className="text-[13px] text-[#86868b]">Phương án giá</div>
      </div>
      {children}
    </div>
  );
}

export default function SharedCostPlan({ code }: { code: string }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('pin');
  const [pin, setPin] = useState<string>('');
  const [name, setName] = useState<string>(() => readStore(localStorage, NAME_KEY) ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [errTick, setErrTick] = useState(0);
  const [locked, setLocked] = useState(false);
  const [deadMsg, setDeadMsg] = useState('');

  const [plan, setPlan] = useState<SharedPlan | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [data, setData] = useState<PlanData | null>(null);
  const [baseline, setBaseline] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [remote, setRemote] = useState<{ version: number; by: string | null } | null>(null);
  const [conflict, setConflict] = useState<SharedPlan | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Người đã đăng nhập mở link thì điền sẵn tên
  useEffect(() => { if (!name && user?.full_name) setName(user.full_name); }, [user, name]);

  const apply = useCallback((p: SharedPlan, edit: boolean) => {
    const d = normalizePlanData(p.data);
    setPlan(p); setCanEdit(edit); setData(d); setBaseline(JSON.stringify(d));
    setRemote(null); setConflict(null);
  }, []);

  const tryOpen = useCallback(async (thePin: string, remember: boolean) => {
    setPhase('opening'); setErr(null);
    try {
      const r = await shareOpen(code, thePin);
      if (r.ok) {
        setPin(thePin);
        if (remember) writeStore(sessionStorage, pinKey(code), thePin);
        apply(r.plan, r.can_edit);
        setPhase('ready');
        return;
      }
      if (r.reason === 'not_found' || r.reason === 'expired') { setDeadMsg(FAIL_TEXT[r.reason]); setPhase('dead'); return; }
      writeStore(sessionStorage, pinKey(code), null);
      if (r.reason === 'locked') { setLocked(true); setErr(lockMessage(r.seconds)); }
      else setErr(`Mã chưa đúng${r.remaining != null ? ` — còn ${r.remaining} lần thử` : ''}`);
      setErrTick(t => t + 1);
      setPhase('pin');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setErrTick(t => t + 1);
      setPhase('pin');
    }
  }, [code, apply]);

  // Mở lại trong cùng tab (F5) thì không phải nhập lại mã
  useEffect(() => {
    const saved = readStore(sessionStorage, pinKey(code));
    if (saved && /^\d{4}$/.test(saved)) tryOpen(saved, false);
  }, [code, tryOpen]);

  const dirty = !!data && JSON.stringify(data) !== baseline;
  useBeforeUnloadWarning(dirty && canEdit);

  const result = useMemo(
    () => (data ? computePlan(data, { minWageMonthly: data.minWage?.monthly, minWageLabel: data.minWage?.label }) : null),
    [data],
  );

  // Có người khác (hoặc chủ phương án) vừa lưu → báo, không tự ghi đè nội dung đang chỉnh
  const versionRef = useRef(0);
  versionRef.current = plan?.version ?? 0;
  useEffect(() => {
    if (phase !== 'ready') return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await sharePeek(code, pin);
        if (r.ok && r.version > versionRef.current) setRemote({ version: r.version, by: r.updated_by_name });
        if (!r.ok && (r.reason === 'not_found' || r.reason === 'expired')) { setDeadMsg(FAIL_TEXT[r.reason]); setPhase('dead'); }
      } catch { /* mạng chập chờn */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [phase, code, pin]);

  const reloadLatest = async () => {
    if (dirty && !window.confirm('Tải bản mới sẽ bỏ các thay đổi chưa lưu của bạn. Tiếp tục?')) return;
    try {
      const r = await shareOpen(code, pin, false);
      if (r.ok) apply(r.plan, r.can_edit);
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
  };

  const save = async (force = false) => {
    if (!plan || !data || !result || !canEdit) return;
    if (!name.trim()) { setSaveErr('Nhập tên của bạn (ở khung trên) để mọi người biết ai vừa sửa.'); return; }
    writeStore(localStorage, NAME_KEY, name.trim());
    setSaving(true); setSaveErr(null);
    try {
      const r = await shareSave(code, pin, name.trim(), plan.version, data, summarizePlan(data, result), note.trim() || null, force);
      if (r.ok) {
        setPlan({ ...plan, version: r.version, updated_at: r.updated_at, updated_by_name: `${name.trim()} (qua link)` });
        setBaseline(JSON.stringify(data)); setNote(''); setRemote(null); setConflict(null);
        setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2200);
      } else if (r.reason === 'conflict') setConflict(r.plan);
      else if (r.reason === 'locked') setSaveErr(lockMessage(r.seconds));
      else if (r.reason === 'read_only') setSaveErr('Link này chỉ cho xem, không lưu được.');
      else if (r.reason === 'too_large') setSaveErr('Phương án quá lớn để lưu.');
      else if (r.reason === 'not_found' || r.reason === 'expired') { setDeadMsg(FAIL_TEXT[r.reason]); setPhase('dead'); }
      else setSaveErr('Không lưu được — thử lại.');
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
    setSaving(false);
  };

  // ────────────── Màn hình nhập mã ──────────────
  if (phase === 'pin' || phase === 'opening') {
    return (
      <Shell>
        <div className="max-w-sm mx-auto px-6 pt-12 pb-10 flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center mb-4"><Lock size={22} className="text-[#1d1d1f]" /></div>
          <h1 className="text-[22px] font-semibold tracking-tight mb-1">Nhập mã bảo mật</h1>
          <p className="text-[13px] text-[#6e6e73] mb-6 text-center leading-relaxed">Phương án giá được chia sẻ riêng cho bạn.<br />Nhập mã 4 số do người gửi cung cấp.</p>

          <label className="w-full mb-7">
            <span className="block text-[11px] font-medium text-[#6e6e73] mb-1">Tên của bạn <span className="text-[#a1a1a6]">· để ghi lại ai chỉnh</span></span>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1a6]" />
              <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="vd: Minh — Kế toán" className={`${field} !bg-white w-full pl-9 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]`} />
            </div>
          </label>

          <PinPad onComplete={p => tryOpen(p, true)} error={err} errorTick={errTick} disabled={locked} busy={phase === 'opening'} />

          <div className="h-12 mt-5 text-center">
            {phase === 'opening' && <div className="flex items-center justify-center gap-1.5 text-[13px] text-[#6e6e73]"><Loader2 size={14} className="animate-spin" />Đang kiểm tra…</div>}
            {phase === 'pin' && err && <div className="text-[13px] font-medium text-[#d70015]">{err}</div>}
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'dead') {
    return (
      <Shell>
        <div className="max-w-sm mx-auto px-6 pt-20 text-center">
          <AlertTriangle size={30} className="mx-auto text-[#ff9f0a] mb-3" />
          <h1 className="text-[20px] font-semibold tracking-tight mb-1">Không mở được link</h1>
          <p className="text-[13px] text-[#6e6e73]">{deadMsg || FAIL_TEXT.not_found}</p>
          <p className="text-[12px] text-[#a1a1a6] mt-3">Liên hệ người gửi để lấy link mới.</p>
        </div>
      </Shell>
    );
  }

  // ────────────── Màn hình phương án ──────────────
  if (!plan || !data || !result) return null;
  const meta = [plan.company_name, plan.industry, plan.zone_name].filter(Boolean).join('  ·  ');

  return (
    <Shell>
      <div className="max-w-[1180px] mx-auto px-3 sm:px-6 py-5 space-y-4">
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{plan.title}</h1>
              {meta && <div className="text-[13px] text-[#6e6e73] mt-0.5">{meta}</div>}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px] font-semibold">
                <span className={`px-2 py-0.5 rounded-full ${canEdit ? 'bg-[#eef5ff] text-[#0071e3]' : 'bg-[#f0f0f2] text-[#6e6e73]'}`}>{canEdit ? 'Được chỉnh sửa' : 'Chỉ xem'}</span>
                {plan.status === 'final' && <span className="px-2 py-0.5 rounded-full bg-[#e8f8ed] text-[#1d8a3b]">Đã chốt</span>}
                <span className="font-normal text-[#86868b]">v{plan.version} · {plan.updated_by_name ?? '—'} · {new Date(plan.updated_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <div className="relative basis-full sm:basis-auto">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1a6]" />
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Tên bạn" className={`${field} w-full sm:w-36 pl-8`} />
                </div>
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú lần lưu…" className={`${field} flex-1 min-w-0 sm:flex-none sm:w-48`} />
                <button onClick={() => save(false)} disabled={saving || !dirty} className={`${btnPrimary} !h-9 !px-5`}>
                  {saving && <Loader2 size={13} className="animate-spin" />}{savedFlash ? 'Đã lưu ✓' : 'Lưu'}
                </button>
              </div>
            )}
          </div>
          {dirty && canEdit && <div className="mt-3 text-[12px] font-medium text-[#b25e00]">Có thay đổi chưa lưu — bấm Lưu để mọi người thấy.</div>}
          {saveErr && <div className="mt-3 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{saveErr}</div>}
        </div>

        {remote && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#4a2fbd] bg-[#f1edff] rounded-xl px-4 py-2.5">
            <RefreshCw size={14} />
            <span><b>{remote.by ?? 'Có người'}</b> vừa cập nhật phương án (v{remote.version}).</span>
            <button onClick={reloadLatest} className="ml-auto h-7 px-3 rounded-full bg-[#5e5ce6] text-white text-[12px] font-medium hover:bg-[#6e6cf0]">Tải bản mới</button>
          </div>
        )}

        <PlanEditor data={data} result={result} readOnly={!canEdit} industry={plan.industry} onChange={setData} minWage={data.minWage} fileName={plan.title} fillMeta={{ company: plan.company_name, industry: plan.industry, zone: plan.zone_name }} planId={plan.id} docDefaults={{ name: plan.company_name ?? '' }} initialStep="quote" />

        <div className="text-[11.5px] text-[#a1a1a6] text-center pb-6">Link riêng tư — chỉ chia sẻ cho người cùng làm dự án. Mọi chỉnh sửa đều được ghi lại kèm tên người sửa.</div>
      </div>

      {conflict && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" style={{ fontFamily: FONT }}>
          <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4">
            <div>
              <div className="text-[17px] font-semibold tracking-tight">Có người vừa lưu bản mới hơn</div>
              <p className="text-[13px] text-[#6e6e73] leading-relaxed mt-1.5"><b className="text-[#1d1d1f]">{conflict.updated_by_name ?? 'Một người'}</b> đã lưu v{conflict.version} sau khi bạn mở. Lưu tiếp sẽ ghi đè thay đổi của họ (người sở hữu vẫn xem lại được trong Lịch sử).</p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => save(true)} className={`${btnPrimary} !h-10`}>Ghi đè bằng bản của tôi</button>
              <button onClick={() => apply(conflict, canEdit)} className={`${btnGhost} !h-10`}>Tải bản của họ</button>
              <button onClick={() => setConflict(null)} className="h-9 text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Quay lại sửa</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
