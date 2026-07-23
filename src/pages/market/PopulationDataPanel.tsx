import { Fragment, useEffect, useRef, useState } from 'react';
import { X, Upload, Plus, Trash2, Download, Loader2, Crosshair, Link2 } from 'lucide-react';
import {
  FOCUS_PROVINCES, densityOfRow, fetchCommunes, addCommune, deleteCommune,
  deleteCommunesByProvince, bulkInsertCommunes, mergeCommunes, parseImportText, templateCsv, setCommuneGeo,
} from './populationData';
import type { CommuneRow, CommuneInput } from './populationData';
import {
  nominatimGeocodeBoundary, nominatimBoundaryNear, parseGmapsPlaceLink, parseLatLngFromLink,
  isValidVnLatLng, sleep,
} from '../../lib/geo';

const EMPTY_FORM: CommuneInput = { province_new: FOCUS_PROVINCES[0].name, commune_name: '', population: 0, area_km2: 0 };

export default function PopulationDataPanel({ onClose, onChanged, toast }: {
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<'list' | 'manual' | 'import'>('list');
  const [rows, setRows] = useState<CommuneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [provinceFilter, setProvinceFilter] = useState<string>('all');

  const [form, setForm] = useState<CommuneInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [importText, setImportText] = useState('');
  const [importFilename, setImportFilename] = useState('paste.json');
  const [importProvince, setImportProvince] = useState(FOCUS_PROVINCES[0].name);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ rows: CommuneInput[]; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number; current: string } | null>(null);

  // Dán link Google Maps cho từng dòng để lấy ranh giới chính xác
  const [gmapsRowId, setGmapsRowId] = useState<string | null>(null);
  const [gmapsLink, setGmapsLink] = useState('');
  const [gmapsSaving, setGmapsSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchCommunes());
    } catch (e) {
      toast('Lỗi tải dữ liệu: ' + (e as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const shown = provinceFilter === 'all' ? rows : rows.filter(r => r.province_new === provinceFilter);

  const submitManual = async () => {
    if (!form.commune_name.trim() || form.population <= 0 || form.area_km2 <= 0) {
      toast('Nhập đủ Tên xã/phường, Dân số > 0, Diện tích > 0');
      return;
    }
    setSaving(true);
    try {
      await addCommune(form, `Nhập tay ${new Date().toLocaleDateString('vi-VN')}`);
      toast('Đã thêm ' + form.commune_name);
      setForm({ ...EMPTY_FORM, province_new: form.province_new });
      await load();
      onChanged();
    } catch (e) {
      toast('Lỗi lưu: ' + (e as Error).message);
    }
    setSaving(false);
  };

  const removeRow = async (id: string, name: string) => {
    if (!confirm(`Xoá "${name}"?`)) return;
    try {
      await deleteCommune(id);
      await load();
      onChanged();
    } catch (e) {
      toast('Lỗi xoá: ' + (e as Error).message);
    }
  };

  // Tra ranh giới polygon (OSM boundary) + toạ độ tâm xã/phường qua Nominatim cho các dòng
  // còn thiếu — có ranh giới thì bản đồ tô nguyên vùng phường/xã theo mật độ.
  // Tuần tự 1 request/giây theo giới hạn của Nominatim.
  const runGeocode = async () => {
    if (geoProgress) return;
    const targets = (provinceFilter === 'all' ? rows : rows.filter(r => r.province_new === provinceFilter))
      .filter(r => r.lat == null || r.lng == null || r.geometry == null);
    if (!targets.length) { toast('Tất cả bản ghi (trong bộ lọc) đã có ranh giới + toạ độ'); return; }
    let okPoly = 0, okPoint = 0, fail = 0;
    setGeoProgress({ done: 0, total: targets.length, current: '' });
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      setGeoProgress({ done: i, total: targets.length, current: r.commune_name });
      if (i > 0) await sleep(1100);
      // Tên tỉnh cũ giúp Nominatim khớp đúng hơn với dữ liệu OSM (nhiều vùng chưa cập nhật tên tỉnh mới).
      const oldProvince = (r.province_old ?? '').replace(/\s*\(cũ\)\s*$/, '');
      const query = [r.commune_name, oldProvince || r.province_new, 'Việt Nam'].filter(Boolean).join(', ');
      const found = await nominatimGeocodeBoundary(query);
      if (found && isValidVnLatLng({ lat: found.lat, lng: found.lng })) {
        try {
          await setCommuneGeo(r.id, found.lat, found.lng, found.geometry);
          if (found.geometry) okPoly++; else okPoint++;
        } catch {
          fail++;
        }
      } else {
        fail++;
      }
    }
    setGeoProgress(null);
    toast(`Xong: ${okPoly} có ranh giới${okPoint ? `, ${okPoint} chỉ có toạ độ điểm` : ''}${fail ? `, ${fail} không tìm được` : ''}`);
    await load();
    onChanged();
  };

  const onFilePicked = async (file: File) => {
    const text = await file.text();
    setImportText(text);
    setImportFilename(file.name);
    setPreview(parseImportText(text, file.name));
  };

  const runPreview = () => {
    if (!importText.trim()) { toast('Dán nội dung hoặc chọn file trước'); return; }
    setPreview(parseImportText(importText, importFilename));
  };

  const confirmImport = async () => {
    if (!preview || !preview.rows.length) return;
    // Chế độ thay mới sẽ XOÁ cả ranh giới/toạ độ đã sinh của tỉnh — bắt buộc xác nhận rõ.
    if (replaceExisting && !confirm(
      `Xoá TOÀN BỘ dữ liệu của "${importProvince}" (kể cả ranh giới + toạ độ đã sinh) rồi import mới?\n\n` +
      'Nếu chỉ muốn cập nhật số dân/diện tích mà GIỮ ranh giới, hãy bỏ tick ô "Xoá & thay mới" rồi import lại.',
    )) return;
    setImporting(true);
    try {
      const note = `Import file ${new Date().toLocaleDateString('vi-VN')} (${importFilename})`;
      const rowsWithProvince = preview.rows.map(r => ({ ...r, province_new: r.province_new || importProvince }));
      if (replaceExisting) {
        await deleteCommunesByProvince(importProvince);
        await bulkInsertCommunes(rowsWithProvince, note);
        toast(`Đã import ${rowsWithProvince.length} xã/phường (thay mới hoàn toàn)`);
      } else {
        const { inserted, updated } = await mergeCommunes(rowsWithProvince, note);
        toast(`Đã cập nhật ${updated} xã/phường (giữ nguyên ranh giới), thêm mới ${inserted}`);
      }
      setPreview(null);
      setImportText('');
      await load();
      onChanged();
      setTab('list');
    } catch (e) {
      toast('Lỗi import: ' + (e as Error).message);
    }
    setImporting(false);
  };

  // Dán link Google Maps (dạng /maps/place/<Tên phường>/@lat,lng) → tìm đúng ranh giới OSM
  // gần toạ độ trong link nhất và lưu lại.
  const saveGmapsLink = async (r: CommuneRow) => {
    const link = gmapsLink.trim();
    const place = parseGmapsPlaceLink(link);
    const coords = parseLatLngFromLink(link);
    const near = place ?? coords;
    if (!near || !isValidVnLatLng({ lat: near.lat, lng: near.lng })) {
      toast('Không đọc được link — dùng link Google Maps dạng .../maps/place/Tên+Phường/@lat,lng...');
      return;
    }
    setGmapsSaving(true);
    try {
      const query = place?.name ?? [r.commune_name, (r.province_old ?? '').replace(/\s*\(cũ\)\s*$/, '') || r.province_new, 'Việt Nam'].filter(Boolean).join(', ');
      const found = await nominatimBoundaryNear(query, { lat: near.lat, lng: near.lng });
      if (found?.geometry) {
        await setCommuneGeo(r.id, found.lat, found.lng, found.geometry);
        toast(`Đã lấy ranh giới cho ${r.commune_name}`);
      } else {
        await setCommuneGeo(r.id, near.lat, near.lng, null);
        toast(`Không tìm thấy ranh giới trên OSM cho "${query}" — đã lưu toạ độ điểm từ link`);
      }
      setGmapsRowId(null);
      setGmapsLink('');
      await load();
      onChanged();
    } catch (e) {
      toast('Lỗi lưu: ' + (e as Error).message);
    }
    setGmapsSaving(false);
  };

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau_du_lieu_xa_phuong.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentOldNames = FOCUS_PROVINCES.find(p => p.name === form.province_new)?.oldNames ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[12px] w-full max-w-3xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0EEE9]">
          <div>
            <h2 className="text-[15px] font-semibold text-[#111]">Dữ liệu mật độ dân số (Xã/Phường)</h2>
            <p className="text-[11.5px] text-[#888] mt-0.5">
              Mô hình chính quyền 2 cấp từ 01/07/2025 — đang ưu tiên TP. Hồ Chí Minh, Tỉnh Đồng Nai, Tỉnh Tây Ninh
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-1 px-5 pt-3">
          {([['list', `Danh sách (${rows.length})`], ['manual', 'Nhập tay'], ['import', 'Import file']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-t-lg text-[12.5px] font-medium border-b-2 transition ${
                tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-[#888] hover:text-[#333]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'list' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)}
                  className="text-[12px] px-2 py-1.5 border border-[#D8D6D0] rounded-lg bg-white outline-none">
                  <option value="all">Tất cả tỉnh/thành</option>
                  {FOCUS_PROVINCES.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                {!geoProgress ? (
                  <button onClick={runGeocode}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition">
                    <Crosshair size={12} /> Sinh ranh giới + toạ độ ({shown.filter(r => r.lat == null || r.lng == null || r.geometry == null).length} thiếu)
                  </button>
                ) : (
                  <span className="text-[12px] text-[#888] inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    {geoProgress.done + 1}/{geoProgress.total} · {geoProgress.current}
                  </span>
                )}
                <span className="text-[10.5px] text-[#999]">Có ranh giới thì bản đồ tô nguyên vùng phường/xã theo mật độ</span>
              </div>
              {loading ? (
                <div className="text-center py-8 text-[#999] text-[12.5px] flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Đang tải…
                </div>
              ) : shown.length === 0 ? (
                <div className="text-center py-8 text-[#999] text-[12.5px]">
                  Chưa có dữ liệu — dùng tab "Nhập tay" hoặc "Import file" để thêm.
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#888] border-b border-[#F0EEE9]">
                      <th className="py-1.5 font-medium">Xã/Phường</th>
                      <th className="py-1.5 font-medium">Tỉnh/Thành</th>
                      <th className="py-1.5 font-medium text-right">Dân số</th>
                      <th className="py-1.5 font-medium text-right">Diện tích</th>
                      <th className="py-1.5 font-medium text-right">Mật độ</th>
                      <th className="py-1.5 font-medium text-center">Bản đồ</th>
                      <th className="py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => (
                      <Fragment key={r.id}>
                      <tr className="border-b border-[#F7F6F3]">
                        <td className="py-1.5 font-medium text-[#222]">{r.commune_name}</td>
                        <td className="py-1.5 text-[#666]">{r.province_new}{r.province_old ? ` (${r.province_old})` : ''}</td>
                        <td className="py-1.5 text-right">{r.population.toLocaleString('vi-VN')}</td>
                        <td className="py-1.5 text-right">{r.area_km2.toLocaleString('vi-VN')} km²</td>
                        <td className="py-1.5 text-right font-semibold text-[#222]">{Math.round(densityOfRow(r)).toLocaleString('vi-VN')}</td>
                        <td className="py-1.5 text-center">
                          {r.geometry != null
                            ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">ranh giới</span>
                            : r.lat != null && r.lng != null
                              ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">điểm</span>
                              : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">thiếu</span>}
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => { setGmapsRowId(gmapsRowId === r.id ? null : r.id); setGmapsLink(''); }}
                            title="Dán link Google Maps để lấy ranh giới chính xác"
                            className={`mr-2 ${gmapsRowId === r.id ? 'text-blue-700' : 'text-blue-500 hover:text-blue-700'}`}>
                            <Link2 size={13} />
                          </button>
                          <button onClick={() => removeRow(r.id, r.commune_name)} className="text-red-500 hover:text-red-700">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                      {gmapsRowId === r.id && (
                        <tr className="bg-blue-50/40">
                          <td colSpan={7} className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11.5px] text-[#666] flex-none">
                                Link Google Maps của «{r.commune_name}»:
                              </span>
                              <input
                                value={gmapsLink}
                                onChange={e => setGmapsLink(e.target.value)}
                                placeholder="https://www.google.com/maps/place/Long+Bình,+Đồng+Nai.../@10.94,106.86..."
                                className="flex-1 text-[11.5px] px-2.5 py-1.5 border border-[#D8D6D0] rounded-lg outline-none focus:border-blue-500 bg-white"
                              />
                              <button
                                onClick={() => saveGmapsLink(r)}
                                disabled={gmapsSaving || !gmapsLink.trim()}
                                className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition flex-none">
                                {gmapsSaving ? 'Đang tìm ranh giới…' : 'Lấy ranh giới'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'manual' && (
            <div className="grid grid-cols-2 gap-3 max-w-lg">
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tỉnh/Thành (sau sáp nhập) *</label>
                <select value={form.province_new} onChange={e => setForm(f => ({ ...f, province_new: e.target.value, province_old: undefined }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {FOCUS_PROVINCES.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tỉnh cũ (tuỳ chọn — để đối chiếu)</label>
                <select value={form.province_old ?? ''} onChange={e => setForm(f => ({ ...f, province_old: e.target.value || undefined }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">— Không chọn —</option>
                  {currentOldNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tên Xã/Phường *</label>
                <input value={form.commune_name} onChange={e => setForm(f => ({ ...f, commune_name: e.target.value }))}
                  placeholder="Phường Bến Nghé" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Dân số (người) *</label>
                <input type="number" value={form.population || ''} onChange={e => setForm(f => ({ ...f, population: Number(e.target.value) }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Diện tích (km²) *</label>
                <input type="number" value={form.area_km2 || ''} onChange={e => setForm(f => ({ ...f, area_km2: Number(e.target.value) }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Lat (tuỳ chọn, để hiện trên bản đồ)</label>
                <input type="number" value={form.lat ?? ''} onChange={e => setForm(f => ({ ...f, lat: e.target.value ? Number(e.target.value) : undefined }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Lng (tuỳ chọn)</label>
                <input type="number" value={form.lng ?? ''} onChange={e => setForm(f => ({ ...f, lng: e.target.value ? Number(e.target.value) : undefined }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="col-span-2">
                <button onClick={submitManual} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
                  <Plus size={13} /> {saving ? 'Đang lưu…' : 'Thêm xã/phường'}
                </button>
              </div>
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-3">
              <div className="text-[12px] text-[#666] leading-relaxed bg-[#F9F9F7] border border-[#F0EEE9] rounded-lg p-3">
                Chuẩn bị file <b>CSV hoặc JSON</b> gồm các cột: <code>province_new, commune_name, population, area_km2</code> (bắt buộc) và{' '}
                <code>province_old, lat, lng</code> (tuỳ chọn). Có thể nhờ AI tổng hợp toàn bộ xã/phường của 1 tỉnh theo đúng cấu trúc này rồi tải file lên đây.
                <button onClick={downloadTemplate} className="ml-2 inline-flex items-center gap-1 text-blue-700 font-medium hover:underline">
                  <Download size={11} /> Tải file mẫu CSV
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select value={importProvince} onChange={e => setImportProvince(e.target.value)}
                  className="text-[12px] px-2 py-1.5 border border-[#D8D6D0] rounded-lg bg-white outline-none">
                  {FOCUS_PROVINCES.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                <span className="text-[11px] text-[#999]">dùng khi dòng dữ liệu không tự ghi province_new</span>
              </div>

              <label className="flex items-center gap-2 text-[12px] text-[#333]">
                <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} />
                <span>
                  Xoá & thay mới toàn bộ tỉnh đã chọn
                  <span className="text-red-600 font-medium"> (mất cả ranh giới + toạ độ đã sinh)</span>
                  {' '}— bỏ tick để <b>cập nhật dân số nhưng giữ nguyên ranh giới</b> (khuyến nghị)
                </span>
              </label>

              <div className="flex items-center gap-2">
                <button onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#D8D6D0] hover:bg-gray-50 transition">
                  <Upload size={12} /> Chọn file (.csv/.json)
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,.json" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onFilePicked(f); }} />
                <span className="text-[11.5px] text-[#888]">{importFilename !== 'paste.json' ? importFilename : 'hoặc dán nội dung bên dưới'}</span>
              </div>

              <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={8}
                placeholder='Dán CSV hoặc JSON tại đây, ví dụ JSON: [{"province_new":"Tỉnh Tây Ninh","commune_name":"Phường Tân An","population":45000,"area_km2":12.5}]'
                className="w-full text-[11.5px] font-mono px-2.5 py-2 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />

              <button onClick={runPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#D8D6D0] hover:bg-gray-50 transition">
                Xem trước dữ liệu
              </button>

              {preview && (
                <div className="border border-[#F0EEE9] rounded-lg p-3 space-y-1.5">
                  <div className="text-[12.5px] font-medium text-[#222]">
                    Hợp lệ: <span className="text-emerald-600">{preview.rows.length} dòng</span>
                    {preview.errors.length > 0 && <span className="text-red-600"> · Lỗi: {preview.errors.length} dòng</span>}
                  </div>
                  {preview.errors.length > 0 && (
                    <ul className="text-[11px] text-red-600 list-disc pl-4 max-h-24 overflow-y-auto">
                      {preview.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                  {preview.rows.length > 0 && (
                    <button onClick={confirmImport} disabled={importing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
                      {importing ? 'Đang import…' : `Xác nhận import ${preview.rows.length} dòng`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
