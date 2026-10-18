import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, Building, CheckCircle2, Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { useHashTab } from '../../../hooks/useHashSubRoute';
import { useOffice } from '../data/OfficeDataProvider';
import { OFFICE_NAV, type OfficePage } from '../pages';
import { Banner, SubTabs, cls } from './ui';
import PLOverview from './finance/PLOverview';
import UnitPL from './finance/UnitPL';
import Breakeven from './finance/Breakeven';
import HeadLeases from './finance/HeadLeases';
import Revenue from './finance/Revenue';
import Opex from './finance/Opex';
import Forecast from './finance/Forecast';
import Settings from './Settings';
import OpsOverview from './ops/OpsOverview';
import Rooms from './ops/Rooms';
import Contracts from './ops/Contracts';
import Invoices from './ops/Invoices';
import Meters from './ops/Meters';
import Parking from './ops/Parking';
import Tickets from './ops/Tickets';
import Assets from './ops/Assets';
import Dashboard from './dashboard/Dashboard';
import Reports from './reports/Reports';
import NotificationBell from './NotificationBell';

const PL_TABS = [
  { key: 'tong-quan', label: '📊 Tổng quan Lời/Lỗ' },
  { key: 'mat-bang', label: '🏢 Theo mặt bằng' },
  { key: 'hoa-von', label: '🧮 Hòa vốn tách phòng' },
  { key: 'chi-phi-thue', label: '🏦 Chi phí thuê (đầu vào)' },
  { key: 'doanh-thu', label: '💰 Doanh thu khách hàng' },
  { key: 'van-hanh', label: '🔧 Chi phí vận hành' },
  { key: 'du-doan', label: '🔮 Dự đoán phát sinh' },
] as const;
type PLTab = (typeof PL_TABS)[number]['key'];

const ROOM_TABS = [{ key: 'phong', label: 'Mặt bằng & Phòng' }, { key: 'hop-dong', label: 'Hợp đồng' }] as const;
type RoomTab = (typeof ROOM_TABS)[number]['key'];
const BILL_TABS = [{ key: 'hoa-don', label: 'Hoá đơn & Thu tiền' }, { key: 'chi-so-dien', label: 'Chốt chỉ số điện' }] as const;
type BillTab = (typeof BILL_TABS)[number]['key'];

const SUBTITLE: Record<OfficePage, string> = {
  office: 'Orient Apartment · 331 Bến Vân Đồn, Q.4 — việc cần xử lý, lịch sắp tới, bức tranh tháng này',
  'office-dashboard': 'Biểu đồ trực quan, nhận định tự động và dự báo 12 tháng tới',
  'office-reports': 'Báo cáo tháng, năm/quý, công nợ, hợp đồng, dòng tiền dự báo — in & xuất CSV',
  'office-pl': 'Thuê MBT + TS4 → cho thuê lại · lời/lỗ theo tháng, theo mặt bằng, hòa vốn',
  'office-rooms': 'Sơ đồ phòng theo mặt bằng gốc · hợp đồng khách thuê lại',
  'office-billing': 'Thông báo thanh toán = tiền thuê + điện + xe · trạng thái thu tiền',
  'office-parking': 'Hầm xe Thủy Sản 4 — mua lại rồi bán cho khách: lời/lỗ riêng phần bãi xe',
  'office-tickets': 'Quy trình 5 bước: kiểm tra → xác định chi phí → duyệt chi → sửa → đóng ticket',
  'office-assets': 'Thiết bị gắn theo phòng / khu vực',
  'office-settings': 'Tỷ giá, VAT, khoảng thời gian · nhập/xuất dữ liệu',
};

function SaveIndicator() {
  const { saveState, retry } = useOffice();
  const vals = Object.values(saveState);
  const errors = vals.filter(v => v === 'error').length;
  const busy = vals.filter(v => v === 'pending' || v === 'saving').length;
  if (errors) {
    return (
      <button onClick={() => retry()} className="flex items-center gap-1.5 text-[11.5px] text-red-600 font-medium hover:underline">
        <AlertTriangle size={13} /> {errors} ô chưa lưu được — Thử lại tất cả
      </button>
    );
  }
  if (busy) return <span className="flex items-center gap-1.5 text-[11.5px] text-amber-600"><Loader2 size={13} className="animate-spin" /> Đang lưu…</span>;
  if (vals.length) return <span className="flex items-center gap-1.5 text-[11.5px] text-emerald-600"><CheckCircle2 size={13} /> Đã lưu</span>;
  return null;
}

function Blocked() {
  const { access, loadError, reload, status } = useOffice();
  const { logout } = useAuth();
  let body: ReactNode;
  if (status === 'error') {
    body = <><div className="font-semibold text-red-700 mb-1">Không tải được dữ liệu</div><div className="text-red-700/80 mb-3">{loadError}</div></>;
  } else if (access === 'not_installed') {
    body = (
      <>
        <div className="font-semibold mb-1">Module chưa được cài trên cơ sở dữ liệu</div>
        <ol className="list-decimal ml-5 text-left space-y-1 text-gray-600 mb-3">
          <li>Mở Supabase → <b>SQL Editor</b> → New query.</li>
          <li>Dán toàn bộ nội dung file <code>supabase/migrations/20261018100000_164_bds_office_rental_core.sql</code> → <b>Run</b>.</li>
          <li>Dán tiếp file <code>…165_bds_office_rental_ops.sql</code> → <b>Run</b>.</li>
          <li>Quay lại đây bấm <b>Tải lại</b>.</li>
        </ol>
      </>
    );
  } else if (access === 'not_admin') {
    body = <><ShieldAlert className="mx-auto mb-2 text-red-500" /><div className="font-semibold mb-1">Chỉ tài khoản admin được vào Văn phòng Orient</div></>;
  } else {
    body = (
      <>
        <div className="font-semibold mb-1">Phiên đăng nhập đã hết hạn</div>
        <div className="text-gray-600 mb-3">Dữ liệu Văn phòng Orient cần phiên đăng nhập admin còn hạn (7 ngày). Hãy đăng xuất rồi đăng nhập lại.</div>
        <button className={`${cls.btn} ${cls.primary} mb-2`} onClick={logout}><LogOut size={13} /> Đăng xuất</button>
      </>
    );
  }
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E8E7E2] rounded-xl p-5 max-w-lg w-full text-center text-[12.5px]">
        {body}
        <button className={`${cls.btn} ${cls.secondary}`} onClick={() => reload()}><RefreshCw size={13} /> Tải lại</button>
      </div>
    </div>
  );
}

