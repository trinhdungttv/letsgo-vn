// Chế độ Dàn ý (như "Outliner" của XMind): cùng dữ liệu với sơ đồ, gõ dạng danh sách thụt lề.
// Enter = dòng mới cùng cấp · Tab / Shift+Tab = thụt vào / ra · Backspace ở dòng trống = xoá dòng · ↑↓ = chuyển dòng.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  addSibling, findTopic, moveTopics, removeTopics, setText, toggleCollapse,
} from '../../../lib/quickNotes/mindmap/model';
import type { MindTheme } from '../../../lib/quickNotes/mindmap/themes';
import type { MindMapDoc, MindTopic } from '../../../lib/quickNotes/mindmap/types';
import { MarkerIcon } from './MarkerIcon';

interface Row { t: MindTopic; depth: number; color: string; floating: boolean }

function rowsOf(doc: MindMapDoc, theme: MindTheme): Row[] {
  const rows: Row[] = [];
  const rainbow = doc.rainbow ?? theme.rainbow;
  const go = (t: MindTopic, depth: number, color: string, floating: boolean) => {
    const c = t.style?.branch ?? color;
    rows.push({ t, depth, color: c, floating });
    if (!t.collapsed) t.children.forEach(k => go(k, depth + 1, c, floating));
  };
  doc.root.children.forEach((k, i) => go(k, 0, rainbow ? theme.branch[i % theme.branch.length] : theme.mono, false));
  doc.floating.forEach(f => go(f, 0, theme.mono, true));
  return rows;
}

function AutoText({ value, onChange, onKeyDown, onFocus, inputRef, className, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  className: string;
  placeholder?: string;
}) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!el.current) return;
    el.current.style.height = '0px';
    el.current.style.height = `${el.current.scrollHeight}px`;
  }, [value]);
  return (
    <textarea rows={1} value={value} placeholder={placeholder} spellCheck
      ref={x => { el.current = x; inputRef(x); }}
      onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus}
      className={`block w-full resize-none overflow-hidden bg-transparent outline-none ${className}`} />
  );
}

