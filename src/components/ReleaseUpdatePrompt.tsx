// ============================================================================
// ReleaseUpdatePrompt — popup "Có phiên bản mới" kèm tên chức năng mới (mọi trang, kể cả màn đăng nhập).
// ----------------------------------------------------------------------------
// • Phát hiện: tải /version.json (do vite.config.ts ghi lúc build) khi mở app, mỗi vài phút, khi quay lại tab / có mạng lại,
//   và ngay khi gặp lỗi tải phần cũ (lib/appVersion). Mã build khác mã của bundle đang chạy → hiện popup.
// • Tên chức năng lấy từ version.json của SERVER (không phải bundle cũ đang mở) nên bản cũ vẫn thấy chức năng của bản mới.
// • KHÔNG tự tải lại trang (người dùng có thể đang nhập dở): bấm "Cập nhật ngay" mới tải lại; "Để sau" ẩn tới khi có bản mới hơn
//   (hoặc sau vài giờ). Lần mở bản mới đầu tiên → thẻ nhỏ "Đã cập nhật" liệt kê chức năng vừa có.
// • Thẻ nổi không chặn thao tác; đang có hộp thoại modal (vd nhắc sinh nhật UpcomingDatesReminder) thì chờ hộp đóng rồi mới hiện.
// • Chạy dev (vite dev) thì tắt; mọi lỗi mạng / localStorage đều im lặng.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { BTN_ICON, BTN_PRIMARY, BTN_SECONDARY, ICON_TILE } from './workspace/wsTheme';
import { RELEASE_PROMPT_ID, STALE_BUILD_EVENT, hideUpdateBanner } from '../lib/appVersion';
import {
  RUNNING_BUILD_ID, RUNNING_RELEASE_ID, applyUpdate, fetchVersionInfo, readDismissed, readLastSeenRelease, writeDismissed, writeLastSeenRelease,
} from '../lib/releaseCheck';
import {
  collectFeatures, formatBuiltAt, formatReleaseDate, notesNewerThan, olderBaseline, planBootNotice, shouldPrompt,
  type ReleaseNote, type VersionInfo,
} from '../lib/releaseUpdate';

const CHECK_EVERY_MS = 3 * 60 * 1000;
/** Quay lại tab / focus liên tục cũng chỉ kiểm tra tối đa chừng này một lần */
const MIN_GAP_MS = 20 * 1000;
const UPDATED_TOAST_MS = 12 * 1000;
const MAX_SHOWN = 8;

type Prompt =
  | { kind: 'available'; info: VersionInfo; notes: ReleaseNote[] }
  | { kind: 'updated'; notes: ReleaseNote[] };

export default function ReleaseUpdatePrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [blocked, setBlocked] = useState(false);
  const lastCheck = useRef(0);
  const bootDone = useRef(false);

  const check = useCallback(async (urgent = false) => {
    if (import.meta.env.DEV) return;
    // Link chia sẻ Phương án giá (#/p/…) mở cho người ngoài — không phải người dùng app
    if (/^#\/p\//.test(window.location.hash)) return;
    const now = Date.now();
    if (now - lastCheck.current < (urgent ? 5000 : MIN_GAP_MS)) return;
    lastCheck.current = now;

    const info = await fetchVersionInfo();
    if (!info) return;

    if (info.buildId === RUNNING_BUILD_ID) {
      // Đang chạy đúng bản mới nhất. Lần đầu sau khi mở: ghi nhận mốc đã xem + báo chức năng vừa có (người mới chỉ ghi nhận).
      setPrompt(p => (p?.kind === 'available' ? null : p));
      if (!bootDone.current) {
        bootDone.current = true;
        const plan = planBootNotice(info, readLastSeenRelease());
        if (plan.writeLastSeen) writeLastSeenRelease(plan.writeLastSeen);
        if (plan.shown.length) setPrompt({ kind: 'updated', notes: plan.shown });
      }
      return;
    }

    if (!shouldPrompt({ running: RUNNING_BUILD_ID, remote: info.buildId, dismissed: readDismissed(), now, force: urgent })) return;
    // Mốc cũ hơn của (bản đã xem lần trước, bản đang chạy) — tab khác đã cập nhật rồi thì tab này vẫn thấy đủ chức năng
    const baseline = olderBaseline(info.notes, readLastSeenRelease(), RUNNING_RELEASE_ID);
    setPrompt({ kind: 'available', info, notes: notesNewerThan(info.notes, baseline) });
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const first = setTimeout(() => void check(), 2500);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const onFocus = () => void check();
    const onStale = () => void check(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener(STALE_BUILD_EVENT, onStale);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener(STALE_BUILD_EVENT, onStale);
    };
  }, [check]);

  // Có hộp thoại modal đang mở (vd nhắc sinh nhật) → chờ, không chồng lên
  const pending = prompt !== null;
  useEffect(() => {
    if (!pending) { setBlocked(false); return; }
    const probe = () => setBlocked(!!document.querySelector('[aria-modal="true"]'));
    probe();
    const t = setInterval(probe, 1000);
    return () => clearInterval(t);
  }, [pending]);

  // Thẻ "Đã cập nhật" tự tắt
  const updatedShown = prompt?.kind === 'updated' && !blocked;
  useEffect(() => {
    if (!updatedShown) return;
    const t = setTimeout(() => setPrompt(p => (p?.kind === 'updated' ? null : p)), UPDATED_TOAST_MS);
    return () => clearTimeout(t);
  }, [updatedShown]);

  // Popup đã hiện thì thanh báo lỗi-trang-cũ (appVersion) là thừa
  useEffect(() => { if (prompt && !blocked) hideUpdateBanner(); }, [prompt, blocked]);

  if (!prompt || blocked) return null;
  return (
    <PromptCard
      prompt={prompt}
      onLater={() => {
        if (prompt.kind === 'available') writeDismissed({ buildId: prompt.info.buildId, at: Date.now() });
        setPrompt(null);
      }}
    />
  );
}

