// Hàm thuần của Bảng nháp đầu mối dùng ở nhiều màn (tách khỏi parts.tsx để Fast Refresh chỉ thấy component).
import { CONTACT_CHANNELS } from '../../../lib/contactOps';
import { formatDateVN, todayVN } from '../../../lib/cskh/dates';
import { matchCompetitor, pendingPartsOf, type NamedItem, type PhoneOwner } from '../../../lib/saleLeads/match';
import { LEAD_CHANNEL_LABEL, SALE_LEAD_STATUS_LABEL, type SaleLead } from '../../../lib/saleLeads/types';
import { socialKind } from '../../../lib/socialLinks';
import type { NewContactPrefill } from '../components/ContactProfileModal';

/** Màu viên: KCN xanh dương, khu vực khác chàm, chữ chưa ghép xám. */
export const AREA_CHIP = {
  zone: 'bg-[#0071E3]/10 text-[#0058B0]',
  area: 'bg-[#5856D6]/10 text-[#3634A3]',
  raw: 'bg-black/[0.05] text-[#6E6E73]',
} as const;

/** Tên KCN gọn (bỏ chữ "KCN " đầu). */
export const shortZone = (name: string) => name.replace(/^KCN\s+/i, '');

/** Mốc thời gian ISO (UTC) → "dd/mm/yyyy" theo giờ Việt Nam. */
export const vnDate = (iso: string): string => formatDateVN(todayVN(new Date(iso)));

/** Ghi chú 1 dòng về người đang giữ số (dùng ở ô tra số, form, bảng nhập). */
export function ownerLine(o: PhoneOwner): string {
  const tail = o.kind === 'lead' && o.lead
    ? ` · ${SALE_LEAD_STATUS_LABEL[o.lead.status]}${o.lead.contactLog.length ? ` · đã liên hệ ${o.lead.contactLog.length} lần` : ''}${o.lead.lastContactAt ? `, gần nhất ${vnDate(o.lead.lastContactAt)}` : ''}${o.lead.createdBy ? ` · ${o.lead.createdBy} nhập ${vnDate(o.lead.createdAt)}` : ` · nhập ${vnDate(o.lead.createdAt)}`}`
    : '';
  return `${o.name || '(chưa ghi tên)'}${o.org ? ` — ${o.org}` : ''}${tail}`;
}

/** "Kênh quen biết" của hồ sơ Sale đoán từ link kênh. */
function channelOf(url: string): string {
  if (!url) return '';
  if (/zalo\.me|zalo\.vn/i.test(url)) return CONTACT_CHANNELS.includes('Zalo') ? 'Zalo' : '';
  return socialKind(url) === 'facebook' && CONTACT_CHANNELS.includes('Facebook') ? 'Facebook' : '';
}

/** Điền sẵn form "Thêm Sale" từ 1 đầu mối (lúc chuyển sang Sale / CTV). */
export function promotePrefill(lead: SaleLead, zones: readonly NamedItem[], areas: readonly NamedItem[], competitors: readonly NamedItem[]): NewContactPrefill {
  // Hồ sơ Sale chỉ có ô KCN → khu vực khác + chữ gốc chưa ghép ghi vào ghi chú
  const extraArea = [...areas.filter(a => lead.areaIds.includes(a.id)).map(a => a.name), ...pendingPartsOf(lead, zones, areas)];
  const history = lead.contactLog.map(l =>
    `• ${vnDate(l.at)} ${LEAD_CHANNEL_LABEL[l.channel]} — ${SALE_LEAD_STATUS_LABEL[l.result]}${l.note ? `: ${l.note}` : ''}`);
  const notes = [
    `Từ Bảng nháp đầu mối (nhập ${vnDate(lead.createdAt)})`,
    extraArea.length ? `Khu vực: ${extraArea.join(', ')}` : '',
    lead.postUrl ? `Bài đăng tuyển: ${lead.postUrl}` : '',
    lead.note ? `Ghi chú: ${lead.note}` : '',
    history.length ? `Đã liên hệ:\n${history.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    name: lead.fullName,
    phone: lead.phone,
    socialLink: lead.channelUrl,
    notes,
    channel: channelOf(lead.channelUrl),
    saleCompany: lead.company,
    competitorId: matchCompetitor(lead.company, competitors)?.id ?? null,
    saleZoneIds: lead.zoneIds.filter(id => zones.some(z => z.id === id)),
  };
}
