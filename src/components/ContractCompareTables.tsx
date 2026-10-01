import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, Download, Pencil, X, Copy, ClipboardPaste } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Row { label: string; cells: string[]; change: string }
interface Tbl { id: string; client_id: string; title: string; columns: string[]; rows: Row[]; kind?: 'table' | 'text'; html?: string }

const CHANGE_HEADER = 'Mức chênh lệch / Thay đổi'
const inp = 'w-full text-[12px] px-2 py-1 rounded border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400'

function csvCell(v: string) { return `"${(v ?? '').replace(/"/g, '""')}"` }


/** Đọc bảng từ clipboard: ưu tiên <table> HTML (Gemini/Docs/Sheets/Excel/web), rồi tới Markdown |…|, rồi text phân tab. */
function readGrid(dt: DataTransfer | null): string[][] | null {
  if (!dt) return null
  const html = dt.getData('text/html')
  if (html && /<table/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const tb = doc.querySelector('table')
    if (tb) {
      tb.querySelectorAll('sup, button, style, script').forEach(n => n.remove())
      const g = [...tb.querySelectorAll('tr')].map(tr =>
        [...tr.querySelectorAll('th,td')].map(c => ((c as HTMLElement).innerText ?? c.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim()))
      if (g.length) return g
    }
  }
  const text = dt.getData('text/plain')
  if (!text) return null
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
  if (lines.length && lines.filter(l => l.trim().startsWith('|')).length >= 2) {
    return lines.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
      .map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()))
  }
  return lines.map(l => l.split('\t'))
}

/** Dựng bảng từ lưới: dòng đầu = tiêu đề (bỏ ô đầu "Hạng mục"), cột đầu = hạng mục, cột cuối = chênh lệch. */
/** Gemini hay dính số chú thích sau chữ ("VNĐ67", "ngày8"): bỏ 1–3 chữ số đứng SÁT sau chữ cái / ) / dấu /. */
function stripCite(v: string): string {
  return v.replace(/(?<=[A-Za-zÀ-ỹĐđ)/])\d{1,3}(?=\s|$)/g, '')
}

function gridToTable(g: string[][]): { columns: string[]; rows: Row[] } | null {
  if (g.length < 1 || g[0].length < 2) return null
  const w = Math.max(...g.map(r => r.length))
  const hasChange = w >= 3
  const nVal = hasChange ? w - 2 : w - 1
  const head = g[0]
  const columns = Array.from({ length: nVal }, (_, i) => head[i + 1] || `Cột ${i + 1}`)
  const rows = g.slice(1).map(r => ({
    label: r[0] ?? '',
    cells: Array.from({ length: nVal }, (_, i) => r[i + 1] ?? ''),
    change: hasChange ? (r[w - 1] ?? '') : '',
  }))
  return { columns, rows }
}

const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'DIV', 'SPAN', 'BLOCKQUOTE', 'HR'])
const DROP = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'SUP', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'IMG', 'SVG'])