function PromptCard({ prompt, onLater }: { prompt: Prompt; onLater: () => void }) {
  const [entered, setEntered] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const available = prompt.kind === 'available';
  const { shown, more } = collectFeatures(prompt.notes, MAX_SHOWN);
  const meta = prompt.kind === 'available'
    ? [
        formatBuiltAt(prompt.info.builtAt) || formatReleaseDate(prompt.info.notes[0]?.date),
        prompt.info.buildId.slice(0, 7) ? `mã ${prompt.info.buildId.slice(0, 7)}` : '',
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <div
      id={RELEASE_PROMPT_ID}
      role="dialog"
      aria-labelledby="release-prompt-title"
      className={`fixed z-[80] left-3 right-3 top-[calc(env(safe-area-inset-top)+10px)] md:left-auto md:right-5 md:top-5 md:w-[380px] bg-white rounded-[20px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_40px_-8px_rgba(0,0,0,0.28)] transition duration-300 motion-reduce:transition-none ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 shrink-0 rounded-[11px] flex items-center justify-center text-white ${available ? ICON_TILE.blue : ICON_TILE.green}`}>
            <Sparkles size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="release-prompt-title" className="text-[16px] font-bold tracking-[-0.02em] text-[#1D1D1F] leading-tight">
              {available ? 'Có phiên bản mới' : 'Đã cập nhật phiên bản mới'}
            </h2>
            {meta && <p className="text-[12px] text-[#86868B] mt-0.5">{meta}</p>}
          </div>
          {!available && (
            <button type="button" onClick={onLater} aria-label="Đóng" className={BTN_ICON}><X size={15} /></button>
          )}
        </div>

        <div className="mt-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B] mb-1.5">Chức năng mới</div>
          {shown.length > 0 ? (
            <>
              <ul className="space-y-1.5 max-h-[36vh] md:max-h-60 overflow-y-auto pr-1">
                {shown.map(f => (
                  <li key={f} className="flex gap-2.5 text-[13.5px] leading-snug text-[#1D1D1F]">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#0071E3] shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>
              {more > 0 && <div className="mt-1.5 text-[12px] text-[#86868B]">và {more} chức năng khác</div>}
            </>
          ) : (
            <p className="text-[13px] text-[#6E6E73]">Cải tiến và sửa lỗi nhỏ.</p>
          )}
        </div>

        {available ? (
          <>
            <p className="mt-3.5 text-[11.5px] leading-snug text-[#86868B] text-balance">
              Cập nhật sẽ tải lại trang. Đang nhập dở thì lưu trước rồi hãy bấm.
            </p>
            <div className="mt-3 flex gap-2 md:justify-end">
              <button type="button" onClick={onLater} disabled={busy} className={`${BTN_SECONDARY} flex-1 md:flex-none h-10 md:h-9 px-4 text-[13px]`}>
                Để sau
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setBusy(true); void applyUpdate(); }}
                className={`${BTN_PRIMARY} flex-1 md:flex-none h-10 md:h-9 px-5 text-[13px] font-semibold`}
              >
                {busy ? 'Đang cập nhật…' : 'Cập nhật ngay'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
