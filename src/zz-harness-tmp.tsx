// TẠM — thử bước 2 Báo giá khách. Xoá sau khi kiểm tra. Quy mô chuẩn là bản giả, không lưu vào DB.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import PlanEditor from './components/workspace/costplan/PlanEditor';
import { computePlan, DEFAULT_SETTINGS, newLine } from './lib/costPlan/engine';
import type { PlanData } from './lib/costPlan/types';

const data0: PlanData = {
  settings: { ...DEFAULT_SETTINGS, workers: 20 }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'month', value: 5_310_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
    newLine({ name: 'BHXH, BHYT, BHTN (DN đóng 21,5%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 21.5 }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 59000, isServiceFee: true, group: 'service' }),
  ],
};
function Harness() {
  const [data, setData] = useState<PlanData>(data0);
  const [def, setDef] = useState({ supply: { workers: 10, simDays: 26 }, referral: { workers: 10, simDays: 26 } });
  const result = useMemo(() => computePlan(data), [data]);
  const scale = { defaults: def, remember: (sv: 'supply' | 'referral', p: { workers?: number; simDays?: number }) => setDef(d => ({ ...d, [sv]: { ...d[sv], ...p } })) };
  (window as unknown as { __def: unknown }).__def = def;
  return <div className="p-4 max-w-[1180px] mx-auto"><PlanEditor data={data} result={result} onChange={setData} initialStep="quote" scale={scale} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
