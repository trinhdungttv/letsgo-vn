// Xem 1 ảnh chỉ tiêu (dùng ở Lịch sử khảo sát và tab Khảo sát KCN): ảnh + lớp ghi chú vẽ, chỗ chụp, vẽ thêm ghi chú,
// xoá mềm — và NHẬP NHANH ngay bên dưới ảnh (không phải bấm "Sửa"): tên công ty, ngành nghề (ô xổ xuống, sửa được
// danh mục), nhu cầu Cung ứng / Giới thiệu · Thời vụ / Chính thức, số lượng, lương, ghi chú.
// Vuốt ảnh trái / phải (hoặc ‹ › / phím ← →) = tự lưu ảnh đang xem rồi sang ảnh khác, ô nhập vẫn mở.
// Chạm vào ảnh = ẩn / hiện ô nhập để xem ảnh to hết màn.
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Loader2, MapPin, MoreHorizontal, PenLine, Star, Trash2, X } from 'lucide-react';
import { NeedsColumnMissing, needsColumnMissing, softDeletePhoto, updatePhoto, type SurveyPhoto } from '../../../lib/kcnSurvey/api';
import type { PhotoMark } from '../../../lib/kcnSurvey/markup';
import { MarkedImage, MarksSvg } from './PhotoMarks';
import PhotoMarkupEditor from './PhotoMarkupEditor';
import { HEADCOUNT_BUCKETS, UNVERIFIED_TAG } from '../../../lib/kcnSurvey/online';
import { normalizePositions, replacePosition } from '../../../lib/kcnSurvey/positions';
import { sameNeeds, sanitizeNeeds, type LaborNeed } from '../../../lib/kcnSurvey/needs';
import { fmtDateTime } from './surveyFormat';
import { NeedsPicker, WAGE_PRESETS } from './PositionPicker';
import PositionSelect from './PositionSelect';
import PositionCatalogEditor from './PositionCatalogEditor';

const POS_SOURCE: Record<SurveyPhoto['position_source'], string> = { gps: 'GPS lúc chụp', exif: 'Vị trí lưu trong ảnh', manual: 'Chọn trên bản đồ', track: 'Theo giờ chụp trên đường đã đi' };
const posText = (p: SurveyPhoto) => (p.survey_kind === 'online' ? 'Vị trí từ link Google Maps (khảo sát online)' : POS_SOURCE[p.position_source]);

