// Pháp lý — nạp toàn bộ dữ liệu module 1 lần (4 bảng nhỏ) + hàm cập nhật danh sách tại chỗ sau mỗi lần lưu.
import { useCallback, useEffect, useState } from 'react';
import { LegalMissingError, loadLegal, type LegalData } from '../../lib/legal/api';
import type { LegalDoc, LegalEntity, LegalMilestone, LegalTopic } from '../../lib/legal/types';

export type LegalPhase = 'loading' | 'ready' | 'missing' | 'error';

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

export interface LegalStore extends LegalData {
  phase: LegalPhase;
  error: string;
  reload: () => Promise<void>;
  putEntity: (e: LegalEntity) => void;
  putMilestone: (m: LegalMilestone) => void;
  putTopic: (t: LegalTopic) => void;
  putDoc: (d: LegalDoc) => void;
  drop: (kind: 'entity' | 'milestone' | 'topic' | 'doc', ids: string[]) => void;
}

const EMPTY: LegalData = { entities: [], milestones: [], topics: [], docs: [] };

export function useLegal(): LegalStore {
  const [data, setData] = useState<LegalData>(EMPTY);
  const [phase, setPhase] = useState<LegalPhase>('loading');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const d = await loadLegal();
      setData(d);
      setPhase('ready');
      setError('');
    } catch (e) {
      if (e instanceof LegalMissingError) setPhase('missing');
      else { setError((e as Error).message); setPhase(p => (p === 'ready' ? p : 'error')); }
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const putEntity = useCallback((e: LegalEntity) => setData(d => ({ ...d, entities: upsert(d.entities, e) })), []);
  const putMilestone = useCallback((m: LegalMilestone) => setData(d => ({ ...d, milestones: upsert(d.milestones, m) })), []);
  const putTopic = useCallback((t: LegalTopic) => setData(d => ({ ...d, topics: upsert(d.topics, t) })), []);
  const putDoc = useCallback((doc: LegalDoc) => setData(d => ({ ...d, docs: upsert(d.docs, doc) })), []);
  const drop = useCallback((kind: 'entity' | 'milestone' | 'topic' | 'doc', ids: string[]) => {
    const set = new Set(ids);
    setData(d => ({
      entities: kind === 'entity' ? d.entities.filter(x => !set.has(x.id)) : d.entities,
      milestones: kind === 'milestone' ? d.milestones.filter(x => !set.has(x.id)) : d.milestones,
      topics: kind === 'topic' ? d.topics.filter(x => !set.has(x.id)) : d.topics,
      docs: kind === 'doc' ? d.docs.filter(x => !set.has(x.id)) : d.docs,
    }));
  }, []);

  return { ...data, phase, error, reload, putEntity, putMilestone, putTopic, putDoc, drop };
}
