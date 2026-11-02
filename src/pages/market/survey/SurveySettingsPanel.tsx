// Cài đặt chế độ Khảo sát KCN — thu phóng bản đồ khi di chuyển, bán kính nhận diện công ty, lớp hiển thị.
import type { ReactNode } from 'react';
import { Loader2, Maximize, Minus, Plus, RefreshCw, X } from 'lucide-react';
import type { SurveyPrefs } from './surveyData';

export interface AreaStatus {
  state: 'idle' | 'loading' | 'ok' | 'error';
  roads: number;
  places: number;
  fetchedAt: number | null;
  error: string | null;
}

interface Props {
  prefs: SurveyPrefs;
  onChange: (p: Partial<SurveyPrefs>) => void;
  zoom: number;
  onZoom: (z: number) => void;
  onFitArea: () => void;
  area: AreaStatus;
  /** Tên ranh giới KCN tìm được trên OSM (null = chưa có) */
  boundaryName: string | null;
  onReloadArea: () => void;
  onClose: () => void;
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-[#1D1D1F]">{label}</span>
        {hint && <span className="block text-[11.5px] text-[#8E8E93] leading-snug mt-0.5">{hint}</span>}
      </span>
      <span className={`relative w-[46px] h-[28px] rounded-full transition-colors shrink-0 ${on ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'}`}>
        <span className={`absolute top-[2px] w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-[20px]' : 'left-[2px]'}`} />
      </span>
    </button>
  );
}

function Chips<T extends number>({ value, options, onChange, fmt }: { value: T; options: T[]; onChange: (v: T) => void; fmt: (v: T) => string }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`h-8 px-3 rounded-full text-[12.5px] font-medium transition ${value === o ? 'bg-[#0A84FF] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F]'}`}>
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="text-[11.5px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">{title}</div>
      <div className="rounded-xl bg-white px-3 divide-y divide-black/5">{children}</div>
    </section>
  );
}

