// Thẻ "Đang đi ngang" — công ty gần nhất trong bán kính khi đang khảo sát.
// Khách hàng / Pipeline / KH tiềm năng / đã từng từ chối: hiện tổng quan đầy đủ.
// Công ty mới có ở Thị trường hoặc chỉ có tên trên bản đồ OSM: chỉ hiện tên (bấm để xem thêm / thêm vào hệ thống).
import { Camera, ChevronDown, ChevronUp, ExternalLink, ImageIcon, Phone, Plus, X } from 'lucide-react';
import { latestLaborEntry } from '../../../lib/format';
import type { LaborHistoryEntry, MarketLead } from '../../../lib/types';
import { PIPELINE_STAGE_LABEL, STATUS_META, type NearbyCompany, type SurveyCompany } from '../../../lib/kcnSurvey/companies';
import type { SurveyPhoto } from '../../../lib/kcnSurvey/api';
import { fmtDistance } from '../../../lib/kcnSurvey/track';
import type { SurveyClient, SurveyPipeline } from './surveyData';

const RATING_LABEL: Record<string, string> = { hot: 'Tiềm năng cao', normal: 'Bình thường', low: 'Thấp' };

export interface CompanyLookup {
  clientById: Map<string, SurveyClient>;
  pipelineById: Map<string, SurveyPipeline>;
  leadById: Map<string, MarketLead>;
  laborHistory: Record<string, LaborHistoryEntry[]>;
  branchName: (id: string | null | undefined) => string | null;
}

interface Fact { label: string; value: string; href?: string; wide?: boolean }

const wageTr = (min?: number | null, max?: number | null) => {
  if (min == null && max == null) return null;
  const f = (v: number) => (v / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  return min != null && max != null && min !== max ? `${f(min)}–${f(max)} tr` : `${f((min ?? max)!)} tr`;
};

function daysAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return days <= 0 ? `${date} (hôm nay)` : `${date} (${days} ngày trước)`;
}

/** Các dòng thông tin tổng quan của 1 công ty, lấy từ đúng nguồn của nó. */
export function companyFacts(c: SurveyCompany, lk: CompanyLookup): Fact[] {
  const facts: Fact[] = [];
  const client = c.clientId ? lk.clientById.get(c.clientId) : undefined;
  const pipe = c.crmId ? lk.pipelineById.get(c.crmId) : undefined;
  const lead = c.leadId ? lk.leadById.get(c.leadId) : undefined;

  if (client) {
    const workers = latestLaborEntry(lk.laborHistory[client.id] ?? [])?.count;
    if (client.client_type === 'active') facts.push({ label: 'LĐ hiện tại', value: workers != null ? workers.toLocaleString('vi-VN') : '—' });
    const branch = lk.branchName(client.branch_id);
    if (branch) facts.push({ label: 'Chi nhánh', value: branch });
    if (client.manager) facts.push({ label: 'Quản lý', value: client.manager });
    if (client.contract_start && client.client_type === 'active') facts.push({ label: 'Hợp tác từ', value: new Date(client.contract_start).toLocaleDateString('vi-VN') });
    if (client.industry) facts.push({ label: 'Ngành', value: client.industry });
    const w = wageTr(client.wage_min, client.wage_max);
    if (w) facts.push({ label: 'Lương', value: w });
    if (client.industrial_zones?.length) facts.push({ label: 'KCN', value: client.industrial_zones.join(', '), wide: client.industrial_zones.length > 1 });
  }
  if (pipe) {
    const stage = PIPELINE_STAGE_LABEL[pipe.stage] ?? pipe.stage;
    if (c.status !== 'client' || pipe.stage !== 'hop-tac') facts.push({ label: 'Giai đoạn', value: pipe.sub_status && (pipe.stage === 'khong-nhu-cau' || pipe.stage === 'ngung') ? `${stage} — ${pipe.sub_status}` : stage, wide: !!pipe.sub_status });
    if (pipe.rating && RATING_LABEL[pipe.rating]) facts.push({ label: 'Đánh giá', value: RATING_LABEL[pipe.rating] });
    const est = pipe.worker_estimate ?? ((pipe.workers_seasonal ?? 0) + (pipe.workers_permanent ?? 0) || null);
    if (est) {
      const split = [pipe.workers_seasonal ? `TV ${pipe.workers_seasonal}` : null, pipe.workers_permanent ? `CT ${pipe.workers_permanent}` : null].filter(Boolean).join(' · ');
      facts.push({ label: 'LĐ ước tính', value: split ? `${est.toLocaleString('vi-VN')} (${split})` : est.toLocaleString('vi-VN') });
    }
    if (pipe.last_contact) facts.push({ label: 'Liên hệ gần nhất', value: daysAgo(pipe.last_contact) });
    if (pipe.contacts?.name) facts.push({ label: 'Người liên hệ', value: [pipe.contacts.name, pipe.contacts.phone].filter(Boolean).join(' · '), href: pipe.contacts.phone ? `tel:${pipe.contacts.phone.replace(/\s+/g, '')}` : undefined });
    if (pipe.crm_products?.name) facts.push({ label: 'Sản phẩm', value: pipe.crm_products.name });
  }
  if (lead) {
    if (!client?.industry && lead.industry) facts.push({ label: 'Ngành', value: lead.industry });
    if (lead.workers_needed) facts.push({ label: 'Nhu cầu LĐ', value: lead.workers_needed.toLocaleString('vi-VN') });
    if (!pipe && lead.status) facts.push({ label: 'Trạng thái', value: lead.status });
    const w = wageTr(lead.wage_min, lead.wage_max);
    if (w && !client?.wage_min) facts.push({ label: 'Lương', value: w });
    const rivals = (lead.suppliers ?? []).filter(s => !s.is_us && s.name?.trim()).map(s => s.qty ? `${s.name} (${s.qty})` : s.name);
    if (rivals.length) facts.push({ label: 'NCC đang cung ứng', value: rivals.join(', '), wide: true });
    if (!client && lead.region) facts.push({ label: 'KCN', value: lead.region });
  }
  return facts;
}

