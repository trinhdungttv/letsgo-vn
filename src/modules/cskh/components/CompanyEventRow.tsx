// Dòng "ngày của công ty" trong Sự kiện & Quà: ngày thành lập / kỷ niệm / ngày lễ riêng của
// 1 công ty, hoặc ngày lễ quốc gia gom mọi công ty có người đứng đầu nước đó (migration 185).
import { Building2, CalendarPlus, Globe2, Pencil } from 'lucide-react';
import { TINT } from '../../../components/workspace/wsTheme';
import { agendaTitle, COMPANY_OCCASION_LABEL, type CompanyAgendaItem } from '../../../lib/cskh/companyDates';
import { chipStyle, daysUntilLabel, gcalTemplateUrl, PURPLE, ROUND_ICON } from '../ui';
import { CompanyTag, Row } from './apple';

const MAX_TAGS = 6;

export function CompanyEventRow({ item, first, onOpenClient, onEdit }: {
  item: CompanyAgendaItem;
  first: boolean;
  onOpenClient: (clientId: string) => void;
  /** Mở form nhập nhanh (công ty đó / tab Lễ theo quốc gia). */
  onEdit: (item: CompanyAgendaItem) => void;
}) {
  const { nextIso, daysUntil } = item;
  const national = item.type === 'national';
  const isLunar = national ? item.holiday.isLunar : item.occasion.isLunar;
  const lunarDm = national ? `${item.holiday.day}/${item.holiday.month}` : `${item.occasion.day}/${item.occasion.month}`;
  const companies = national ? item.clients : [item.client];
  const title = agendaTitle(item);

  const openGcal = () => window.open(gcalTemplateUrl({
    title: `${title} — ${companies.map(c => c.name).join(', ')}`,
    dateIso: nextIso,
    location: '',
    details: [
      national ? `Ngày lễ ${item.holiday.country}${item.holiday.localName ? ` (${item.holiday.localName})` : ''}` : COMPANY_OCCASION_LABEL[item.occasion.kind],
      isLunar ? `Âm lịch ${lunarDm}` : '',
      national && item.holiday.tip ? `Gợi ý: ${item.holiday.tip}` : '',
      !national && item.occasion.note ? item.occasion.note : '',
      'Tạo từ CSKH LetsGo',
    ].filter(Boolean).join('\n'),
  }), '_blank', 'noopener');

  return (
    <Row first={first} inset={56} align="start">
      <span className="w-11 shrink-0 rounded-[10px] bg-white overflow-hidden text-center leading-none shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)]" aria-hidden>
        <small className="block bg-[#0071E3] text-white text-[9.5px] font-semibold uppercase py-[3px]">Th{Number(nextIso.slice(5, 7))}</small>
        <b className="block text-[18px] font-semibold text-[#1D1D1F] py-[5px] tabular-nums">{Number(nextIso.slice(8, 10))}</b>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[#1D1D1F] leading-snug">
          {title}
          {national && item.holiday.localName && <span className="font-normal text-[#86868B]"> · {item.holiday.localName}</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1">
          {national ? (
            <span className={`inline-flex items-center gap-1 px-2 rounded-full text-[11px] font-medium ${TINT.blue}`}><Globe2 size={11} /> Lễ {item.holiday.country}</span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 rounded-full text-[11px] font-medium" style={chipStyle(PURPLE)}><Building2 size={11} /> {COMPANY_OCCASION_LABEL[item.occasion.kind]}</span>
          )}
          {isLunar && <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.yellow}`}>Âm {lunarDm}</span>}
          <span className={`sm:hidden px-2 rounded-full text-[11px] font-medium ${daysUntil <= 7 ? TINT.red : TINT.gray}`}>{daysUntilLabel(daysUntil)}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-1">
          {companies.slice(0, MAX_TAGS).map(c => (
            <button key={c.id} type="button" onClick={() => onOpenClient(c.id)} title={`Mở hồ sơ ${c.name}`} className="max-w-full hover:opacity-75 transition">
              <CompanyTag name={c.name} />
            </button>
          ))}
          {companies.length > MAX_TAGS && <span className="text-[12px] text-[#86868B] self-center">+{companies.length - MAX_TAGS} công ty</span>}
        </p>
        {national && item.holiday.tip && <p className="text-[12px] text-[#6E6E73] mt-1">{item.holiday.tip}</p>}
        {!national && item.occasion.note && <p className="text-[12px] text-[#6E6E73] mt-1">{item.occasion.note}</p>}
      </div>
      <span className={`hidden sm:inline shrink-0 px-2.5 py-0.5 rounded-full text-[12px] font-medium ${daysUntil <= 7 ? TINT.red : TINT.gray}`}>{daysUntilLabel(daysUntil)}</span>
      <button type="button" onClick={openGcal} title="Thêm vào Google Calendar" aria-label={`Thêm ${title} vào Google Calendar`}
        className={`${ROUND_ICON} hover:!text-[#0066CC]`}><CalendarPlus size={15} /></button>
      <button type="button" onClick={() => onEdit(item)} title={national ? 'Sửa ngày lễ quốc gia' : 'Sửa ngày của công ty'} aria-label={`Sửa ${title}`}
        className={`${ROUND_ICON} hidden sm:inline-flex`}><Pencil size={14} /></button>
    </Row>
  );
}