/** Lọc HTML dán vào: giữ cấu trúc (đậm/nghiêng/gạch chân, danh sách, tiêu đề, bảng, link), bỏ style/script/thuộc tính lạ. */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '')
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const el = node as HTMLElement
    if (DROP.has(el.tagName.toUpperCase())) return null
    // Gemini/Docs hay bọc chữ đậm bằng <span style="font-weight:700"> — quy về <b>
    const st = (el.getAttribute('style') || '').toLowerCase()
    let tag = el.tagName.toUpperCase()
    const kids = [...el.childNodes].map(walk).filter(Boolean) as Node[]
    if (!ALLOWED.has(tag)) { const f = document.createDocumentFragment(); kids.forEach(k => f.appendChild(k)); return f }
    if (tag === 'SPAN' || tag === 'DIV') {
      let inner: Node[] = kids
      const wrap = (t: string) => { const w = document.createElement(t); inner.forEach(k => w.appendChild(k)); inner = [w] }
      if (/font-weight:\s*(bold|[6-9]00)/.test(st)) wrap('b')
      if (/font-style:\s*italic/.test(st)) wrap('i')
      if (/text-decoration[^;]*underline/.test(st)) wrap('u')
      if (tag === 'DIV') { const d = document.createElement('div'); inner.forEach(k => d.appendChild(k)); return d }
      const f = document.createDocumentFragment(); inner.forEach(k => f.appendChild(k)); return f
    }
    const out = document.createElement(tag.toLowerCase())
    if (tag === 'A') {
      const h = el.getAttribute('href') || ''
      if (/^(https?:|mailto:)/i.test(h)) { out.setAttribute('href', h); out.setAttribute('target', '_blank'); out.setAttribute('rel', 'noreferrer') }
    }
    if ((tag === 'TD' || tag === 'TH')) {
      for (const a of ['colspan', 'rowspan']) { const v = el.getAttribute(a); if (v && /^\d+$/.test(v)) out.setAttribute(a, v) }
    }
    kids.forEach(k => out.appendChild(k))
    return out
  }
  const root = document.createElement('div')
  ;[...doc.body.childNodes].map(walk).forEach(n => { if (n) root.appendChild(n) })
  return root.innerHTML
}

const RICH_CSS = `
.cct-rich{font-size:12.5px;line-height:1.55;color:#222;outline:none;word-break:break-word}
.cct-rich h1{font-size:16px;font-weight:700;margin:8px 0 4px}.cct-rich h2{font-size:14.5px;font-weight:700;margin:8px 0 4px}
.cct-rich h3,.cct-rich h4{font-size:13px;font-weight:700;margin:6px 0 3px}
.cct-rich p,.cct-rich div{margin:0 0 4px}
.cct-rich ul{list-style:disc;padding-left:20px;margin:2px 0 6px}.cct-rich ol{list-style:decimal;padding-left:20px;margin:2px 0 6px}
.cct-rich a{color:#2563eb;text-decoration:underline}
.cct-rich table{border-collapse:collapse;margin:6px 0;max-width:100%}
.cct-rich th,.cct-rich td{border:1px solid #E8E7E2;padding:5px 8px;vertical-align:top;text-align:left}
.cct-rich th{background:#F9F9F7;font-weight:600}
.cct-rich blockquote{border-left:3px solid #ddd;padding-left:8px;color:#555;margin:4px 0}
.cct-rich:empty:before{content:attr(data-ph);color:#bbb}
`