export default function SurveySettingsPanel({ prefs, onChange, zoom, onZoom, onFitArea, area, boundaryName, onReloadArea, onClose }: Props) {
  const z = Math.round(zoom);
  return (
    <div className="pointer-events-auto fixed md:absolute inset-x-0 bottom-0 md:inset-x-auto md:bottom-auto md:right-3 md:top-[68px] z-[1250] md:w-[360px]
      bg-[#F2F2F7] rounded-t-2xl md:rounded-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.2)] md:shadow-2xl max-h-[78vh] md:max-h-[calc(100%-90px)] flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <div className="text-[16px] font-semibold text-[#1D1D1F]">Cài đặt khảo sát</div>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#E5E5EA] flex items-center justify-center text-[#3A3A3C]" aria-label="Đóng"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] space-y-4">
        <Section title="Thu phóng bản đồ">
          <div className="py-3 space-y-3">
            <div className="flex items-center gap-2">
              <button onClick={() => onZoom(z - 1)} className="w-11 h-11 rounded-xl bg-[#F2F2F7] flex items-center justify-center text-[#1D1D1F] active:bg-[#E5E5EA]" aria-label="Thu nhỏ"><Minus size={20} /></button>
              <input type="range" min={12} max={19} step={1} value={z} onChange={e => onZoom(+e.target.value)} className="flex-1 accent-[#0A84FF]" aria-label="Mức zoom" />
              <button onClick={() => onZoom(z + 1)} className="w-11 h-11 rounded-xl bg-[#F2F2F7] flex items-center justify-center text-[#1D1D1F] active:bg-[#E5E5EA]" aria-label="Phóng to"><Plus size={20} /></button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[{ z: 15, label: 'Nhìn rộng' }, { z: 16, label: 'Đang chạy xe' }, { z: 17, label: 'Đi chậm' }, { z: 18, label: 'Nhìn cổng' }].map(p => (
                <button key={p.z} onClick={() => onZoom(p.z)}
                  className={`h-8 px-3 rounded-full text-[12.5px] font-medium ${z === p.z ? 'bg-[#0A84FF] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F]'}`}>
                  {p.label} · {p.z}
                </button>
              ))}
              <button onClick={onFitArea} className="h-8 px-3 rounded-full text-[12.5px] font-medium bg-[#F2F2F7] text-[#1D1D1F] inline-flex items-center gap-1">
                <Maximize size={12} /> Cả KCN
              </button>
            </div>
            <div className="text-[11.5px] text-[#8E8E93] leading-snug">Mức đang chọn ({z}) cũng là mức zoom khi bấm nút ◎ bám theo vị trí.</div>
          </div>
          <Switch on={prefs.autoZoom} onChange={v => onChange({ autoZoom: v })} label="Tự zoom theo tốc độ"
            hint="Chạy nhanh thì nhìn xa hơn, đi chậm / dừng xem cổng thì phóng gần — chỉ khi đang bám theo vị trí" />
        </Section>

        <Section title="Nhận diện công ty đi ngang">
          <div className="py-3 space-y-1.5">
            <div className="text-[13px] text-[#1D1D1F]">Bán kính</div>
            <Chips value={prefs.radiusM} options={[80, 150, 250, 400]} onChange={v => onChange({ radiusM: v })} fmt={v => `${v} m`} />
            <div className="text-[11.5px] text-[#8E8E93] leading-snug">Ghim công ty thường đặt giữa nhà máy — nhà máy lớn nên để 150–250 m.</div>
          </div>
          <Switch on={prefs.labels} onChange={v => onChange({ labels: v })} label="Tên công ty trên bản đồ" hint="Hiện khi phóng gần (mức 16 trở lên)" />
          <Switch on={prefs.vibrate} onChange={v => onChange({ vibrate: v })} label="Rung khi tới gần khách hàng / Pipeline" hint="Điện thoại Android; iPhone không hỗ trợ rung từ web" />
        </Section>

        <Section title="Đường đã đi / chưa đi">
          <Switch on={prefs.showOldTracks} onChange={v => onChange({ showOldTracks: v })} label="Hiện vết các lần khảo sát trước" hint="Màu xám; cũng được tính là đường đã đi" />
          <Switch on={prefs.showRoads} onChange={v => onChange({ showRoads: v })} label="Tô màu đường chưa đi" hint="Tải mạng đường từ OpenStreetMap: cam = chưa đi, xanh = đã đi" />
          {prefs.showRoads && (
            <>
              <Switch on={prefs.clipToZone} onChange={v => onChange({ clipToZone: v })} label="Chỉ tính đường trong ranh giới KCN"
                hint={area.state !== 'ok' ? 'Dùng ranh giới KCN trên OpenStreetMap (viền cam chấm)'
                  : boundaryName ? `Đã có ranh giới “${boundaryName}” — bỏ đường khu dân cư xung quanh`
                  : 'OSM chưa có ranh giới KCN này → đang tính mọi đường trong vùng tải'} />
              <Switch on={prefs.includeService} onChange={v => onChange({ includeService: v })} label="Tính cả đường nhánh / nội bộ" hint="Trong KCN có nhiều đường nội bộ nhà máy — thường nên tắt" />
              <div className="py-3 space-y-1.5">
                <div className="text-[13px] text-[#1D1D1F]">Vùng tải đường quanh KCN</div>
                <Chips value={prefs.areaRadiusM} options={[1000, 2000, 3000]} onChange={v => onChange({ areaRadiusM: v })} fmt={v => `${v / 1000} km`} />
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 text-[11.5px] text-[#8E8E93] leading-snug">
                    {area.state === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Đang tải bản đồ đường…</span>}
                    {area.state === 'ok' && `${area.roads} đoạn đường · ${area.places} nhà máy có tên${area.fetchedAt ? ` · tải ${new Date(area.fetchedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : ''}`}
                    {area.state === 'error' && <span className="text-[#D70015]">{area.error}</span>}
                    {area.state === 'idle' && 'Chưa tải — cần vị trí hoặc chọn KCN có toạ độ'}
                  </div>
                  <button onClick={onReloadArea} disabled={area.state === 'loading'}
                    className="h-8 px-3 rounded-full bg-[#F2F2F7] text-[12px] font-medium text-[#0A84FF] inline-flex items-center gap-1 disabled:opacity-40 shrink-0">
                    <RefreshCw size={12} /> Tải theo khung nhìn
                  </button>
                </div>
              </div>
            </>
          )}
        </Section>

        <Section title="Khác">
          <Switch on={prefs.satellite} onChange={v => onChange({ satellite: v })} label="Nền vệ tinh" hint="Nhìn mái nhà xưởng, cổng, bãi xe" />
          <Switch on={prefs.showPhotos} onChange={v => onChange({ showPhotos: v })} label="Ảnh chỉ tiêu trên bản đồ" />
          <Switch on={prefs.keepAwake} onChange={v => onChange({ keepAwake: v })} label="Giữ màn hình luôn sáng khi đang ghi"
            hint="Tắt màn hình / chuyển app thì trình duyệt ngừng nhận GPS → vết bị đứt" />
          <div className="py-3 space-y-1.5">
            <div className="text-[13px] text-[#1D1D1F]">Bỏ điểm GPS sai số quá</div>
            <Chips value={prefs.maxAccuracy} options={[20, 35, 50]} onChange={v => onChange({ maxAccuracy: v })} fmt={v => `${v} m`} />
          </div>
        </Section>
      </div>
    </div>
  );
}
