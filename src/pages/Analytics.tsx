import { useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler } from 'chart.js';
import PageHeader from '../components/PageHeader';
import { MARKET_DATA } from '../lib/constants';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

interface AnalyticsProps {
  toast?: (msg: string) => void;
}

export default function Analytics(_props: AnalyticsProps) {
  const [tab, setTab] = useState(0);
  const [zone, setZone] = useState('KCN Biên Hòa 2');

  return (
    <>
      <PageHeader title="Báo cáo & Phân tích" subtitle="Hao hụt LĐ · Chi nhánh ROI · Xu hướng TT" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex gap-1.5 mb-4">
          {['Tỷ lệ hao hụt LĐ', 'Chi nhánh ROI', 'Xu hướng thị trường'].map((t, i) => (
            <button key={i} onClick={() => setTab(i)} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${tab === i ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>{t}</button>
          ))}
        </div>

        {tab === 0 && (
          <div>
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center"><div className="text-[24px] font-bold text-red-800">23</div><div className="text-[12px] text-red-800 mt-0.5">≤ 3 ngày đầu · 0.81%</div></div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center"><div className="text-[24px] font-bold text-amber-800">47</div><div className="text-[12px] text-amber-800 mt-0.5">≤ 1 tuần đầu · 1.65%</div></div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center"><div className="text-[24px] font-bold text-emerald-800">89</div><div className="text-[12px] text-emerald-800 mt-0.5">≤ 1 tháng đầu · 3.13%</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Theo nhà máy — hao hụt 1 tháng đầu</div>
                <div className="p-3" style={{ height: 190 }}>
                  <Bar data={{ labels: ['Changshin', 'Pou Chen', 'Taekwang', 'Hansae'], datasets: [{ data: [22, 18, 28, 9], backgroundColor: ['#F59E0B', '#10B981', '#EF4444', '#10B981'], borderRadius: 4, barPercentage: 0.7 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }} />
                </div>
              </div>
              <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Theo chi nhánh tuyển dụng</div>
                <div className="p-3" style={{ height: 190 }}>
                  <Bar data={{ labels: ['Biên Hòa', 'Bình Dương', 'Nhơn Trạch', 'Bàu Bàng'], datasets: [{ label: '≤3 ngày', data: [8, 7, 5, 3], backgroundColor: '#EF4444', borderRadius: 3, barPercentage: 0.5 }, { label: '≤1 tháng', data: [35, 28, 15, 11], backgroundColor: '#3B82F6', borderRadius: 3, barPercentage: 0.5 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }} />
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Chi tiết — phát hiện bất thường</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-[#E8E7E2]"><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Nhà máy / KH</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tổng LĐ</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Nghỉ ≤3 ngày</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Nghỉ ≤1 tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tỷ lệ</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Đánh giá</th></tr></thead>
                  <tbody>
                    <tr className="bg-red-50"><td className="px-3 py-2 font-semibold">Taekwang Vina</td><td className="px-3 py-2">176</td><td className="px-3 py-2 text-red-600 font-semibold">8</td><td className="px-3 py-2 text-red-600 font-semibold">28</td><td className="px-3 py-2 text-red-600 font-semibold">15.9%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-red-100 text-red-800 border border-red-200">Cảnh báo cao</span></td></tr>
                    <tr className="bg-amber-50"><td className="px-3 py-2 font-medium">Changshin VN</td><td className="px-3 py-2">312</td><td className="px-3 py-2">5</td><td className="px-3 py-2 text-amber-700">22</td><td className="px-3 py-2 text-amber-700">7.1%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-amber-100 text-amber-800 border border-amber-200">Theo dõi</span></td></tr>
                    <tr><td className="px-3 py-2">Pou Chen Vietnam</td><td className="px-3 py-2">421</td><td className="px-3 py-2">4</td><td className="px-3 py-2">18</td><td className="px-3 py-2">4.3%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">Bình thường</span></td></tr>
                    <tr><td className="px-3 py-2">Hansae Vietnam</td><td className="px-3 py-2">208</td><td className="px-3 py-2">2</td><td className="px-3 py-2">9</td><td className="px-3 py-2">4.3%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">Bình thường</span></td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 1 && (
          <div>
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden mb-4">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Doanh thu vs Lợi nhuận thực từng chi nhánh</div>
              <div className="p-3" style={{ height: 220 }}>
                <Bar data={{ labels: ['Biên Hòa', 'Bình Dương', 'Nhơn Trạch', 'Bàu Bàng'], datasets: [{ label: 'DT', data: [1200, 890, 450, 307], backgroundColor: 'rgba(59,130,246,.2)', borderRadius: 5, barPercentage: 0.5 }, { label: 'LN', data: [1077, 793, 389, 229], backgroundColor: ['#059669', '#059669', '#059669', '#EF4444'], borderRadius: 5, barPercentage: 0.5 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => Number(v) + 'tr' }, beginAtZero: true } } }} />
              </div>
            </div>
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Chi tiết ROI từng chi nhánh</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-[#E8E7E2]"><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Chi nhánh</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Doanh thu</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Thuê VP</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">CP vận hành</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Khoán CN</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">LN thực</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Margin</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Trạng thái</th></tr></thead>
                  <tbody>
                    <tr><td className="px-3 py-2 font-semibold">Biên Hòa</td><td className="px-3 py-2">1,200 tr</td><td className="px-3 py-2">35 tr</td><td className="px-3 py-2">28 tr</td><td className="px-3 py-2">60 tr</td><td className="px-3 py-2 text-emerald-600 font-semibold">1,077 tr</td><td className="px-3 py-2 text-emerald-600">89.8%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">Xuất sắc</span></td></tr>
                    <tr><td className="px-3 py-2 font-semibold">Bình Dương</td><td className="px-3 py-2">890 tr</td><td className="px-3 py-2">30 tr</td><td className="px-3 py-2">22 tr</td><td className="px-3 py-2">45 tr</td><td className="px-3 py-2 text-emerald-600 font-semibold">793 tr</td><td className="px-3 py-2 text-emerald-600">89.1%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">Tốt</span></td></tr>
                    <tr><td className="px-3 py-2 font-semibold">Nhơn Trạch</td><td className="px-3 py-2">450 tr</td><td className="px-3 py-2">20 tr</td><td className="px-3 py-2">19 tr</td><td className="px-3 py-2">22 tr</td><td className="px-3 py-2 text-amber-600 font-semibold">389 tr</td><td className="px-3 py-2 text-amber-600">86.4%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-amber-100 text-amber-700 border border-amber-200">Đạt</span></td></tr>
                    <tr className="bg-red-50"><td className="px-3 py-2 font-semibold">Bàu Bàng</td><td className="px-3 py-2">307 tr</td><td className="px-3 py-2">25 tr</td><td className="px-3 py-2 text-red-600 font-semibold">38 tr ⚠</td><td className="px-3 py-2">15 tr</td><td className="px-3 py-2 text-amber-600 font-semibold">229 tr</td><td className="px-3 py-2 text-red-600 font-semibold">74.6%</td><td className="px-3 py-2"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-red-100 text-red-800 border border-red-200">CP cao</span></td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 2 && (
          <div>
            <div className="flex gap-2.5 items-center mb-4">
              <label className="text-[13px] text-[#555] font-medium">KCN:</label>
              <select value={zone} onChange={e => setZone(e.target.value)} className="text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none">
                {Object.keys(MARKET_DATA).map(z => <option key={z}>{z}</option>)}
              </select>
            </div>
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[#111]">Xu hướng lương thị trường T1–T6/2026 (triệu ₫/tháng/người)</span>
                <div className="flex gap-3 text-[11.5px] text-[#888]">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-[3px] bg-blue-500 rounded-sm" />Phổ thông</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-[3px] bg-emerald-500 rounded-sm" />Tay nghề</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-[3px] bg-violet-500 rounded-sm" />KTV</span>
                </div>
              </div>
              <div className="p-3" style={{ height: 210 }}>
                <Line data={{
                  labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
                  datasets: [
                    { data: MARKET_DATA[zone]?.pt || [], borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
                    { data: MARKET_DATA[zone]?.tn || [], borderColor: '#059669', backgroundColor: 'transparent', tension: 0.4, borderWidth: 2, pointRadius: 3 },
                    { data: MARKET_DATA[zone]?.ktv || [], borderColor: '#7C3AED', backgroundColor: 'transparent', tension: 0.4, borderWidth: 2, pointRadius: 3 },
                  ]
                }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => Number(v).toFixed(1) + 'tr' }, beginAtZero: false } } }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