/** Ô ảnh nhỏ trong lưới (cắt vuông) + lớp ghi chú cắt cùng kiểu. */
export function PhotoThumb({ photo, className = '' }: { photo: SurveyPhoto; className?: string }) {
  const aspect = photo.width && photo.height ? photo.height / photo.width : null;
  return (
    <>
      <img src={photo.thumb_url || photo.url} alt={photo.company_name} loading="lazy" className={`absolute inset-0 w-full h-full object-cover ${className}`} />
      {aspect && photo.annotations.length > 0 && (
        <MarksSvg marks={photo.annotations} aspect={aspect} fit="cover" className="absolute inset-0 w-full h-full pointer-events-none" />
      )}
      {photo.survey_kind === 'online' && (
        <span className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none shadow ${photo.verified_at ? 'bg-[#34C759] text-white' : 'bg-[#FF9F0A] text-white'}`}>
          {photo.verified_at ? 'Online ✓' : UNVERIFIED_TAG}
        </span>
      )}
      {photo.annotations.length > 0 && (
        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center" title="Có ghi chú trên ảnh"><PenLine size={11} /></span>
      )}
    </>
  );
}

interface Form { company_name: string; positions: string; headcount: string; wage_text: string; note: string; labor_needs: LaborNeed[] }
type Patch = Partial<Pick<SurveyPhoto, 'company_name' | 'positions' | 'headcount' | 'wage_text' | 'note' | 'labor_needs'>>;

const formOf = (p: SurveyPhoto): Form => ({
  company_name: p.company_name, positions: p.positions, headcount: p.headcount?.toString() ?? '', wage_text: p.wage_text, note: p.note, labor_needs: p.labor_needs,
});

/** Chỉ những ô thực sự đổi (so sau khi bỏ khoảng trắng thừa) — không đổi gì thì không ghi DB */
function patchOf(f: Form, p: SurveyPhoto): Patch {
  const out: Patch = {};
  const company_name = f.company_name.trim();
  if (company_name !== p.company_name.trim()) out.company_name = company_name;
  const positions = normalizePositions(f.positions);
  if (positions !== normalizePositions(p.positions)) out.positions = positions;
  const headcount = f.headcount.trim() ? Math.max(0, parseInt(f.headcount, 10) || 0) : null;
  if (headcount !== p.headcount) out.headcount = headcount;
  const wage_text = f.wage_text.trim();
  if (wage_text !== p.wage_text.trim()) out.wage_text = wage_text;
  const note = f.note.trim();
  if (note !== p.note.trim()) out.note = note;
  if (!needsColumnMissing() && !sameNeeds(f.labor_needs, p.labor_needs)) out.labor_needs = sanitizeNeeds(f.labor_needs);
  return out;
}

const WAGE_CUSTOM = '__custom__';

export default function SurveyPhotoViewer({ photo, onClose, onShowOnMap, onSaved, onDeleted, onPhotosPatched, say, starred, onStar, nav }: {
  /** Chuyển ảnh trước / sau trong danh sách đang xem (vuốt, ‹ ›, phím ← →) — tự lưu ảnh đang xem trước khi chuyển */
  nav?: { index: number; total: number; onPrev: (() => void) | null; onNext: (() => void) | null };
  photo: SurveyPhoto;
  onClose: () => void;
  /** null = không có nút "Xem chỗ chụp" (đã có bản đồ ngay cạnh) */
  onShowOnMap: (() => void) | null;
  onSaved: (p: SurveyPhoto) => void;
  onDeleted: (id: string) => void;
  /** Sửa danh mục ngành nghề vừa đổi chữ ngành trên nhiều ảnh — để danh sách cập nhật ngay */
  onPhotosPatched?: (changes: { id: string; positions: string }[]) => void;
  say: (m: string) => void;
  /** Công ty của ảnh đã gắn sao (cần chú trọng) — không truyền onStar thì không có nút sao */
  starred?: boolean;
  onStar?: (p: SurveyPhoto) => void;
}) {
  const [marking, setMarking] = useState(false);
  const [form, setForm] = useState<Form>(() => formOf(photo));
  const [wageTyping, setWageTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [posOpen, setPosOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const savingRef = useRef(false);

  // Sang ảnh khác → nạp ô nhập theo ảnh mới (ô nhập vẫn mở). Cùng ảnh mà dữ liệu đổi (vừa lưu) thì giữ nguyên.
  useEffect(() => {
    setForm(formOf(photo));
    setWageTyping(false);
    setMenuOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);
  // "Đã lưu ✓" hiện 1,5 giây
  useEffect(() => {
    if (!savedTick) return;
    const t = setTimeout(() => setSavedTick(0), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  const patch = patchOf(form, photo);
  const dirty = Object.keys(patch).length > 0;
  const needsOff = needsColumnMissing();

  /** Lưu ảnh đang xem nếu có đổi. false = lỗi (đứng lại ảnh này). */
  const save = async (): Promise<boolean> => {
    const p = photo;
    const ch = patchOf(form, p);
    if (!Object.keys(ch).length) return true;
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      await updatePhoto(p.id, ch);
      onSaved({ ...p, ...ch });
      setSavedTick(Date.now());
      return true;
    } catch (e) {
      if (e instanceof NeedsColumnMissing) {
        const rest: Patch = { ...ch };
        delete rest.labor_needs;
        onSaved({ ...p, ...rest });
        say(e.message);
        return true;
      }
      say((e as Error).message);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const go = async (dir: -1 | 1) => {
    const fn = dir < 0 ? nav?.onPrev : nav?.onNext;
    if (!fn || savingRef.current) return;
    if (await save()) fn();
  };
  /** Rời ảnh (đóng / xem chỗ chụp): lưu trước; lưu lỗi thì hỏi có bỏ thay đổi không */
  const leave = async (fn: () => void) => {
    if (await save()) { fn(); return; }
    if (window.confirm('Chưa lưu được thay đổi của ảnh này (mất mạng?).\n\nVẫn đóng và BỎ các thay đổi chưa lưu?')) fn();
  };

  // Phím tắt: Esc đóng lớp trên cùng · ← → chuyển ảnh (tự lưu) khi không đang gõ / vẽ / mở bảng chọn
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = e => {
    if (marking) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (catalogOpen) setCatalogOpen(false);
      else if (posOpen) setPosOpen(false);
      else if (menuOpen) setMenuOpen(false);
      else if (typing) (e.target as HTMLElement).blur();
      else void leave(onClose);
      return;
    }
    if (typing || catalogOpen || posOpen) return;
    if (e.key === 'ArrowLeft' && nav?.onPrev) { e.preventDefault(); void go(-1); }
    else if (e.key === 'ArrowRight' && nav?.onNext) { e.preventDefault(); void go(1); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Vuốt ngang trên ảnh = chuyển ảnh (1 ngón, ngang rõ ràng hơn dọc)
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) void go(dx < 0 ? 1 : -1);
  };

  const saveMarks = async (marks: PhotoMark[]) => {
    setMarking(false);
    try {
      await updatePhoto(photo.id, { annotations: marks });
      onSaved({ ...photo, annotations: marks });
      say(marks.length ? 'Đã lưu ghi chú trên ảnh' : 'Đã xoá ghi chú trên ảnh');
    } catch (e) { say((e as Error).message); }
  };
  const toggleVerified = async () => {
    const verified_at = photo.verified_at ? null : new Date().toISOString();
    try {
      await updatePhoto(photo.id, { verified_at });
      onSaved({ ...photo, verified_at });
      say(verified_at ? 'Đã đánh dấu đã xác thực' : `Đã đặt lại “${UNVERIFIED_TAG}”`);
    } catch (e) { say((e as Error).message); }
  };
  const del = async () => {
    setMenuOpen(false);
    if (!window.confirm('Xoá ảnh chỉ tiêu này?\n\nẢnh chuyển vào Lưu trữ (tab Khảo sát KCN → Lưu trữ) 30 ngày — khôi phục được trong thời gian đó, quá 30 ngày mới tự xoá hẳn.')) return;
    try { await softDeletePhoto(photo.id); onDeleted(photo.id); say('Đã chuyển ảnh vào Lưu trữ (30 ngày)'); } catch (e) { say((e as Error).message); }
  };

  /** Danh mục ngành vừa đổi chữ ngành trên nhiều ảnh: cập nhật danh sách + ô đang nhập của ảnh này */
  const patched = (changes: { id: string; positions: string }[], rename: { from: string; to: string | null } | null) => {
    const mine = changes.find(c => c.id === photo.id) ?? null;
    if (onPhotosPatched) onPhotosPatched(changes);
    else if (mine) onSaved({ ...photo, positions: mine.positions });
    setForm(f => {
      const positionsDirty = normalizePositions(f.positions) !== normalizePositions(photo.positions);
      if (!positionsDirty && mine) return { ...f, positions: mine.positions };
      if (positionsDirty && rename) return { ...f, positions: replacePosition(f.positions, rename.from, rename.to) };
      return f;
    });
  };

  const gmaps = `https://www.google.com/maps?q=${photo.lat},${photo.lng}`;
  const field = 'w-full h-10 px-3 rounded-xl bg-white/10 text-[14px] text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-[#0A84FF]/60';
  const iconBtn = 'w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:bg-white/15 relative';
  const canStar = !!onStar && !!(photo.company_name.trim() || photo.client_id || photo.crm_id || photo.lead_id);
  const enterSave = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); void save(); } };
  const wagePreset = WAGE_PRESETS.includes(form.wage_text.trim());

  return (
    <div className="fixed inset-0 z-[1350] bg-black flex flex-col pt-[env(safe-area-inset-top)]">
      {/* Thanh trên: Đóng · trạng thái lưu · chỗ chụp / ghi chú lên ảnh / sao / thêm */}
      <div className="flex items-center h-12 px-1 shrink-0 text-white">
        <button onClick={() => void leave(onClose)} className="h-10 px-3 text-[16px] inline-flex items-center gap-1"><X size={18} /> Đóng</button>
        <div className="flex-1 min-w-0 text-center text-[12px] text-white/60 truncate">
          {saving ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang lưu…</span>
            : savedTick ? <span className="inline-flex items-center gap-1 text-[#7BE495]"><Check size={13} /> Đã lưu</span>
            : dirty ? <span className="text-[#FFC266]">Chưa lưu</span> : null}
        </div>
        {onShowOnMap && <button onClick={() => void leave(onShowOnMap)} className={iconBtn} title="Xem chỗ chụp trên bản đồ" aria-label="Xem chỗ chụp"><MapPin size={19} /></button>}
        <button onClick={() => setMarking(true)} className={iconBtn} title={photo.annotations.length ? 'Sửa ghi chú trên ảnh' : 'Ghi chú lên ảnh'} aria-label="Ghi chú lên ảnh">
          <PenLine size={19} />
          {photo.annotations.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#0A84FF]" />}
        </button>
        {canStar && (
          <button onClick={() => onStar!(photo)} className={iconBtn} title={starred ? 'Bỏ sao công ty' : 'Gắn sao công ty (cần chú trọng)'} aria-label={starred ? 'Bỏ sao' : 'Gắn sao công ty'}>
            <Star size={19} className={starred ? 'text-[#FFD60A]' : ''} fill={starred ? '#FFD60A' : 'none'} />
          </button>
        )}
        <div className="relative">
          <button onClick={() => setMenuOpen(v => !v)} className={iconBtn} aria-label="Thêm"><MoreHorizontal size={20} /></button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[1] " onClick={() => setMenuOpen(false)} />
              <div className="absolute right-1 top-11 z-[2] w-[260px] rounded-2xl bg-[#2C2C2E] shadow-2xl overflow-hidden text-[14px]">
                <div className="px-4 py-2.5 text-[11.5px] text-white/55 border-b border-white/10 leading-snug">
                  📍 {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)} · {posText(photo)}{photo.accuracy_m != null ? ` ±${Math.round(photo.accuracy_m)} m` : ''}
                </div>
                <a href={gmaps} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-3 hover:bg-white/10"><ExternalLink size={16} /> Mở Google Maps</a>
                <a href={photo.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-3 hover:bg-white/10"><ExternalLink size={16} /> Ảnh gốc</a>
                {photo.survey_kind === 'online' && (
                  <button onClick={() => { setMenuOpen(false); void toggleVerified(); }} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/10 text-left">
                    <BadgeCheck size={16} /> {photo.verified_at ? 'Bỏ xác thực' : 'Đánh dấu đã xác thực'}
                  </button>
                )}
                <button onClick={() => void del()} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/10 text-left text-[#FF6961] border-t border-white/10"><Trash2 size={16} /> Xoá ảnh</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Ảnh: vuốt ngang = sang ảnh khác · chạm = ẩn / hiện ô nhập */}
        <div className="relative flex-1 min-h-0 w-full flex select-none" onClick={() => setPanelHidden(h => !h)} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <MarkedImage src={photo.url} alt={photo.company_name} marks={photo.annotations} className="flex-1 min-h-0 w-full" />
          {nav?.onPrev && <button onClick={e => { e.stopPropagation(); void go(-1); }} aria-label="Ảnh trước (←)" className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"><ChevronLeft size={24} /></button>}
          {nav?.onNext && <button onClick={e => { e.stopPropagation(); void go(1); }} aria-label="Ảnh sau (→)" className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"><ChevronRight size={24} /></button>}
          {nav && nav.total > 1 && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-black/55 text-white text-[12px] tabular-nums pointer-events-none">{nav.index + 1} / {nav.total}</div>}
        </div>

        {panelHidden ? (
          <button onClick={() => setPanelHidden(false)}
            className="shrink-0 bg-[#1C1C1E] text-white px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] flex items-center gap-2 text-left md:absolute md:right-3 md:bottom-3 md:max-w-[340px] md:rounded-full md:py-2 md:shadow-lg">
            <span className="flex-1 min-w-0 text-[14px] font-semibold truncate">{form.company_name.trim() || 'Chưa rõ công ty'}</span>
            <span className="text-[12.5px] text-[#64A8FF] inline-flex items-center gap-1 shrink-0"><ChevronUp size={15} /> Hiện ô nhập</span>
          </button>
        ) : (
          <div className="shrink-0 md:w-[380px] md:border-l md:border-white/10 bg-[#1C1C1E] text-white flex flex-col max-h-[58vh] md:max-h-none">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-2.5 pb-2 space-y-2">
              <div className="flex items-center gap-1.5 text-[11.5px] text-white/60 min-w-0">
                <span className="truncate">{fmtDateTime(photo.taken_at)}{photo.zone_name ? ` · ${photo.zone_name}` : ''}{photo.user_name ? ` · ${photo.user_name}` : ''}</span>
                {photo.survey_kind === 'online' && (
                  <span className={`shrink-0 px-1.5 py-px rounded-full text-[10.5px] font-semibold ${photo.verified_at ? 'bg-[#34C759]/25 text-[#7BE495]' : 'bg-[#FF9F0A]/25 text-[#FFC266]'}`}>
                    {photo.verified_at ? 'Online ✓' : `Online · ${UNVERIFIED_TAG}`}
                  </span>
                )}
                <span className="flex-1" />
                <button onClick={() => setPanelHidden(true)} className="shrink-0 w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-white/50 hover:bg-white/10" aria-label="Thu gọn ô nhập" title="Thu gọn (hoặc chạm vào ảnh)"><ChevronDown size={17} /></button>
              </div>
              <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} onKeyDown={enterSave}
                placeholder="Tên công ty treo bảng" className={`${field} text-[15px] font-semibold`} />
              <PositionSelect value={form.positions} onChange={v => setForm(f => ({ ...f, positions: v }))} open={posOpen} onOpenChange={setPosOpen}
                onEditCatalog={() => setCatalogOpen(true)} say={say} />
              {needsOff
                ? <div className="text-[11px] text-[#FFC266]/80">Chạy migration 225 để ghi nhu cầu Cung ứng / Giới thiệu · Thời vụ / Chính thức</div>
                : <NeedsPicker dark value={form.labor_needs} onChange={v => setForm(f => ({ ...f, labor_needs: v }))} />}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2">
                {photo.survey_kind === 'online'
                  ? <select value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value }))} className={field} aria-label="Số lượng">
                      <option value="">Số lượng — ?</option>
                      {HEADCOUNT_BUCKETS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                  : <input value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value.replace(/[^\d]/g, '') }))} onKeyDown={enterSave}
                      inputMode="numeric" placeholder="Số lượng" className={field} />}
                {wageTyping ? (
                  <div className="relative">
                    <input autoFocus value={form.wage_text} onChange={e => setForm(f => ({ ...f, wage_text: e.target.value }))} onKeyDown={enterSave}
                      placeholder="Lương — VD: 9–11tr + ăn ca" className={`${field} pr-9`} />
                    <button onClick={() => setWageTyping(false)} className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/50" aria-label="Chọn khoảng lương có sẵn"><ChevronDown size={16} /></button>
                  </div>
                ) : (
                  <select value={wagePreset ? form.wage_text.trim() : form.wage_text.trim() ? '__current__' : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === WAGE_CUSTOM) { setWageTyping(true); return; }
                      if (v !== '__current__') setForm(f => ({ ...f, wage_text: v }));
                    }}
                    className={field} aria-label="Khoảng lương lao động nhận được">
                    <option value="">Lương — chưa rõ</option>
                    {WAGE_PRESETS.map(w => <option key={w} value={w}>{w}</option>)}
                    {!wagePreset && form.wage_text.trim() && <option value="__current__">{form.wage_text.trim()}</option>}
                    <option value={WAGE_CUSTOM}>✎ Gõ khác…</option>
                  </select>
                )}
              </div>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} onKeyDown={enterSave}
                placeholder="Ghi chú — VD: tuyển gấp, có xe đưa đón" className={field} />
            </div>
            <div className="shrink-0 flex items-center gap-2 px-4 pt-1.5 pb-[calc(8px+env(safe-area-inset-bottom))]">
              <span className="flex-1 min-w-0 text-[11px] text-white/45 leading-tight">
                {nav && nav.total > 1 ? 'Vuốt ảnh ← → để sang ảnh khác — tự lưu' : 'Đóng hoặc bấm Lưu — tự lưu khi rời ảnh'}
              </span>
              {dirty && <button onClick={() => { setForm(formOf(photo)); setWageTyping(false); }} className="h-9 px-3 rounded-full bg-white/10 text-[13px]">Hoàn tác</button>}
              <button onClick={() => void save()} disabled={!dirty || saving} className="h-9 px-4 rounded-full bg-[#0A84FF] text-[13.5px] font-semibold disabled:opacity-35">Lưu</button>
            </div>
          </div>
        )}
      </div>

      {marking && <PhotoMarkupEditor src={photo.url} initial={photo.annotations} onCancel={() => setMarking(false)} onDone={m => void saveMarks(m)} />}
      {catalogOpen && <PositionCatalogEditor onClose={() => setCatalogOpen(false)} say={say} onPhotosPatched={patched} />}
    </div>
  );
}
