// Khối riêng của Tổng quan Mạng lưới Sale: Tiến độ chiêu mộ (ai đang được mời về làm) và
// Giới thiệu khách (Sale nào mang công ty về BD Pipeline). Chỉ hiện ở trang Sale.
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { isWonReferral, referralsByContact, type SaleReferral } from '../../../lib/cskh/saleReferrals';
import { SALE_STAGE_LABEL } from '../../../lib/cskh/space';
import type { CskhContact, SaleStage } from '../../../lib/cskh/types';
import { CAPTION, LINK, SALE_STAGE_COLOR } from '../ui';
import { Panel, Quiet, Row, Segmented } from './apple';
import { ContactAvatar } from './ContactAvatar';

/** Các bước đang "mở" của chiêu mộ, theo thứ tự tiến lên. */
const FUNNEL: readonly SaleStage[] = ['exploring', 'invited', 'negotiating', 'joined'];
const LIMIT = 5;

type Tab = 'recruit' | 'referral';

export function SaleNetworkPanel({ contacts, referrals, onOpenProfile, onOpenList }: {
  /** Sale trong phạm vi lọc của Tổng quan. */
  contacts: readonly CskhContact[];
  referrals: readonly SaleReferral[];
  onOpenProfile: (contactId: string) => void;
  onOpenList: () => void;
}) {
  const [tab, setTab] = useState<Tab>('recruit');
  const active = useMemo(() => contacts.filter(c => !c.isArchived), [contacts]);

  const funnel = useMemo(() => FUNNEL.map(stage => ({
    stage,
    people: active.filter(c => c.saleStage === stage),
  })), [active]);
  const declined = active.filter(c => c.saleStage === 'declined').length;
  const inFunnel = funnel.reduce((n, f) => n + f.people.length, 0);

  const top = useMemo(() => {
    const by = referralsByContact(active, referrals);
    return active
      .map(c => {
        const list = by.get(c.id) ?? [];
        return { contact: c, total: list.length, won: list.filter(isWonReferral).length, latest: list[0]?.companyName ?? '' };
      })
      .filter(x => x.total > 0)
      .sort((a, b) => b.won - a.won || b.total - a.total || a.contact.fullName.localeCompare(b.contact.fullName, 'vi'));
  }, [active, referrals]);
  const totalReferred = top.reduce((n, x) => n + x.total, 0);

  return (
    <Panel title="Mạng lưới Sale"
      meta={tab === 'recruit'
        ? (inFunnel ? `${inFunnel} người đang trong tiến trình chiêu mộ${declined ? ` · ${declined} từ chối` : ''}` : 'Chưa ai trong tiến trình chiêu mộ')
        : (totalReferred ? `${top.length} Sale đã giới thiệu ${totalReferred} công ty` : 'Chưa có công ty nào do Sale giới thiệu')}
      action={<button type="button" onClick={onOpenList} className={LINK}>Danh sách <ChevronRight size={14} /></button>}>
      <Segmented label="Mạng lưới Sale" value={tab} onChange={setTab} options={[
        { key: 'recruit', label: 'Chiêu mộ', badge: inFunnel },
        { key: 'referral', label: 'Giới thiệu khách', badge: top.length },
      ]} />
      <div className="mt-1.5">
        {tab === 'recruit' && (inFunnel === 0
          ? <Quiet>Mở hồ sơ Sale → "Tiến độ chiêu mộ" để theo dõi người bạn muốn mời về làm.</Quiet>
          : funnel.filter(f => f.people.length > 0).map((f, idx) => (
            <Row key={f.stage} first={idx === 0} inset={22} align="start">
              <i className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ background: SALE_STAGE_COLOR[f.stage] }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-[#1D1D1F]">{SALE_STAGE_LABEL[f.stage]} <span className="font-normal text-[#86868B] tabular-nums">{f.people.length}</span></span>
                <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                  {f.people.slice(0, LIMIT).map(c => (
                    <button key={c.id} type="button" onClick={() => onOpenProfile(c.id)}
                      className="text-[12.5px] text-[#0066CC] hover:opacity-70 transition truncate max-w-[180px]">
                      {c.fullName}{c.organization ? ` · ${c.organization}` : ''}
                    </button>
                  ))}
                  {f.people.length > LIMIT && <span className={CAPTION}>+{f.people.length - LIMIT}</span>}
                </span>
              </span>
            </Row>
          )))}

        {tab === 'referral' && (top.length === 0
          ? <Quiet>Ở BD Pipeline, chọn nguồn "Đối tác giới thiệu" (hoặc "Sale") và chọn đúng tên Sale — công ty sẽ tự tính cho người đó.</Quiet>
          : top.slice(0, LIMIT).map((x, idx) => (
            <Row key={x.contact.id} first={idx === 0} inset={52} onClick={() => onOpenProfile(x.contact.id)} title="Mở hồ sơ Sale">
              <ContactAvatar name={x.contact.fullName} url={x.contact.avatarUrl} tier={x.contact.tier} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{x.contact.fullName}</span>
                <span className={`block ${CAPTION} truncate`}>Mới nhất: {x.latest}</span>
              </span>
              <span className="text-right shrink-0">
                <b className="block text-[17px] font-semibold leading-none tabular-nums text-[#1D1D1F]">{x.total}</b>
                <small className="text-[11px] text-[#248A3D]">{x.won ? `${x.won} hợp tác` : 'công ty'}</small>
              </span>
            </Row>
          )))}
      </div>
    </Panel>
  );
}