export function companyPhone(c: SurveyCompany, lk: CompanyLookup): string | null {
  const pipe = c.crmId ? lk.pipelineById.get(c.crmId) : undefined;
  const client = c.clientId ? lk.clientById.get(c.clientId) : undefined;
  return pipe?.contacts?.phone || client?.phone || null;
}

export function StatusDot({ status, size = 9 }: { status: SurveyCompany['status']; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: STATUS_META[status].color }} />;
}

export function statusLabel(c: SurveyCompany, lk: CompanyLookup): string {
  if (c.status === 'pipeline' && c.crmId) {
    const stage = lk.pipelineById.get(c.crmId)?.stage;
    if (stage && PIPELINE_STAGE_LABEL[stage]) return `Pipeline · ${PIPELINE_STAGE_LABEL[stage]}`;
  }
  return STATUS_META[c.status].label;
}

interface Props {
  item: NearbyCompany;
  lookup: CompanyLookup;
  photos: SurveyPhoto[];
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenProfile: (c: SurveyCompany) => void;
  onPhoto: (c: SurveyCompany) => void;
  onAddToMarket: (c: SurveyCompany) => void;
  onShowPhotos: (c: SurveyCompany) => void;
  otherCount: number;
  onShowNearby: () => void;
}

export default function SurveyCompanyCard({ item, lookup, photos, expanded, onToggle, onClose, onOpenProfile, onPhoto, onAddToMarket, onShowPhotos, otherCount, onShowNearby }: Props) {
  const c = item.company;
  const meta = STATUS_META[c.status];
  // Mở sẵn với công ty "đáng chú ý" (cha đặt expanded theo meta.rich mỗi khi đổi công ty)
  const facts = expanded ? companyFacts(c, lookup) : [];
  const phone = companyPhone(c, lookup);
  const pipe = c.crmId ? lookup.pipelineById.get(c.crmId) : undefined;
  const lastPhoto = photos[0];
  const showBody = expanded;

  return (
    <div className="pointer-events-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden"
      style={{ borderLeft: `4px solid ${meta.color}` }}>
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: meta.color }}>
            <StatusDot status={c.status} size={7} />
            <span className="truncate">{statusLabel(c, lookup)}</span>
            {Number.isFinite(item.dist) && (
              <span className="text-[#8E8E93] font-normal shrink-0">· {item.dist < 1 ? 'đang ở đây' : `cách ${fmtDistance(item.dist)}`}</span>
            )}
          </div>
          <div className="text-[15px] font-semibold text-[#1D1D1F] leading-snug mt-0.5 line-clamp-2">{c.name}</div>
          {c.osmOnly && c.status !== 'osm' && (
            <div className="text-[10.5px] text-[#8E8E93] mt-0.5">Vị trí theo bản đồ OSM{c.osmName && c.osmName !== c.name ? ` (“${c.osmName}”)` : ''} — chưa ghim trong hồ sơ</div>
          )}
          {c.status === 'osm' && <div className="text-[11px] text-[#8E8E93] mt-0.5">Chưa có trong hệ thống</div>}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onToggle} className="w-8 h-8 rounded-full flex items-center justify-center text-[#8E8E93] hover:bg-black/5" aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}>
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#8E8E93] hover:bg-black/5" aria-label="Ẩn thẻ">
            <X size={16} />
          </button>
        </div>
      </div>

      {showBody && (
        <div className="px-3 pb-2.5 space-y-2 max-h-[30vh] overflow-y-auto">
          {facts.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {facts.map(f => (
                <div key={f.label} className={`rounded-lg bg-[#F5F5F7] px-2 py-1.5 min-w-0 ${f.wide ? 'col-span-2' : ''}`}>
                  <div className="text-[10px] text-[#8E8E93] leading-tight">{f.label}</div>
                  {f.href
                    ? <a href={f.href} className="text-[12.5px] font-medium text-[#0A84FF] leading-snug break-words">{f.value}</a>
                    : <div className="text-[12.5px] font-medium text-[#1D1D1F] leading-snug break-words">{f.value}</div>}
                </div>
              ))}
            </div>
          )}
          {pipe?.notes?.trim() && (
            <div className="text-[12px] text-[#3A3A3C] bg-[#FFF8E6] rounded-lg px-2 py-1.5 line-clamp-3 whitespace-pre-line">{pipe.notes.trim()}</div>
          )}
          {photos.length > 0 && (
            <button onClick={() => onShowPhotos(c)} className="w-full flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-2 py-1.5 text-left">
              {lastPhoto?.thumb_url
                ? <img src={lastPhoto.thumb_url} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
                : <ImageIcon size={16} className="text-[#8E8E93]" />}
              <span className="text-[12px] text-[#1D1D1F]">
                {photos.length} ảnh chỉ tiêu · gần nhất {new Date(lastPhoto.taken_at).toLocaleDateString('vi-VN')}
                {lastPhoto.positions && <span className="text-[#8E8E93]"> · {lastPhoto.positions}</span>}
              </span>
            </button>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {c.status !== 'osm' && (
              <button onClick={() => onOpenProfile(c)} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-[#F2F2F7] text-[12.5px] font-medium text-[#1D1D1F]">
                <ExternalLink size={13} /> Mở hồ sơ
              </button>
            )}
            {c.status === 'osm' && (
              <button onClick={() => onAddToMarket(c)} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-[#F2F2F7] text-[12.5px] font-medium text-[#1D1D1F]">
                <Plus size={13} /> Thêm vào Thị trường
              </button>
            )}
            <button onClick={() => onPhoto(c)} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-[#0A84FF] text-white text-[12.5px] font-semibold">
              <Camera size={13} /> Chụp chỉ tiêu
            </button>
            {phone && (
              <a href={`tel:${phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-[#E8F8EE] text-[#1E8E3E] text-[12.5px] font-medium">
                <Phone size={13} /> Gọi
              </a>
            )}
          </div>
        </div>
      )}

      {otherCount > 0 && (
        <button onClick={onShowNearby} className="w-full px-3 py-1.5 border-t border-black/5 text-[11.5px] text-[#0A84FF] font-medium text-left">
          +{otherCount} công ty khác trong bán kính
        </button>
      )}
    </div>
  );
}
