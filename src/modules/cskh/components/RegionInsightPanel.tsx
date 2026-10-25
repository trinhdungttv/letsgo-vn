// "Tìm hiểu vùng miền" (port PRM RegionInsightPanel): AI tổng hợp nét đặc sắc, đặc thù, văn hoá,
// con người, ẩm thực, địa danh, người nổi tiếng của quê / nơi ở người liên hệ — để gợi chuyện,
// chọn quà. Kết quả nhớ trong máy theo người dùng + vùng (mỗi vùng 1 bản, dùng chung cho mọi
// người cùng quê); nút Làm mới. Mặc định thu gọn.
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Landmark, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { generateGeminiResponse } from '../../../lib/gemini';
import { normalizeSearch } from '../../../lib/cskh/search';
import {
  buildRegionRequest, parseRegionResponse, sanitizeInsight, type RegionCandidate, type RegionInsight,
} from '../../../lib/cskh/regionInsight';

interface Cached {
  insight: RegionInsight;
  at: string;
}

const storageKey = (userId: string, region: string) => `lgvn_cskh_region_v1:${userId}:${normalizeSearch(region)}`;

function readCached(key: string): Cached | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as { insight?: unknown; at?: unknown } | null;
    const insight = sanitizeInsight(raw?.insight);
    return insight ? { insight, at: typeof raw?.at === 'string' ? raw.at : '' } : null;
  } catch {
    return null;
  }
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="px-2.5 h-7 md:h-6 inline-flex items-center rounded-full bg-[rgba(118,118,128,0.12)] text-[12.5px] text-[#1D1D1F]">{children}</span>
);

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1">{label}</p>
      {children}
    </div>
  );
}

export function RegionInsightPanel({ candidates, userId }: { candidates: readonly RegionCandidate[]; userId: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Kết quả lần này khi máy không cho lưu (chế độ riêng tư…). */
  const [fresh, setFresh] = useState<(Cached & { key: string }) | null>(null);
  const cand = candidates[Math.min(pick, candidates.length - 1)];
  const key = storageKey(userId, cand?.region ?? '');
  const saved = useMemo(() => (cand ? readCached(key) : null), [cand, key]);
  if (!cand) return null;

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const insight = parseRegionResponse(await generateGeminiResponse(buildRegionRequest(cand.region, cand.context)));
      const at = new Date().toISOString();
      try {
        localStorage.setItem(key, JSON.stringify({ insight, at }));
      } catch {
        // bộ nhớ máy đầy / chế độ riêng tư — vẫn hiện kết quả lần này
      }
      setFresh({ key, insight, at });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tìm hiểu được lúc này');
    } finally {
      setLoading(false);
    }
  };

  const shown = fresh?.key === key ? fresh : saved;
  const ins = shown?.insight;
  return (
    <div className="md:col-span-2 rounded-[12px] bg-white md:bg-white/80 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 min-h-[44px] text-left">
        <Landmark size={15} className="shrink-0 text-[#0071E3]" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-[#1D1D1F]">Tìm hiểu vùng miền</span>
        {!open && <span className="truncate max-w-[55%] px-2.5 h-6 inline-flex items-center rounded-full bg-[rgba(118,118,128,0.12)] text-[12px] text-[#3A3A3C]">{cand.label}</span>}
        <ChevronDown size={15} className={`shrink-0 text-[#86868B] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {candidates.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chọn vùng">
              {candidates.map((c, i) => (
                <button key={c.region} type="button" aria-pressed={i === pick} onClick={() => { setPick(i); setError(''); }}
                  className={`px-3 h-8 md:h-7 rounded-full text-[12.5px] font-medium transition ${i === pick ? 'bg-[#0071E3] text-white' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#6E6E73]">
              <Loader2 size={13} className="animate-spin" /> Đang tổng hợp về {cand.region}… (khoảng 10–30 giây)
            </p>
          ) : ins ? (
            <>
              {ins.highlights && <p className="text-[13.5px] font-medium text-[#1D1D1F] leading-snug">{ins.highlights}</p>}
              {ins.traits && <Part label="Đặc thù"><p className="text-[13px] text-[#3A3A3C] leading-snug">{ins.traits}</p></Part>}
              {ins.culture && <Part label="Văn hoá"><p className="text-[13px] text-[#3A3A3C] leading-snug">{ins.culture}</p></Part>}
              {ins.people && <Part label="Con người"><p className="text-[13px] text-[#3A3A3C] leading-snug">{ins.people}</p></Part>}
              {ins.food.length > 0 && <Part label="Ẩm thực · đặc sản"><div className="flex flex-wrap gap-1.5">{ins.food.map(f => <Chip key={f}>{f}</Chip>)}</div></Part>}
              {ins.places.length > 0 && <Part label="Địa danh"><div className="flex flex-wrap gap-1.5">{ins.places.map(p => <Chip key={p}>{p}</Chip>)}</div></Part>}
              {ins.notablePeople.length > 0 && (
                <Part label="Lãnh đạo · người nổi tiếng quê ở đây">
                  <ul className="space-y-0.5 text-[13px] text-[#3A3A3C] leading-snug">
                    {ins.notablePeople.map(p => <li key={p.name}><b className="font-semibold text-[#1D1D1F]">{p.name}</b>{p.note ? ` — ${p.note}` : ''}</li>)}
                  </ul>
                </Part>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#AEAEB2]">AI tổng hợp{shown?.at ? ` ${new Date(shown.at).toLocaleDateString('vi-VN')}` : ''} · nên kiểm chứng</span>
                <button type="button" onClick={run} className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">
                  <RefreshCw size={12} strokeWidth={2.2} /> Làm mới
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={run}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[13px] font-semibold hover:bg-[#0071E3]/[0.16] transition">
              <Sparkles size={14} /> Tìm hiểu {cand.region}
            </button>
          )}
          {error && !loading && <p className="text-[12.5px] text-[#D70015]">{error}</p>}
        </div>
      )}
    </div>
  );
}
