// Tab Kế hoạch: thông tin dự án + phí, nhà máy (chi nhánh phụ trách), vị trí (JD), bảng chỉ tiêu.
import { useMemo, useState } from 'react';
import { Briefcase, Copy, Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import { copyText } from '../../lib/clipboard';
import { deleteProject, deleteSite, errText, saveSite } from '../../lib/recruit/api';
import { jobPostText, salaryText } from '../../lib/recruit/jobPost';
import { monthLabel } from '../../lib/recruit/plan';
import { EMPLOYMENT_LABEL } from '../../lib/recruit/types';
import type { RecruitPosition, RecruitSite } from '../../lib/recruit/types';
import { compareVnName } from '../../lib/vnName';
import { nameOf, useRecruit } from './context';
import ProjectForm, { feeSummary } from './ProjectForm';
import PositionSheet from './PositionSheet';
import TargetsEditor from './TargetsEditor';
import SharePanel from './SharePanel';
import { applyUrl } from '../../lib/recruit/publicLink';
import { ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, PageTitle, Panel, Quiet, ROUND_ICON, Row, SHEET_FOOTER, Sheet, inputCls, sectionCls } from './ui';

export default function PlanTab() {
  const { project, creating, setCreating, setProjectId, clients, reload, toast, canEdit } = useRecruit();
  const [editing, setEditing] = useState(false);

  if (creating || !project) {
    if (!canEdit) return <Quiet>Chưa có dự án tuyển dụng nào.</Quiet>;
    return (
      <div className="space-y-4">
        <PageTitle eyebrow="Tuyển dụng" title="Dự án tuyển dụng mới"
          subtitle="Mỗi dự án = 1 đợt tuyển của 1 khách (VD Co-Herent 11/2026–04/2027). Sau khi tạo, thêm nhà máy, vị trí và bảng chỉ tiêu." />
        <ProjectForm project={null} onDone={p => setProjectId(p.id)} onCancel={project ? () => setCreating(false) : undefined} />
      </div>
    );
  }

  const removeProject = async () => {
    if (!confirm(`Xoá dự án “${project.name}”?\n\nDự án bị ẩn khỏi danh sách (xoá mềm). Kho ứng viên vẫn giữ nguyên.`)) return;
    try {
      await deleteProject(project.id);
      setProjectId('');
      await reload();
      toast('Đã xoá dự án');
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle eyebrow="Kế hoạch tuyển dụng" title={project.name}
        subtitle={[nameOf(clients, project.client_id), project.contact_name && `đầu mối ${project.contact_name}`,
          project.period_from && `${monthLabel(project.period_from)}${project.period_to ? ` – ${monthLabel(project.period_to)}` : ''}`].filter(Boolean).join(' · ')}
        actions={canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className={PILL_GRAY}><Pencil size={14} /> Sửa dự án</button>
        ) : undefined} />

      {editing ? (
        <ProjectForm project={project} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <div className="grid md:grid-cols-3 gap-3">
          <Info label="Phí giới thiệu" value={feeSummary(project.fee)} />
          <Info label="Phí người lao động" value={project.no_worker_fee ? 'Không thu (in lên tin tuyển)' : 'Chưa cam kết'} />
          <Info label="Ghi chú" value={project.notes || '—'} />
        </div>
      )}

      <SitesPanel />
      <PositionsPanel />
      <TargetsEditor />
      <SharePanel />

      {canEdit && !editing && (
        <div className="pt-2 flex justify-end">
          <button type="button" onClick={removeProject} className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá dự án</button>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-[14px] px-4 py-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#86868B]">{label}</div>
      <div className="text-[13.5px] text-[#1D1D1F] mt-0.5 whitespace-pre-line">{value}</div>
    </div>
  );
}

// ── Nhà máy ────────────────────────────────────────────────────────────────
function SitesPanel() {
  const { sites, branches, clients, canEdit } = useRecruit();
  const [editing, setEditing] = useState<RecruitSite | 'new' | null>(null);
  return (
    <Panel title="Nhà máy / địa điểm làm việc" count={sites.length} icon={<Factory size={16} className="text-[#0066CC]" />}
      meta="Mỗi nhà máy gắn 1 chi nhánh phụ trách tuyển — chỉ tiêu và kết quả tính riêng theo từng nơi."
      action={canEdit ? <button type="button" onClick={() => setEditing('new')} className={PILL_TINTED}><Plus size={14} /> Thêm</button> : undefined}>
      {sites.length === 0 ? <Quiet>Chưa có nhà máy. VD Co-Herent: VSIP 1, VSIP 3, NT2.</Quiet> : (
        <div className="pb-1">
          {sites.map((s, i) => (
            <Row key={s.id} first={i === 0} inset={0} onClick={canEdit ? () => setEditing(s) : undefined}>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[#1D1D1F]">{s.name}{s.zone_name && s.zone_name !== s.name && <span className="text-[#86868B] font-normal"> · {s.zone_name}</span>}</div>
                <div className="text-[12px] text-[#86868B] truncate">
                  {[nameOf(branches, s.branch_id) || 'Chưa gắn chi nhánh', nameOf(clients, s.client_id), s.address].filter(Boolean).join(' · ')}
                </div>
              </div>
              {canEdit && <Pencil size={14} className="text-[#C7C7CC] shrink-0" />}
            </Row>
          ))}
        </div>
      )}
      {editing && <SiteSheet site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function SiteSheet({ site, onClose }: { site: RecruitSite | null; onClose: () => void }) {
  const { project, sites, branches, clients, zones, reload, toast } = useRecruit();
  const [name, setName] = useState(site?.name ?? '');
  const [zone, setZone] = useState(site?.zone_name ?? '');
  const [branchId, setBranchId] = useState(site?.branch_id ?? '');
  const [clientId, setClientId] = useState(site?.client_id ?? project?.client_id ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clientOptions = useMemo(() => clients.filter(c => !c.archived_at).sort((a, b) => compareVnName(a.name, b.name)), [clients]);
  if (!project) return null;

  const submit = async () => {
    if (!name.trim()) { setError('Nhập tên nhà máy'); return; }
    setBusy(true);
    setError('');
    const z = zones.find(x => x.name === zone);
    try {
      await saveSite({
        ...(site ? { id: site.id } : { project_id: project.id, sort_order: sites.length }),
        name: name.trim(), zone_name: zone.trim(), branch_id: branchId || null, client_id: clientId || null, address: address.trim(),
        ...(z && (!site || site.zone_name !== zone) ? { lat: z.lat, lng: z.lng } : {}),
      });
      await reload();
      toast(site ? 'Đã lưu nhà máy' : 'Đã thêm nhà máy');
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!site || !confirm(`Xoá nhà máy “${site.name}”?`)) return;
    setBusy(true);
    try {
      await deleteSite(site.id);
      await reload();
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label={site ? 'Sửa nhà máy' : 'Thêm nhà máy'} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{site ? site.name : 'Thêm nhà máy / địa điểm'}</h2>
      <section className={`${sectionCls} mt-4`}>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Tên (như trong bảng chỉ tiêu) *">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: VSIP 3" className={inputCls} autoFocus={!site} />
          </Field>
          <Field label="Khu công nghiệp" hint="Chọn từ danh mục Thị trường để có toạ độ bản đồ">
            <input value={zone} onChange={e => setZone(e.target.value)} list="recruit-zone-list" placeholder="VD: KCN VSIP 3" className={inputCls} />
            <datalist id="recruit-zone-list">{zones.map(z => <option key={z.id} value={z.name} />)}</datalist>
          </Field>
          <Field label="Chi nhánh phụ trách tuyển">
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className={inputCls}>
              <option value="">— Chưa gắn —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Thẻ khách hàng của nhà máy" hint="Doanh thu phí của nhà máy này ghi vào P&L của thẻ này">
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls}>
              <option value="">— Theo dự án —</option>
              {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Địa chỉ" className="md:col-span-2">
            <input value={address} onChange={e => setAddress(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </section>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        {site && <button type="button" onClick={remove} disabled={busy} className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá</button>}
        <div className="flex-1" />
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </Sheet>
  );
}

// ── Vị trí ─────────────────────────────────────────────────────────────────
function PositionsPanel() {
  const { project, positions, sites, toast, canEdit } = useRecruit();
  const [editing, setEditing] = useState<RecruitPosition | 'new' | null>(null);
  if (!project) return null;
  const copyPost = async (p: RecruitPosition) =>
    toast((await copyText(jobPostText({ project, position: p, sites, applyUrl: project.public_open && project.public_code ? applyUrl(project.public_code) : undefined }))) ? `Đã chép tin “${p.title}”` : 'Không chép được');

  return (
    <Panel title="Vị trí tuyển (JD)" count={positions.length} icon={<Briefcase size={16} className="text-[#8944AB]" />}
      meta="Nhóm A kỹ thuật viên · B công nhân sản xuất · C cần khảo sát. Mỗi vị trí sinh được tin tuyển dụng để đăng."
      action={canEdit ? <button type="button" onClick={() => setEditing('new')} className={PILL_TINTED}><Plus size={14} /> Thêm</button> : undefined}>
      {positions.length === 0 ? <Quiet>Chưa có vị trí. Thêm theo nhóm A/B/C trong file khách gửi.</Quiet> : (
        <div className="pb-1">
          {positions.map((p, i) => (
            <Row key={p.id} first={i === 0} inset={0} onClick={() => setEditing(p)}>
              <span className={`shrink-0 w-8 h-8 rounded-[9px] flex items-center justify-center text-[13px] font-bold ${p.group_code === 'A' ? TINT.indigo : p.group_code === 'B' ? TINT.teal : p.group_code === 'C' ? TINT.orange : TINT.gray}`}>
                {p.group_code === 'other' ? '·' : p.group_code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[#1D1D1F] truncate">
                  {p.title}
                  {!p.confirmed && <span className={`ml-1.5 text-[11px] px-2 py-0.5 rounded-full ${TINT.orange}`}>khảo sát</span>}
                  {!p.is_open && <span className={`ml-1.5 text-[11px] px-2 py-0.5 rounded-full ${TINT.gray}`}>đã đóng</span>}
                </div>
                <div className="text-[12px] text-[#86868B] truncate">
                  {[EMPLOYMENT_LABEL[p.employment_type], salaryText(p),
                    p.site_ids.length ? p.site_ids.map(id => nameOf(sites, id)).filter(Boolean).join(', ') : 'Mọi nhà máy'].join(' · ')}
                </div>
              </div>
              <span role="button" tabIndex={0} title="Chép tin tuyển dụng" aria-label={`Chép tin tuyển dụng ${p.title}`}
                onClick={e => { e.stopPropagation(); copyPost(p); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); copyPost(p); } }}
                className={ROUND_ICON}><Copy size={15} /></span>
            </Row>
          ))}
        </div>
      )}
      {editing && <PositionSheet position={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
