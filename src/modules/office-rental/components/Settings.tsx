import { useMemo, useRef, useState } from 'react';
import { Download, FileJson, Upload } from 'lucide-react';
import { useOffice, type Rows } from '../data/OfficeDataProvider';
import { runTrackerImport } from '../data/importTracker';
import { errMsg } from '../data/api';
import { parseTrackerJson, type TrackerSnapshot } from '../lib/import/tracker';
import { planImport, type PlanRows } from '../lib/import/plan';
import { buildExportJson } from '../lib/export';
import { buildPLCsv, downloadText, stamp } from '../lib/download';
import { monthToDate, toMonthKey } from '../lib/calc/months';
import type { BdsSettings } from '../lib/types';
import { DecimalInput, MoneyInput } from './MoneyInput';
import { Banner, Card, Field, Modal, MonthInput, Toggle, cls } from './ui';

function ImportDialog({ file, snapshot, onClose }: { file: string; snapshot: TrackerSnapshot; onClose: () => void }) {
  const { rows, settings, reload, flush, toast } = useOffice();
  const [includeSettings, setIncludeSettings] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(
    () => planImport(snapshot, rows as unknown as PlanRows, settings, { replaceAll, includeSettings }),
    [snapshot, rows, settings, replaceAll, includeSettings],
  );
  const canRun = !step && (!replaceAll || confirmText.trim().toUpperCase() === 'THAY THẾ');

  const run = async () => {
    setError(null);
    setStep('Đang chuẩn bị…');
    try {
      await flush();
      await runTrackerImport(snapshot, rows as unknown as PlanRows, { replaceAll, includeSettings }, setStep);
      await reload();
      toast('Đã nhập xong dữ liệu từ file');
      onClose();
    } catch (e) {
      setError(errMsg(e) + ' — dữ liệu có thể mới nhập một phần; chạy lại sẽ không bị nhân đôi.');
      setStep(null);
      await reload();
    }
  };

  const line = (label: string, c: { create: number; update: number }) => (
    <tr className="border-t border-gray-100">
      <td className={cls.td}>{label}</td>
      <td className={`${cls.td} ${cls.num} text-emerald-700`}>{c.create || '—'}</td>
      <td className={`${cls.td} ${cls.num} text-blue-700`}>{c.update || '—'}</td>
    </tr>
  );

  return (
    <Modal
      open onClose={() => { if (!step) onClose(); }} wide
      title={<span className="flex items-center gap-1.5"><FileJson size={15} /> Xem trước nhập file — {file}</span>}
      footer={<>
        <button className={`${cls.btn} ${cls.secondary}`} onClick={onClose} disabled={!!step}>Huỷ</button>
        <button className={`${cls.btn} ${replaceAll ? 'bg-red-600 text-white hover:bg-red-700' : cls.primary}`} disabled={!canRun} onClick={run}>
          {step || (replaceAll ? 'Xoá & nhập lại' : 'Xác nhận nhập')}
        </button>
      </>}
    >
      <div className="space-y-3 text-[12px]">
        <div className="text-gray-500">File tracker version {snapshot.version}. Khớp theo <b>tên</b> (khoản thuê, khách, hạng mục) → chạy lại nhiều lần không bị nhân đôi. Ô bằng 0 trong file được bỏ qua.</div>
        {snapshot.warnings.length > 0 && <Banner tone="amber"><ul>{snapshot.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner>}
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full">
            <thead className="bg-gray-50"><tr>
              <th className={`${cls.th} text-left`}>Dữ liệu</th>
              <th className={`${cls.th} text-right`}>Tạo mới</th>
              <th className={`${cls.th} text-right`}>Cập nhật</th>
            </tr></thead>
            <tbody>
              {line('Khoản thuê đầu vào (MBT/TS4)', plan.headLeases)}
              <tr className="border-t border-gray-100"><td className={cls.td} colSpan={3}><span className="text-gray-500">Mốc tăng giá: thay bằng {plan.increases} mốc trong file (cho các khoản thuê trong file)</span></td></tr>
              {line('Khách hàng', plan.tenants)}
              {line('Hạng mục chi phí vận hành', plan.opexCategories)}
              {line('Tiền thuê theo tháng (ô)', plan.rent)}
              {line('Phụ phí điện/xe theo tháng (ô)', plan.fees)}
              {line('Chi phí vận hành theo tháng (ô)', plan.opex)}
              {line('Khoản dự kiến phát sinh', plan.forecasts)}
              {(plan.scenarios.create + plan.scenarios.update) > 0 && line('Kịch bản hòa vốn', plan.scenarios)}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={includeSettings} onChange={e => setIncludeSettings(e.target.checked)} />
            <span><b>Nhập cả cài đặt từ file</b> (tỷ giá, VAT, đơn giá xe…). Mặc định tắt để giữ cài đặt hiện tại.</span>
          </label>
          {includeSettings && (
            plan.settingsChanges.length ? (
              <ul className="ml-6 list-disc text-gray-600">
                {plan.settingsChanges.map(c => <li key={c.label}>{c.label}: {c.from} → <b>{c.to}</b></li>)}
              </ul>
            ) : <div className="ml-6 text-gray-400">Không có thay đổi cài đặt.</div>
          )}
        </div>

        <div className={`rounded-lg border p-3 space-y-2 ${replaceAll ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={replaceAll} onChange={e => { setReplaceAll(e.target.checked); setConfirmText(''); }} />
            <span><b className="text-red-700">Thay thế toàn bộ dữ liệu Tài chính</b> — xoá số liệu hiện có rồi nhập lại theo file. Không thể hoàn tác.</span>
          </label>
          {replaceAll && plan.deletes && (
            <>
              <div className="ml-6 text-red-800">
                Sẽ <b>xoá vĩnh viễn</b>:
                <ul className="list-disc ml-5">
                  {plan.deletes.map(d => <li key={d.label}>{d.label}: <b>{d.count}</b></li>)}
                  {!plan.deletes.length && <li>(không có gì để xoá)</li>}
                </ul>
                Phòng, tài sản, sự cố không bị ảnh hưởng. Nên bấm "Xuất JSON sao lưu" trước.
              </div>
              <div className="ml-6">
                <label className="text-red-800">Gõ <b>THAY THẾ</b> để xác nhận:</label>
                <input className={`${cls.inputSm} ml-2 w-[140px]`} value={confirmText} onChange={e => setConfirmText(e.target.value)} />
              </div>
            </>
          )}
        </div>
        {error && <Banner tone="red">{error}</Banner>}
      </div>
    </Modal>
  );
}

function DataCard() {
  const { rows, calc, months, toast } = useOffice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: string; snapshot: TrackerSnapshot } | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = parseTrackerJson(JSON.parse(await f.text()));
      if (!parsed.snapshot) { toast(parsed.error || 'File không hợp lệ'); return; }
      setPending({ file: f.name, snapshot: parsed.snapshot });
    } catch {
      toast('Không đọc được file — cần file .json xuất từ tracker Orient');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card title="🗂️ Dữ liệu" desc="Nhập dữ liệu từ tracker cũ (orient_pl_*.json), sao lưu toàn bộ, xuất báo cáo CSV cho Excel.">
      <div className="flex flex-wrap gap-2">
        <button className={`${cls.btn} ${cls.primary}`} onClick={() => fileRef.current?.click()}><Upload size={13} /> Import JSON tracker</button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        <button className={`${cls.btn} ${cls.secondary}`} onClick={() => downloadText(`orient_office_backup_${stamp()}.json`, JSON.stringify(buildExportJson(rows as Rows), null, 2), 'application/json')}>
          <Download size={13} /> Xuất JSON sao lưu
        </button>
        <button className={`${cls.btn} ${cls.secondary}`} onClick={() => downloadText(`orient_pl_bao_cao_${stamp()}.csv`, buildPLCsv(calc, months), 'text/csv;charset=utf-8')}>
          <Download size={13} /> Xuất CSV Lời/Lỗ
        </button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2">File sao lưu dùng định dạng tracker v4 → nạp lại được bằng chính nút Import (phần Tài chính). Phần vận hành (phòng, hoá đơn, sự cố…) được lưu kèm để tra cứu.</div>
      {pending && <ImportDialog file={pending.file} snapshot={pending.snapshot} onClose={() => setPending(null)} />}
    </Card>
  );
}

export default function Settings() {
  const { settings, patch, opsReady } = useOffice();
  const set = (p: Partial<BdsSettings>, immediate = false) => patch('bds_settings', '1', p, immediate);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 items-start">
      <Card title="💱 Tỷ giá USD → VNĐ" desc="Dùng để quy đổi doanh thu/chi phí USD sang VNĐ.">
        <Field label="Tỷ giá (đồng / 1 USD)" hint="Nhập tay tỷ giá muốn áp dụng (vd Vietcombank).">
          <MoneyInput value={settings.exchange_rate} onChange={v => v > 0 && set({ exchange_rate: v })} />
        </Field>
      </Card>

      <Card title="🧾 Thuế VAT" desc="Áp cho mọi khoản đang chọn 'đã gồm' / 'chưa gồm' VAT, theo loại thuế suất của khoản.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="VAT thuê mặt bằng (%)"><DecimalInput value={settings.vat_rate_rent} onChange={v => v !== null && v <= 100 && set({ vat_rate_rent: v })} /></Field>
          <Field label="VAT điện & bãi xe (%)"><DecimalInput value={settings.vat_rate_util} onChange={v => v !== null && v <= 100 && set({ vat_rate_util: v })} /></Field>
        </div>
      </Card>

      <Card title="📅 Khoảng thời gian theo dõi">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu từ tháng">
            <MonthInput className="w-full" value={toMonthKey(settings.start_month)} onChange={m => m && set({ start_month: monthToDate(m) }, true)} />
          </Field>
          <Field label="Số tháng (quá khứ + tương lai)">
            <select className={`${cls.inputSm} w-full`} value={settings.range_months} onChange={e => set({ range_months: Number(e.target.value) }, true)}>
              <option value={12}>12 tháng</option>
              <option value={18}>18 tháng</option>
              <option value={24}>24 tháng</option>
              <option value={36}>36 tháng</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title="🔮 Dự đoán & hiển thị">
        <div className="space-y-2.5">
          <Toggle checked={settings.include_forecast_in_cost} onChange={v => set({ include_forecast_in_cost: v }, true)} label="Cộng khoản dự kiến vào Tổng chi phí" />
          <div className="text-[11px] text-gray-400 -mt-1 ml-11">Tắt (mặc định): chỉ tham khảo. Bật: cộng thẳng vào chi phí đúng tháng dự kiến.</div>
          <Toggle checked={settings.hide_empty_months} onChange={v => set({ hide_empty_months: v }, true)} label="Bảng tổng quan chỉ hiện tháng đã nhập doanh thu" />
        </div>
      </Card>

      {opsReady && (
        <Card title="⚡ Vận hành" desc="Dùng cho chốt chỉ số điện, hoá đơn và cảnh báo.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Đơn giá điện mặc định (đ/kWh)"><MoneyInput value={settings.electricity_unit_price ?? 0} onChange={v => set({ electricity_unit_price: v })} /></Field>
            <Field label="Hạn thanh toán (ngày trong tháng)">
              <DecimalInput value={settings.invoice_due_day ?? 10} onChange={v => v !== null && v >= 1 && v <= 28 && set({ invoice_due_day: Math.round(v) })} />
            </Field>
            <Field label="Cảnh báo HĐ hết hạn trước (ngày)" hint="Hiện 2 mức: ≤ 30 ngày (đỏ) và ≤ mốc này (vàng)">
              <DecimalInput value={settings.alert_days ?? 60} onChange={v => v !== null && v >= 1 && v <= 365 && set({ alert_days: Math.round(v) })} />
            </Field>
            <Field label="Thông tin chuyển khoản (in cuối hoá đơn)" className="sm:col-span-2">
              <textarea
                className={`${cls.input} min-h-[60px]`} value={settings.invoice_footer || ''}
                placeholder="VD: TK 1234567890 · Vietcombank · CTY TNHH TTV HR GROUP"
                onChange={e => set({ invoice_footer: e.target.value || null })}
              />
            </Field>
          </div>
        </Card>
      )}

      <div className="lg:col-span-2"><DataCard /></div>
    </div>
  );
}
