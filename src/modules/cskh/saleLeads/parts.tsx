// Khối giao diện dùng chung của Bảng nháp đầu mối (tab "Đầu mối" trong tệp Sale / CTV).
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { OWNER_LABEL, unmatchedAreaParts, type NamedItem, type PhoneOwner } from '../../../lib/saleLeads/match';
import { formatPhoneKey } from '../../../lib/saleLeads/parse';
import { SALE_LEAD_STATUS_COLOR, SALE_LEAD_STATUS_LABEL, type SaleLead, type SaleLeadStatus } from '../../../lib/saleLeads/types';
import { withScheme } from '../../../lib/socialLinks';
import { chipStyle } from '../ui';
import { AREA_CHIP, ownerLine, shortZone } from './helpers';

export function StatusPill({ status, onClick, title }: { status: SaleLeadStatus; onClick?: () => void; title?: string }) {
  const cls = 'inline-flex items-center px-2.5 h-7 rounded-full text-[12px] font-medium whitespace-nowrap';
  const style = chipStyle(SALE_LEAD_STATUS_COLOR[status]);
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} hover:brightness-95 active:scale-[0.97] transition`} style={style}>{SALE_LEAD_STATUS_LABEL[status]}</button>
    : <span className={cls} style={style} title={title}>{SALE_LEAD_STATUS_LABEL[status]}</span>;
}

/**
 * Khu vực của 1 đầu mối: KCN (xanh) + khu vực khác (chàm) + phần chữ gốc chưa ghép (xám — thôi hiện khi
 * đã chọn lại bằng tay).
 */
export function ZoneChips({ zoneIds, areaIds = [], areaText, reviewed = false, zones, areas = [], max = 6 }: {
  zoneIds: readonly string[];
  areaIds?: readonly string[];
  areaText: string;
  reviewed?: boolean;
  zones: readonly NamedItem[];
  areas?: readonly NamedItem[];
  max?: number;
}) {
  const rest = reviewed ? [] : unmatchedAreaParts(areaText, zoneIds, zones, areaIds, areas);
  const all = [
    ...zones.filter(z => zoneIds.includes(z.id)).map(z => ({ key: z.id, label: shortZone(z.name), cls: AREA_CHIP.zone, tip: z.name })),
    ...areas.filter(a => areaIds.includes(a.id)).map(a => ({ key: a.id, label: a.name, cls: AREA_CHIP.area, tip: a.name })),
    ...rest.map(p => ({ key: `t:${p}`, label: shortZone(p), cls: AREA_CHIP.raw, tip: `${p} — chữ gốc chưa ghép, bấm để chọn từ danh sách` })),
  ];
  if (!all.length) return <span className="text-[#C7C7CC]">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {all.slice(0, max).map(z => (
        <span key={z.key} title={z.tip} className={`px-2 h-6 inline-flex items-center rounded-full text-[11.5px] font-medium whitespace-nowrap ${z.cls}`}>
          {z.label}
        </span>
      ))}
      {all.length > max && <span className="text-[11.5px] text-[#86868B] self-center">+{all.length - max}</span>}
    </span>
  );
}

/** Nút mở link kênh / bài đăng (tab mới). */
export function LeadLinks({ lead }: { lead: Pick<SaleLead, 'channelUrl' | 'postUrl'> }) {
  if (!lead.channelUrl && !lead.postUrl) return <span className="text-[#C7C7CC]">—</span>;
  const btn = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/[0.05] text-[12px] font-medium text-[#0066CC] hover:bg-black/[0.08] transition whitespace-nowrap';
  return (
    <span className="flex flex-wrap gap-1">
      {lead.channelUrl && <a href={withScheme(lead.channelUrl)} target="_blank" rel="noreferrer" className={btn} title={lead.channelUrl}>Kênh <ExternalLink size={11} /></a>}
      {lead.postUrl && <a href={withScheme(lead.postUrl)} target="_blank" rel="noreferrer" className={btn} title={lead.postUrl}>Bài đăng <ExternalLink size={11} /></a>}
    </span>
  );
}

/** Hộp kết quả tra số: số mới / đã có ở đâu. */
export function PhoneCheckBox({ keys, owners, action }: { keys: readonly string[]; owners: readonly PhoneOwner[]; action?: ReactNode }) {
  if (!keys.length) return null;
  if (!owners.length) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-[#34C759]/[0.12] px-3.5 py-2.5 text-[13px] text-[#1D6B34]">
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="flex-1 min-w-[180px]"><b>{keys.map(formatPhoneKey).join(', ')}</b> — số mới, chưa ai trong hệ thống có số này.</span>
        {action}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {owners.map(o => {
        const warn = o.kind !== 'client';
        return (
          <div key={`${o.kind}:${o.id}`} className={`flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[13px] leading-snug ${warn ? 'bg-[#FF9500]/[0.12] text-[#7A3E00]' : 'bg-[#8944AB]/[0.10] text-[#5B2C73]'}`}>
            {warn ? <AlertTriangle size={16} className="shrink-0 mt-px" /> : <Info size={16} className="shrink-0 mt-px" />}
            <span><b>{OWNER_LABEL[o.kind]}:</b> {ownerLine(o)}</span>
          </div>
        );
      })}
    </div>
  );
}
