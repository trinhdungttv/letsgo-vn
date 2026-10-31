// Form ứng tuyển công khai: bật/tắt link, chép link, mã QR (in tờ rơi / băng rôn / gửi Zalo), link riêng cho từng CTV
// (hồ sơ nộp qua link CTV tự gắn người giới thiệu → tính hoa hồng).
import { useMemo, useState } from 'react';
import { Copy, Download, Link2, QrCode } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { downloadBlob } from '../../lib/costPlan/pdf';
import { errText, shareProject } from '../../lib/recruit/api';
import { applyUrl, qrSvg } from '../../lib/recruit/publicLink';
import { useRecruit } from './context';
import { CAPTION, PILL_GRAY, PILL_TINTED, Panel, Switch, inputCls } from './ui';

export default function SharePanel() {
  const { project, sales, reload, toast, canEdit } = useRecruit();
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState('');
  const code = project?.public_code ?? null;
  const open = !!project?.public_open && !!code;
  const url = code ? applyUrl(code, ref || null) : '';
  const svg = useMemo(() => (url ? qrSvg(url) : ''), [url]);
  if (!project) return null;

  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      await shareProject(project.id, v);
      await reload();
      toast(v ? 'Đã mở form ứng tuyển — gửi link / QR cho ứng viên' : 'Đã đóng form ứng tuyển');
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => toast((await copyText(url)) ? 'Đã chép link ứng tuyển' : 'Không chép được');
  const saveQr = () => {
    const who = ref ? `-${sales.find(s => s.id === ref)?.name ?? 'ctv'}` : '';
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `QR ung tuyen ${code}${who}.svg`.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  };

  return (
    <Panel title="Form ứng tuyển (link + mã QR)" icon={<QrCode size={16} className="text-[#00708F]" />}
      meta="Ứng viên tự điền trên điện thoại, hồ sơ vào thẳng tab Ứng tuyển (bước Mới). Chỉ hiện vị trí đã xác nhận & đang mở tuyển.">
      <div className="pb-3 space-y-3">
        {canEdit && <Switch checked={open} onChange={v => { if (!busy) toggle(v); }} label={open ? 'Đang mở nhận hồ sơ' : 'Đang đóng'} />}
        {open && (
          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
            <div className="space-y-2 min-w-0">
              <label className="block">
                <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Link riêng cho CTV (tự gắn người giới thiệu)</span>
                <select value={ref} onChange={e => setRef(e.target.value)} className={inputCls}>
                  <option value="">— Link chung —</option>
                  {sales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-2 rounded-[10px] bg-[#F5F5F7] px-3 py-2 text-[12.5px] text-[#1D1D1F] min-w-0">
                <Link2 size={14} className="text-[#86868B] shrink-0" />
                <span className="truncate">{url}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className={PILL_TINTED}><Copy size={14} /> Chép link</button>
                <button type="button" onClick={saveQr} className={PILL_GRAY}><Download size={14} /> Tải mã QR</button>
                <a href={url} target="_blank" rel="noreferrer" className={PILL_GRAY}>Xem thử</a>
              </div>
              <p className={CAPTION}>Mã QR dạng SVG — in to bao nhiêu cũng nét (tờ rơi, băng rôn, cổng KCN, nhóm Zalo).</p>
            </div>
            <div className="w-[168px] h-[168px] rounded-[14px] bg-white p-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] mx-auto [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: svg }} aria-label="Mã QR link ứng tuyển" role="img" />
          </div>
        )}
      </div>
    </Panel>
  );
}