function RichBlock({ t, onSaved, onDelete, toast }: { t: Tbl; onSaved: (t: Tbl) => void; onDelete: (t: Tbl) => void; toast: (m: string) => void }) {
  const [editing, setEditing] = useState(!t.html)
  const [title, setTitle] = useState(t.title)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(t.html || '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const cmd = (c: string, v?: string) => { ref.current?.focus(); document.execCommand(c, false, v) }

  function onPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData('text/html')
    e.preventDefault()
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html))
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  async function save() {
    setSaving(true)
    const html = sanitizeHtml(ref.current?.innerHTML || '')
    const nt = title.trim() || 'Nội dung Hợp đồng / Phụ lục'
    const { error } = await supabase.from('client_contract_tables').update({ title: nt, html, updated_at: new Date().toISOString() }).eq('id', t.id)
    setSaving(false)
    if (error) { toast('Lỗi lưu: ' + error.message); return }
    onSaved({ ...t, title: nt, html }); setEditing(false); toast('Đã lưu nội dung')
  }

  async function copy() {
    const html = sanitizeHtml(ref.current?.innerHTML || t.html || '')
    const text = ref.current?.innerText || ''
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
      toast('Đã sao chép nội dung kèm định dạng')
    } catch { try { await navigator.clipboard.writeText(text); toast('Đã sao chép (text thường)') } catch { toast('Trình duyệt chặn sao chép') } }
  }

  const tb = 'px-2 py-0.5 rounded border border-[#E8E7E2] text-[11.5px] text-[#444] hover:bg-white bg-[#FAFAF8]'
  return (
    <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
      <style>{RICH_CSS}</style>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2]">
        {editing
          ? <input className={inp + ' font-semibold'} value={title} onChange={e => setTitle(e.target.value)} />
          : <span className="text-[12.5px] font-semibold text-[#111] flex-1">{t.title}</span>}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {editing ? (
            <>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] bg-blue-600 text-white disabled:opacity-50"><Save size={12} /> {saving ? 'Đang lưu…' : 'Lưu'}</button>
              {t.html && <button onClick={() => { setTitle(t.title); setEditing(false) }} className="px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666]"><X size={12} /></button>}
            </>
          ) : (
            <>
              <button onClick={copy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><Copy size={12} /> Sao chép</button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><Pencil size={12} /> Sửa</button>
              <button onClick={() => onDelete(t)} title="Xoá khối" className="px-2 py-1 rounded-md border border-[#E8E7E2] text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex items-center gap-1 flex-wrap px-3 py-1.5 border-b border-[#F0EFEB]">
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('bold') }}><b>B</b></button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('italic') }}><i>I</i></button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('underline') }}><u>U</u></button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('formatBlock', 'h3') }}>Tiêu đề</button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('formatBlock', 'p') }}>Đoạn</button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('insertUnorderedList') }}>• Danh sách</button>
          <button type="button" className={tb} onMouseDown={e => { e.preventDefault(); cmd('insertOrderedList') }}>1. Đánh số</button>
          <span className="text-[10.5px] text-[#aaa] ml-1">Dán từ Gemini/Docs/Word giữ nguyên đậm, danh sách, bảng…</span>
        </div>
      )}
      <div className="px-3 py-2.5 overflow-x-auto">
        <div ref={ref} className="cct-rich min-h-[60px]" data-ph="Dán hoặc gõ nội dung (điều khoản, ghi chú, diễn giải thay đổi…)"
          contentEditable={editing} suppressContentEditableWarning onPaste={editing ? onPaste : undefined} />
      </div>
    </div>
  )
}

