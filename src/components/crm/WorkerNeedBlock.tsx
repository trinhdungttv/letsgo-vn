// ============================================================================
// "Khách yêu cầu" trong hồ sơ công ty CRM: số lao động khách cần + hình thức (thời vụ / chính thức).
// ----------------------------------------------------------------------------
// Số này nhập lúc "Thêm công ty" (ô "Ước tính LĐ") và hiện ở thẻ Pipeline ("~300 LĐ"), nhưng trước đây
// hồ sơ không có chỗ xem / sửa. Lưu ở 2 nơi như lúc thêm công ty:
//   • crm_pipeline.worker_estimate        — số hiện ở thẻ Pipeline
//   • market_leads.workers_needed + need_type — Thị trường → Công ty/Dự án (cùng crm_id)
// Sửa ở đây là ghi cả hai. "Tổng Thời Vụ / Chính Thức" bên dưới là số lao động đang làm — khác với số khách cần.
// "Hình thức cần" đi theo sản phẩm đã chọn (src/lib/productService.ts): sản phẩm Giới thiệu lao động → chỉ còn
// "Chính thức" hoặc "Cả hai"; dữ liệu cũ lệch (form Thêm công ty trước đây luôn ghi thời vụ) tự sửa theo sản phẩm.
// ============================================================================
import { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { supabase } from '../../lib/supabase';
import { NEED_LABEL, pruneMissing, type NeedType } from '../../lib/serviceMode';
import { needOfProduct, needOptionsFor, fitNeedToProduct } from '../../lib/productService';

interface LeadNeed {
  id: string;
  workersNeeded: number;
  /** null = DB chưa chạy migration 184 (chưa có cột need_type). */
  needType: NeedType | null;
}

interface Props {
  entry: { id: string; company_name: string; worker_estimate: number | null };
  /** Ghi crm_pipeline.worker_estimate (có ghi nhật ký). Trả về false nếu lỗi. */
  onSaveEstimate: (n: number | null) => Promise<boolean>;
  /** Nhóm sản phẩm đang chọn (crm_products.category) — quyết định hình thức cần. */
  productCategory?: string | null;
  toast: (m: string) => void;
}

export default function WorkerNeedBlock({ entry, onSaveEstimate, productCategory, toast }: Props) {
  const { user } = useAuth();
  const [lead, setLead] = useState<LeadNeed | null>(null);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('market_leads').select('*').eq('crm_id', entry.id).limit(1).maybeSingle();
      if (!alive) return;
      setLead(data ? {
        id: data.id,
        workersNeeded: data.workers_needed ?? 0,
        needType: 'need_type' in data ? (data.need_type ?? 'leasing') as NeedType : null,
      } : null);
    })();
    return () => { alive = false; };
  }, [entry.id]);

  // Thẻ Pipeline đọc worker_estimate; dòng cũ chỉ có số bên Thị trường thì lấy số đó
  const shown = entry.worker_estimate ?? (lead && lead.workersNeeded > 0 ? lead.workersNeeded : null);

  const commit = async () => {
    setEditing(false);
    const n = Math.max(0, parseInt(val) || 0);
    if (n === (shown ?? 0)) return;
    if (!(await onSaveEstimate(n > 0 ? n : null))) return;
    if (!lead) return;
    const { error } = await supabase.from('market_leads').update({ workers_needed: n }).eq('id', lead.id);
    if (error) { toast('Đã lưu số LĐ nhưng chưa cập nhật bên Thị trường: ' + error.message); return; }
    setLead({ ...lead, workersNeeded: n });
  };

  const changeNeedType = async (needType: NeedType, reason = '') => {
    if (!lead || needType === lead.needType) return;
    const payload = await pruneMissing('market_leads', { need_type: needType }, ['need_type']);
    if (!('need_type' in payload)) { toast('Chưa chạy migration 184 — chưa lưu được hình thức cần'); return; }
    const { error } = await supabase.from('market_leads').update(payload).eq('id', lead.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setLead({ ...lead, needType });
    await logActivity({
      user, action: 'update', table: 'market_leads', recordId: lead.id,
      description: `Đổi hình thức khách cần → ${NEED_LABEL[needType]}${reason} — "${entry.company_name}"`,
    });
  };

  // Sản phẩm quyết định hình thức: đổi sản phẩm, hoặc dữ liệu cũ đang lệch → ghi lại cho khớp
  const implied = needOfProduct(productCategory);
  const needOptions = needOptionsFor(implied);
  useEffect(() => {
    if (!lead?.needType) return;
    const fit = fitNeedToProduct(lead.needType, implied);
    if (fit && fit !== lead.needType) void changeNeedType(fit, ` (theo sản phẩm "${productCategory}")`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.needType, implied]);
  const shownNeed = lead?.needType ? fitNeedToProduct(lead.needType, implied) ?? lead.needType : null;

  return (
    <>
      <div>
        <div className="text-[11px] text-[#888] font-medium mb-0.5">Khách yêu cầu <span className="font-normal text-[#bbb]">— ước tính số LĐ</span></div>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} value={val} autoFocus onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }}
              className="flex-1 min-w-0 text-[12.5px] px-2 py-1 border border-blue-500 rounded-lg outline-none"
            />
            <button onClick={() => void commit()} aria-label="Lưu" className="p-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Check size={12} /></button>
            <button onClick={() => setEditing(false)} aria-label="Huỷ" className="p-1 text-gray-400 hover:text-gray-600"><X size={12} /></button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(shown ? String(shown) : ''); setEditing(true); }}
            className="group flex items-center gap-1.5 w-full text-left text-[12.5px] font-medium text-[#111] hover:text-blue-600 transition"
          >
            <span className={shown ? '' : 'text-gray-400 italic'}>{shown ? `~${shown.toLocaleString('vi-VN')} LĐ` : 'Chưa có'}</span>
            <Pencil size={11} className="text-gray-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition shrink-0" />
          </button>
        )}
      </div>
      <div>
        <div className="text-[11px] text-[#888] font-medium mb-0.5">Hình thức cần</div>
        {shownNeed ? (
          <>
            <select
              value={shownNeed}
              onChange={e => void changeNeedType(e.target.value as NeedType)}
              className="w-full text-[12.5px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
            >
              {needOptions.map(k => <option key={k} value={k}>{NEED_LABEL[k]}</option>)}
            </select>
            {implied && (
              <div className="text-[10.5px] text-[#aaa] mt-0.5">Theo sản phẩm “{productCategory}” — đổi sản phẩm để đổi hình thức</div>
            )}
          </>
        ) : (
          <div className="text-[12.5px] text-gray-400 italic">{lead ? 'Chưa chạy migration 184' : 'Chưa có hồ sơ Thị trường'}</div>
        )}
      </div>
    </>
  );
}