function OpsGate({ children }: { children: ReactNode }) {
  const { opsReady } = useOffice();
  if (opsReady) return <>{children}</>;
  return (
    <Banner tone="amber">
      Phần <b>Vận hành</b> cần thêm bảng dữ liệu: mở Supabase → SQL Editor → dán nội dung file
      <code className="mx-1">supabase/migrations/20261018110000_165_bds_office_rental_ops.sql</code> → Run, rồi bấm Tải lại ở góc trên.
    </Banner>
  );
}

function PLSection() {
  const [tab, setTab] = useHashTab<PLTab>('office-pl', PL_TABS.map(t => t.key), 'tong-quan');
  return (
    <Section tabs={<SubTabs tabs={[...PL_TABS]} value={tab} onChange={setTab} />}>
      {tab === 'tong-quan' && <PLOverview />}
      {tab === 'mat-bang' && <UnitPL />}
      {tab === 'hoa-von' && <Breakeven />}
      {tab === 'chi-phi-thue' && <HeadLeases />}
      {tab === 'doanh-thu' && <Revenue />}
      {tab === 'van-hanh' && <Opex />}
      {tab === 'du-doan' && <Forecast />}
    </Section>
  );
}

function RoomsSection() {
  const [tab, setTab] = useHashTab<RoomTab>('office-rooms', ROOM_TABS.map(t => t.key), 'phong');
  return (
    <Section tabs={<SubTabs tabs={[...ROOM_TABS]} value={tab} onChange={setTab} />}>
      <OpsGate>{tab === 'phong' ? <Rooms /> : <Contracts />}</OpsGate>
    </Section>
  );
}

function BillingSection() {
  const [tab, setTab] = useHashTab<BillTab>('office-billing', BILL_TABS.map(t => t.key), 'hoa-don');
  return (
    <Section tabs={<SubTabs tabs={[...BILL_TABS]} value={tab} onChange={setTab} />}>
      <OpsGate>{tab === 'hoa-don' ? <Invoices /> : <Meters />}</OpsGate>
    </Section>
  );
}

const REPORT_TABS = [
  { key: 'thang', label: 'Báo cáo tháng' },
  { key: 'nam', label: 'Năm / Quý' },
  { key: 'cong-no', label: 'Công nợ' },
  { key: 'hop-dong', label: 'Hợp đồng' },
  { key: 'du-bao', label: 'Dòng tiền dự báo' },
] as const;
type ReportTab = (typeof REPORT_TABS)[number]['key'];

function ReportsSection() {
  const [tab, setTab] = useHashTab<ReportTab>('office-reports', REPORT_TABS.map(t => t.key), 'thang');
  return (
    <Section tabs={<SubTabs tabs={[...REPORT_TABS]} value={tab} onChange={setTab} />}>
      <Reports tab={tab} />
    </Section>
  );
}

function Section({ tabs, children }: { tabs?: ReactNode; children: ReactNode }) {
  return (
    <>
      {tabs && <div className="px-3 md:px-5 bg-white border-b border-[#E8E7E2] shrink-0">{tabs}</div>}
      <div className="flex-1 overflow-y-auto p-3 md:p-5">{children}</div>
    </>
  );
}

export default function OfficeShell({ page }: { page: OfficePage }) {
  const { status, reload } = useOffice();
  const nav = useMemo(() => OFFICE_NAV.find(n => n.page === page), [page]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 md:px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div className="min-w-0 flex-1 basis-[200px]">
          <div className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5">
            <Building size={15} className="text-gray-500" /> Văn phòng Orient <span className="text-gray-300">/</span> {nav?.label}
          </div>
          <div className="text-[11.5px] text-[#888] mt-0.5 truncate">{SUBTITLE[page]}</div>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator />
          {status === 'ready' && <NotificationBell />}
          <button className={`${cls.btn} ${cls.ghost} !px-2`} title="Tải lại dữ liệu" onClick={() => reload()}><RefreshCw size={13} /></button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /></div>
      )}
      {(status === 'blocked' || status === 'error') && <Blocked />}
      {status === 'ready' && (
        <>
          {page === 'office' && <Section><OpsOverview /></Section>}
          {page === 'office-dashboard' && <Section><Dashboard /></Section>}
          {page === 'office-reports' && <ReportsSection key={page} />}
          {page === 'office-pl' && <PLSection key={page} />}
          {page === 'office-rooms' && <RoomsSection key={page} />}
          {page === 'office-billing' && <BillingSection key={page} />}
          {page === 'office-parking' && <Section><Parking /></Section>}
          {page === 'office-tickets' && <Section><OpsGate><Tickets /></OpsGate></Section>}
          {page === 'office-assets' && <Section><OpsGate><Assets /></OpsGate></Section>}
          {page === 'office-settings' && <Section><Settings /></Section>}
        </>
      )}
    </div>
  );
}