/** Bảng so sánh Hợp đồng / Phụ lục: hàng = hạng mục, cột = các mốc HĐ/Phụ lục, cột cuối = chênh lệch. */
export function ContractCompareTables({ clientId, taskId, orphansOnly, toast }: { clientId: string; taskId?: string; orphansOnly?: boolean; toast: (m: string) => void }) {
  const [tables, setTables] = useState<Tbl[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Tbl | null>(null)
  const [saving, setSaving] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [cleanCite, setCleanCite] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const base = supabase.from('client_contract_tables').select('*').eq('client_id', clientId)
    ;(taskId ? base.eq('task_id', taskId) : orphansOnly ? base.is('task_id', null) : base).order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) toast('Không tải được bảng (đã chạy migration 151 chưa?): ' + error.message)
        setTables((data || []) as Tbl[])
        setLoading(false)
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, taskId])

  async function createTable() {
    const { data, error } = await supabase.from('client_contract_tables').insert({
      client_id: clientId, task_id: taskId ?? null,
      title: 'Bảng thay đổi Hợp đồng / Phụ lục',
      columns: ['Năm 2025 (Phụ lục 01)', 'Năm 2026 (Phụ lục 02)'],
      rows: [{ label: '', cells: ['', ''], change: '' }],
    }).select().single()
    if (error || !data) { toast('Lỗi tạo bảng: ' + (error?.message || '')); return }
    setTables(p => [...p, data as Tbl]); setEditId(data.id); setDraft(data as Tbl)
  }

  async function createText() {
    const { data, error } = await supabase.from('client_contract_tables').insert({
      client_id: clientId, task_id: taskId ?? null, kind: 'text', title: 'Nội dung Hợp đồng / Phụ lục', html: '', columns: [], rows: [],
    }).select().single()
    if (error || !data) { toast('Lỗi tạo khối (đã chạy migration 152 chưa?): ' + (error?.message || '')); return }
    setTables(p => [...p, data as Tbl])
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    const rows = draft.rows.filter(r => r.label.trim() || r.change.trim() || r.cells.some(c => c.trim()))
    const { error } = await supabase.from('client_contract_tables')
      .update({ title: draft.title.trim() || 'Bảng thay đổi', columns: draft.columns, rows, updated_at: new Date().toISOString() })
      .eq('id', draft.id)
    setSaving(false)
    if (error) { toast('Lỗi lưu: ' + error.message); return }
    setTables(p => p.map(t => t.id === draft.id ? { ...draft, rows } : t))
    setEditId(null); setDraft(null); toast('Đã lưu bảng')
  }

  async function remove(t: Tbl) {
    if (!confirm(`XOÁ VĨNH VIỄN ${t.kind === 'text' ? 'khối nội dung' : 'bảng'} "${t.title}"? Không khôi phục được.`)) return
    const { error } = await supabase.from('client_contract_tables').delete().eq('id', t.id)
    if (error) { toast('Lỗi xoá: ' + error.message); return }
    setTables(p => p.filter(x => x.id !== t.id))
    if (editId === t.id) { setEditId(null); setDraft(null) }
  }

  function exportCsv(t: Tbl) {
    const lines = [['Hạng mục', ...t.columns, CHANGE_HEADER], ...t.rows.map(r => [r.label, ...t.columns.map((_, i) => r.cells[i] ?? ''), r.change])]
      .map(l => l.map(csvCell).join(','))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${t.title}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const upd = (fn: (d: Tbl) => Tbl) => setDraft(d => d ? fn(d) : d)

  // Sao chép cả bảng: HTML (dán vào Google Docs/Word/Sheets/Gemini giữ nguyên dạng bảng) + text phân tab (Excel/Sheets).
  async function copyTable(t: Tbl) {
    const grid = [['Hạng mục', ...t.columns, CHANGE_HEADER], ...t.rows.map(r => [r.label, ...t.columns.map((_, i) => r.cells[i] ?? ''), r.change])]
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    const html = '<table border="1" cellspacing="0" cellpadding="4">' + grid.map((r, i) =>
      '<tr>' + r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>'
    const text = grid.map(r => r.map(c => c.replace(/[\t\n]+/g, ' ')).join('\t')).join('\n')
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      toast('Đã sao chép cả bảng — dán vào Gemini / Docs / Sheets / Excel')
    } catch {
      try { await navigator.clipboard.writeText(text); toast('Đã sao chép bảng (dạng text phân tab)') }
      catch { toast('Trình duyệt chặn sao chép — dùng nút Xuất (CSV)') }
    }
  }

  // Dán cả bảng từ nơi khác → thay toàn bộ nội dung bảng đang sửa.
  function applyPastedTable(dt: DataTransfer | null) {
    const raw = readGrid(dt)
    const t = gridToTable(cleanCite && raw ? raw.map(r => r.map(stripCite)) : raw ?? [])
    if (!t) { toast('Không nhận ra bảng trong nội dung vừa dán (cần ít nhất 2 cột)'); return }
    upd(x => ({ ...x, columns: t.columns, rows: t.rows }))
    setPasteOpen(false); toast(`Đã dán bảng: ${t.rows.length} hạng mục × ${t.columns.length} cột — kiểm tra rồi bấm Lưu`)
  }

  // Dán nhiều ô (từ Excel/Sheets/Gemini) vào 1 ô: trải ra các ô kế bên, tự thêm dòng nếu thiếu.
  function pasteIntoCell(e: React.ClipboardEvent, ri: number, col: number) {
    const g = readGrid(e.clipboardData)
    if (!g || (g.length === 1 && g[0].length === 1)) return // 1 ô → để trình duyệt dán bình thường
    e.preventDefault()
    upd(x => {
      const nc = x.columns.length
      const rows = x.rows.map(r => ({ ...r, cells: [...r.cells] }))
      g.forEach((gr, dr) => {
        const rr = ri + dr
        while (rows.length <= rr) rows.push({ label: '', cells: x.columns.map(() => ''), change: '' })
        gr.forEach((v, dc) => {
          const c = col + dc
          if (c === 0) rows[rr].label = v
          else if (c <= nc) rows[rr].cells[c - 1] = v
          else if (c === nc + 1) rows[rr].change = v
        })
      })
      return { ...x, rows }
    })
  }

  if (orphansOnly && !loading && tables.length === 0) return null
  return (
    <div className="mt-3 space-y-3">
      {orphansOnly && tables.length > 0 && <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Các bảng/nội dung dưới đây chưa gắn với việc nào (tạo trước đây). Chạy migration 153 để tự gắn vào việc Hợp đồng/Phụ lục của khách.</div>}
      {loading ? <div className="text-[11px] text-[#bbb] text-center py-3">Đang tải…</div> : tables.map(t => {
        if (t.kind === 'text') return <RichBlock key={t.id} t={t} toast={toast} onDelete={remove} onSaved={nt => setTables(p => p.map(x => x.id === nt.id ? nt : x))} />
        const editing = editId === t.id && draft
        const d = editing ? draft! : t
        return (
          <div key={t.id} className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2]">
              {editing
                ? <input className={inp + ' font-semibold'} value={d.title} onChange={e => upd(x => ({ ...x, title: e.target.value }))} />
                : <span className="text-[12.5px] font-semibold text-[#111] flex-1">{t.title}</span>}
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {editing ? (
                  <>
                    <button onClick={() => setPasteOpen(o => !o)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><ClipboardPaste size={12} /> Dán cả bảng</button>
                    <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] bg-blue-600 text-white disabled:opacity-50"><Save size={12} /> {saving ? 'Đang lưu…' : 'Lưu'}</button>
                    <button onClick={() => { setEditId(null); setDraft(null) }} className="px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666]"><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => copyTable(t)} title="Sao chép cả bảng để dán sang Gemini / Docs / Sheets" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><Copy size={12} /> Sao chép</button>
                    <button onClick={() => exportCsv(t)} title="Xuất sang Trang tính (CSV)" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><Download size={12} /> Xuất</button>
                    <button onClick={() => { setEditId(t.id); setDraft(JSON.parse(JSON.stringify(t))) }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E8E7E2] text-[11.5px] text-[#555] hover:bg-white"><Pencil size={12} /> Sửa</button>
                    <button onClick={() => remove(t)} title="Xoá bảng" className="px-2 py-1 rounded-md border border-[#E8E7E2] text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
                  </>
                )}
              </div>
            </div>
            {editing && pasteOpen && (
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-200">
                <div className="text-[11px] text-amber-800 mb-1">Copy bảng từ Gemini / Google Sheets / Excel / Word rồi bấm vào ô dưới và dán (Ctrl/Cmd+V). Dòng đầu = tiêu đề cột, cột đầu = hạng mục, cột cuối = chênh lệch. <b>Sẽ thay toàn bộ nội dung bảng đang sửa.</b></div>
                <label className="flex items-center gap-1.5 text-[11px] text-amber-800 mb-1"><input type="checkbox" checked={cleanCite} onChange={e => setCleanCite(e.target.checked)} /> Xoá số chú thích dính cuối ô (VNĐ67 → VNĐ)</label>
                <textarea autoFocus rows={2} placeholder="Dán bảng vào đây…" className={inp}
                  onPaste={e => { e.preventDefault(); applyPastedTable(e.clipboardData) }} onChange={() => {}} value="" />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-[#F9F9F7]">
                    <th className="border border-[#E8E7E2] px-2.5 py-2 text-left font-medium text-[#555] min-w-[130px]">Hạng mục</th>
                    {d.columns.map((c, ci) => (
                      <th key={ci} className="border border-[#E8E7E2] px-2.5 py-2 text-left font-medium text-[#555] min-w-[160px] align-top">
                        {editing ? (
                          <div className="flex items-start gap-1">
                            <textarea rows={2} className={inp} value={c} onChange={e => upd(x => ({ ...x, columns: x.columns.map((v, i) => i === ci ? e.target.value : v) }))} />
                            {d.columns.length > 1 && (
                              <button title="Xoá cột" onClick={() => { if (confirm(`Xoá cột "${c}" và dữ liệu của cột này?`)) upd(x => ({ ...x, columns: x.columns.filter((_, i) => i !== ci), rows: x.rows.map(r => ({ ...r, cells: r.cells.filter((_, i) => i !== ci) })) })) }} className="text-red-400 hover:text-red-600 pt-1"><X size={12} /></button>
                            )}
                          </div>
                        ) : c}
                      </th>
                    ))}
                    <th className="border border-[#E8E7E2] px-2.5 py-2 text-left font-medium text-[#555] min-w-[160px]">
                      {CHANGE_HEADER}
                      {editing && <button onClick={() => upd(x => ({ ...x, columns: [...x.columns, `Phụ lục ${x.columns.length + 1}`], rows: x.rows.map(r => ({ ...r, cells: [...r.cells, ''] })) }))} className="ml-2 text-[11px] text-blue-600 hover:underline font-normal">+ Thêm cột</button>}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, ri) => (
                    <tr key={ri}>
                      <td className="border border-[#E8E7E2] px-2.5 py-2 font-semibold text-[#111] align-top">
                        {editing ? (
                          <div className="flex items-start gap-1">
                            <input className={inp} value={r.label} placeholder="VD: Lương cơ bản" onPaste={e => pasteIntoCell(e, ri, 0)} onChange={e => upd(x => ({ ...x, rows: x.rows.map((v, i) => i === ri ? { ...v, label: e.target.value } : v) }))} />
                            <button title="Xoá dòng" onClick={() => upd(x => ({ ...x, rows: x.rows.filter((_, i) => i !== ri) }))} className="text-red-400 hover:text-red-600 pt-1"><X size={12} /></button>
                          </div>
                        ) : r.label}
                      </td>
                      {d.columns.map((_, ci) => (
                        <td key={ci} className="border border-[#E8E7E2] px-2.5 py-2 text-[#222] align-top whitespace-pre-wrap">
                          {editing
                            ? <textarea rows={1} className={inp} onPaste={e => pasteIntoCell(e, ri, ci + 1)} value={r.cells[ci] ?? ''} onChange={e => upd(x => ({ ...x, rows: x.rows.map((v, i) => i === ri ? { ...v, cells: x.columns.map((_, k) => k === ci ? e.target.value : (v.cells[k] ?? '')) } : v) }))} />
                            : (r.cells[ci] ?? '')}
                        </td>
                      ))}
                      <td className="border border-[#E8E7E2] px-2.5 py-2 font-medium text-[#111] align-top whitespace-pre-wrap">
                        {editing
                          ? <textarea rows={1} className={inp} onPaste={e => pasteIntoCell(e, ri, d.columns.length + 1)} value={r.change} onChange={e => upd(x => ({ ...x, rows: x.rows.map((v, i) => i === ri ? { ...v, change: e.target.value } : v) }))} />
                          : r.change}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editing && (
              <div className="px-3 py-2 border-t border-[#E8E7E2]">
                <button onClick={() => upd(x => ({ ...x, rows: [...x.rows, { label: '', cells: x.columns.map(() => ''), change: '' }] }))} className="inline-flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline"><Plus size={12} /> Thêm hạng mục</button>
              </div>
            )}
          </div>
        )
      })}
      {!orphansOnly && <div className="flex gap-2 flex-wrap">
        <button onClick={createText} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-dashed border-gray-300 text-[#555] hover:bg-[#FAFAF8]">
          <Plus size={13} /> Thêm khối nội dung (văn bản)
        </button>
        <button onClick={createTable} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-dashed border-gray-300 text-[#555] hover:bg-[#FAFAF8]">
          <Plus size={13} /> Tạo bảng thay đổi Hợp đồng / Phụ lục
        </button>
      </div>}
    </div>
  )
}
