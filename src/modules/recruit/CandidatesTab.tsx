// Tab Ứng viên: kho hồ sơ dùng chung mọi dự án / chi nhánh — tìm người đang rảnh để giới thiệu tiếp.
import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, UserPlus, Users } from 'lucide-react';
import { FOCUS_PROVINCES } from '../../pages/market/populationData';
import { errText, listCandidates } from '../../lib/recruit/api';
import { formatPhone } from '../../lib/recruit/normalize';
import { EDUCATION_LABEL, EDUCATION_ORDER, SOURCE_CHANNELS } from '../../lib/recruit/types';
import type { CandidateListRow } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import CandidateSheet from './CandidateSheet';
import ImportSheet from './ImportSheet';
import QuickAddSheet from './QuickAddSheet';
import { ErrorBanner, MoreButton, PILL_GRAY, PILL_PRIMARY, PageTitle, PillSelect, Quiet, Row, SearchField, Spinner, StageBadge, Switch, fmtDate, fmtNum } from './ui';

const PAGE = 100;

export default function CandidatesTab() {
  const { boot, clients, canEdit, reload } = useRecruit();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [education, setEducation] = useState('');
  const [province, setProvince] = useState('');
  const [source, setSource] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [blackOnly, setBlackOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<{ total: number; rows: CandidateListRow[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setLimit(PAGE); }, [qd, education, province, source, freeOnly, blackOnly]);

  const load = useCallback(async () => {
    try {
      setData(await listCandidates({
        q: qd, education: education || undefined, province: province || undefined, source_channel: source || undefined,
        free_only: freeOnly, blacklisted: blackOnly ? true : null, limit,
      }));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [qd, education, province, source, freeOnly, blackOnly, limit]);
  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); reload(); };
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Kho ứng viên" title="Ứng viên"
        subtitle={`${fmtNum(boot.candidate_count)} hồ sơ dùng chung mọi dự án · chống trùng theo SĐT / CCCD`}
        actions={canEdit ? (<>
          <button type="button" onClick={() => setImporting(true)} className={PILL_GRAY}><FileSpreadsheet size={14} /> Nhập Excel</button>
          <button type="button" onClick={() => setAdding(true)} className={PILL_PRIMARY}><UserPlus size={14} /> Ứng viên</button>
        </>) : undefined} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Tìm tên (không dấu cũng được), SĐT, CCCD…" className="w-full md:w-[300px]" />
        <PillSelect label="Trình độ" value={education} active={!!education} onChange={setEducation}>
          <option value="">Mọi trình độ</option>
          {EDUCATION_ORDER.map(k => <option key={k} value={k}>{EDUCATION_LABEL[k]}</option>)}
        </PillSelect>
        <PillSelect label="Tỉnh" value={province} active={!!province} onChange={setProvince}>
          <option value="">Mọi tỉnh</option>
          {FOCUS_PROVINCES.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </PillSelect>
        <PillSelect label="Nguồn" value={source} active={!!source} onChange={setSource}>
          <option value="">Mọi nguồn</option>
          {SOURCE_CHANNELS.map(s => <option key={s} value={s}>{s}</option>)}
        </PillSelect>
        <Switch checked={freeOnly} onChange={setFreeOnly} label="Đang rảnh" />
        <Switch checked={blackOnly} onChange={setBlackOnly} label="Danh sách đen" />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="bg-white rounded-[18px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.08)] px-3 md:px-4 py-1">
        {!data && !error && <div className="py-10 flex justify-center"><Spinner /></div>}
        {data && rows.length === 0 && <Quiet icon={<Users size={18} />}>Không có hồ sơ phù hợp.</Quiet>}
        {rows.map((c, i) => (
          <Row key={c.id} first={i === 0} inset={0} onClick={() => setOpen(c.id)}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-[#1D1D1F] truncate">
                {c.full_name}
                {c.blacklisted && <span className="ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded-full bg-[#1D1D1F] text-white align-middle">DS đen</span>}
                <span className="font-normal text-[#86868B]"> · {formatPhone(c.phone)}{c.birth_year ? ` · ${c.birth_year}` : ''}</span>
              </div>
              <div className="text-[12px] text-[#86868B] truncate">
                {[c.education && EDUCATION_LABEL[c.education as keyof typeof EDUCATION_LABEL], [c.commune, c.province].filter(Boolean).join(', '),
                  c.source_channel, `thêm ${fmtDate(c.created_at)}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            {c.last_app ? (
              <div className="hidden md:flex flex-col items-end gap-0.5 shrink-0 max-w-[40%]">
                <StageBadge stage={c.last_app.stage} />
                <span className="text-[11.5px] text-[#86868B] truncate max-w-full">{nameOf(boot.projects, c.last_app.project_id) || nameOf(clients, c.last_app.client_id)}{c.app_count > 1 ? ` · ${c.app_count} lần` : ''}</span>
              </div>
            ) : <span className="text-[12px] text-[#AEAEB2] shrink-0">Chưa ứng tuyển</span>}
          </Row>
        ))}
        {data && data.total > rows.length && <MoreButton onClick={() => setLimit(l => l + PAGE)}>Hiện thêm (còn {fmtNum(data.total - rows.length)})</MoreButton>}
      </div>

      {open && <CandidateSheet candidateId={open} onClose={() => setOpen(null)} onChanged={load} />}
      {adding && <QuickAddSheet poolOnly onClose={() => setAdding(false)} onDone={changed} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} onDone={changed} />}
    </div>
  );
}