export default function OutlineView({ doc, getDoc, theme, commit, selectedId, onSelect, readOnly }: {
  doc: MindMapDoc;
  getDoc: () => MindMapDoc;
  theme: MindTheme;
  commit: (next: MindMapDoc, merge?: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  readOnly?: boolean;
}) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const [focusId, setFocusId] = useState<{ id: string; at: 'end' | 'start' } | null>(selectedId ? { id: selectedId, at: 'end' } : null);
  const rows = rowsOf(doc, theme);

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId.id);
    if (!el) return;
    el.focus();
    const p = focusId.at === 'end' ? el.value.length : 0;
    el.setSelectionRange(p, p);
    el.scrollIntoView({ block: 'nearest' });
    setFocusId(null);
  }, [focusId, doc]);

  const onKey = (row: Row, idx: number) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || readOnly) return;
    const d = getDoc();
    const id = row.t.id;
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const r = addSibling(d, id);
      if (r.id) {
        commit(setText(r.doc, r.id, ''));
        setFocusId({ id: r.id, at: 'end' });
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ref = findTopic(d, id);
      if (!ref) return;
      if (e.shiftKey) {
        if (!ref.parent || ref.parent.id === d.root.id) return;
        const gp = findTopic(d, ref.parent.id);
        if (!gp?.parent) return;
        commit(moveTopics(d, [id], gp.parent.id, gp.index + 1));
      } else {
        const sibs = ref.parent ? ref.parent.children : null;
        if (!sibs || ref.index === 0) return;
        commit(moveTopics(d, [id], sibs[ref.index - 1].id));
      }
      setFocusId({ id, at: 'end' });
    } else if (e.key === 'Backspace' && !el.value && rows.length > 1) {
      e.preventDefault();
      const prev = rows[idx - 1]?.t.id ?? rows[idx + 1]?.t.id;
      commit(removeTopics(d, [id]).doc);
      if (prev) setFocusId({ id: prev, at: 'end' });
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
      const before = el.value.slice(0, el.selectionStart);
      const after = el.value.slice(el.selectionEnd);
      if (e.key === 'ArrowUp' && before.includes('\n')) return;
      if (e.key === 'ArrowDown' && after.includes('\n')) return;
      const next = rows[idx + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) { e.preventDefault(); setFocusId({ id: next.t.id, at: 'end' }); }
    }
    e.stopPropagation();
  };

  const firstFloating = rows.findIndex(r => r.floating);

  return (
    <div className="h-full overflow-y-auto" style={{ background: theme.dark ? '#1B1D24' : '#FFFFFF', color: theme.dark ? '#F2F2F7' : '#1D1D1F' }}>
      <div className="max-w-[760px] mx-auto px-6 md:px-10 py-6 md:py-8">
        <AutoText value={doc.root.text} placeholder="Chủ đề trung tâm" inputRef={el => { if (el) refs.current.set(doc.root.id, el); else refs.current.delete(doc.root.id); }}
          onChange={v => !readOnly && commit(setText(getDoc(), doc.root.id, v), `text:${doc.root.id}`)}
          onFocus={() => onSelect(doc.root.id)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const first = doc.root.children[0];
              if (first) setFocusId({ id: first.id, at: 'start' });
            }
            e.stopPropagation();
          }}
          className="text-[24px] md:text-[26px] font-bold leading-tight mb-3" />
        {rows.map((row, i) => (
          <div key={row.t.id}>
            {i === firstFloating && <div className="mt-5 mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-50">Chủ đề tự do</div>}
            <div className={`group flex items-start gap-1.5 rounded-md ${selectedId === row.t.id ? 'bg-[#2C7BF6]/[0.07]' : ''}`} style={{ paddingLeft: row.depth * 22 }}>
              <button type="button" tabIndex={-1} onClick={() => commit(toggleCollapse(getDoc(), [row.t.id]))}
                className={`w-5 h-[26px] shrink-0 flex items-center justify-center opacity-60 hover:opacity-100 ${row.t.children.length ? '' : 'invisible'}`}
                aria-label={row.t.collapsed ? 'Mở nhánh' : 'Thu gọn nhánh'}>
                <ChevronRight size={14} className={`transition ${row.t.collapsed ? '' : 'rotate-90'}`} />
              </button>
              <span className="mt-[10px] w-[7px] h-[7px] shrink-0 rounded-full" style={{ background: row.color, boxShadow: row.t.collapsed ? `0 0 0 3px ${row.color}33` : undefined }} />
              {row.t.markers?.length ? (
                <span className="mt-[4px] flex gap-0.5 shrink-0">{row.t.markers.map(m => <MarkerIcon key={m} id={m} size={17} />)}</span>
              ) : null}
              <AutoText value={row.t.text} inputRef={el => { if (el) refs.current.set(row.t.id, el); else refs.current.delete(row.t.id); }}
                onChange={v => !readOnly && commit(setText(getDoc(), row.t.id, v), `text:${row.t.id}`)}
                onFocus={() => onSelect(row.t.id)}
                onKeyDown={onKey(row, i)}
                className={`flex-1 min-w-0 py-[3px] text-[15px] leading-[20px] ${row.depth === 0 ? 'font-semibold' : ''}`} />
              {row.t.collapsed && row.t.children.length > 0 && (
                <span className="mt-[5px] shrink-0 text-[11px] px-1.5 rounded-full bg-black/[0.06] opacity-70">{row.t.children.length}</span>
              )}
            </div>
          </div>
        ))}
        {!rows.length && !readOnly && (
          <button type="button" onClick={() => { const r = addSibling(getDoc(), getDoc().root.id); if (r.id) { commit(setText(r.doc, r.id, '')); setFocusId({ id: r.id, at: 'end' }); } }}
            className="mt-2 text-[14px] text-[#2C7BF6]">+ Thêm dòng đầu tiên</button>
        )}
        <div className="mt-6 text-[12px] opacity-45">Enter: dòng mới · Tab / Shift+Tab: thụt vào / ra · Backspace ở dòng trống: xoá</div>
      </div>
    </div>
  );
}
