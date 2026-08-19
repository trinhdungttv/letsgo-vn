import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Edit2 } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   PanelKit — bộ khối dựng trang chi tiết (Khách hàng, Hồ sơ chăm sóc…).
   Mục tiêu: mọi trang chi tiết đều cùng một ngôn ngữ bố cục — dải chỉ số ở
   đầu, thanh "Đi tới" dính trên, rồi các khối gập/mở xếp 2 cột.
   ───────────────────────────────────────────────────────────────────────── */

/** Ô chỉ số ở dải tóm tắt đầu trang — bấm vào là nhảy tới khối liên quan. */
export function KpiTile({ label, value, sub, valueColor, tone = 'muted', right, onClick }: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  tone?: 'good' | 'bad' | 'warn' | 'muted';
  right?: ReactNode;
  onClick?: () => void;
}) {
  const subColor = tone === 'good' ? '#059669' : tone === 'bad' ? '#DC2626' : tone === 'warn' ? '#D97706' : '#9CA3AF';
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-[#E8E7E2] rounded-[10px] px-3.5 py-2.5 flex items-center justify-between gap-2 hover:border-[#C9C7BE] hover:shadow-sm transition"
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold truncate">{label}</div>
        <div className="text-[18px] font-bold leading-tight mt-0.5 truncate" style={{ color: valueColor || '#111' }}>{value}</div>
        {sub && <div className="text-[11px] mt-0.5 truncate" style={{ color: subColor }}>{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </button>
  );
}

/** Thẻ khối có tiêu đề gập/mở + chỗ gắn nút hành động riêng của khối. */
export function SectionCard({ id, icon, title, badge, open, onToggle, actions, children }: {
  id: string;
  icon: string;
  title: string;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden scroll-mt-14">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#E8E7E2]">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left group">
          {open
            ? <ChevronUp size={13} className="text-[#aaa] shrink-0" />
            : <ChevronDown size={13} className="text-[#aaa] shrink-0" />}
          <span className="text-[12.5px] font-semibold text-[#111] group-hover:text-[#1D4ED8] transition truncate">{icon} {title}</span>
          {badge != null && <span className="text-[11px] text-blue-700 font-medium shrink-0">{badge}</span>}
        </button>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

/** Một dòng nhãn — giá trị trong các khối thông tin. */
export function InfoRow({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-1.5 border-b border-dashed border-[#EFEDE8] ${full ? 'xl:col-span-2' : ''}`}>
      <div className="w-[104px] shrink-0 text-[11.5px] text-[#888] pt-[3px]">{label}</div>
      <div className="flex-1 min-w-0 text-[12.5px] text-[#111]">{children}</div>
    </div>
  );
}

/** Nút bút chì nhỏ dùng cho các khối sửa nhanh tại chỗ. */
export function PencilButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className="p-1 rounded-lg border border-gray-200 text-[#999] hover:text-[#555] hover:border-gray-400 transition shrink-0">
      <Edit2 size={11} />
    </button>
  );
}

/** Thanh "Đi tới" dính trên đầu khi cuộn — nhảy nhanh giữa các khối. */
export function QuickNav<K extends string>({ items, onGo }: {
  items: { key: K; label: string; icon: string }[];
  onGo: (k: K) => void;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-5 px-5 py-2 bg-[#F5F4EF]/95 backdrop-blur border-b border-[#E8E7E2]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-[#aaa] font-semibold mr-0.5">Đi tới</span>
        {items.map(n => (
          <button
            key={n.key}
            onClick={() => onGo(n.key)}
            className="px-2.5 py-1 rounded-full text-[11.5px] font-medium border border-[#E2E0D9] bg-white text-[#555] hover:border-[#1D4ED8] hover:text-[#1D4ED8] transition"
          >
            {n.icon} {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Quản lý trạng thái gập/mở của các khối trên một trang.
 * Nhớ lại theo trình duyệt (localStorage) để mỗi người giữ bố cục quen thuộc.
 *
 * @param defaults  Khối nào mở sẵn lần đầu.
 * @param storageKey  Khoá localStorage riêng cho từng trang.
 * @param idPrefix  Tiền tố id DOM của các SectionCard (vd 'cd' → id="cd-labor").
 */
export function useSectionState<K extends string>(
  defaults: Record<K, boolean>,
  storageKey: string,
  idPrefix: string,
) {
  const [sections, setSections] = useState<Record<K, boolean>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch { return defaults; }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(sections)); } catch { /* bỏ qua */ }
  }, [sections, storageKey]);

  const toggle = (k: K) => setSections(s => ({ ...s, [k]: !s[k] }));

  /** Mở khối rồi cuộn tới — dùng cho thanh điều hướng nhanh và các ô chỉ số. */
  const goto = (k: K) => {
    setSections(s => (s[k] ? s : { ...s, [k]: true }));
    setTimeout(() => document.getElementById(`${idPrefix}-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  return { sections, setSections, toggle, goto };
}
