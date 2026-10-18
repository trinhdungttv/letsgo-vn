/* eslint-disable react-refresh/only-export-components */
// Nạp toàn bộ bảng bds_* một lần (dữ liệu nhỏ), giữ trong bộ nhớ và ghi lại theo từng ô:
// sửa → cập nhật giao diện ngay → debounce 400ms → upsert/xoá. Lỗi mạng giữ nguyên giá trị để Thử lại.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBeforeUnloadWarning } from '../../../hooks/useBeforeUnloadWarning';
import type { CalcData, MonthKey } from '../lib/calc/types';
import { currentMonthKey, monthRange, monthToDate, toMonthKey } from '../lib/calc/months';
import {
  CORE_TABLES, OPS_TABLES,
  type BdsSettings, type BdsTables, type BdsTenantFee, type CellTable, type IdTable, type TableName,
} from '../lib/types';
import {
  accessCheck, deleteCell, deleteRow, errMsg, fetchAll, insertRow, isMissingTable, setBdsToken, updateRow, upsertCells,
  type AccessState,
} from './api';

export type SaveState = 'pending' | 'saving' | 'saved' | 'error';
export type Rows = { [K in TableName]: BdsTables[K][] };

export const DEFAULT_SETTINGS: BdsSettings = {
  id: 1, exchange_rate: 26000, vat_rate_rent: 10, vat_rate_util: 8, parking_price_moto: 150000,
  parking_price_car: 1500000, start_month: '2026-01-01', range_months: 24, include_forecast_in_cost: false,
  hide_empty_months: true, show_fee_panel: false, electricity_unit_price: 3500, invoice_due_day: 10,
  invoice_footer: null, alert_days: 60,
};

const emptyRows = (): Rows => {
  const r = {} as Rows;
  for (const t of [...CORE_TABLES, ...OPS_TABLES]) (r as Record<string, unknown[]>)[t] = [];
  return r;
};

/** Xoá dây chuyền phía client — khớp ON DELETE CASCADE / SET NULL trong migration. */
const CASCADE: Partial<Record<TableName, { table: TableName; fk: string; action: 'delete' | 'null' }[]>> = {
  bds_head_leases: [
    { table: 'bds_head_lease_increases', fk: 'head_lease_id', action: 'delete' },
    { table: 'bds_tenants', fk: 'head_lease_id', action: 'null' },
    { table: 'bds_breakeven_scenarios', fk: 'head_lease_id', action: 'null' },
    { table: 'bds_rooms', fk: 'head_lease_id', action: 'null' },
  ],
  bds_tenants: [
    { table: 'bds_tenant_rent', fk: 'tenant_id', action: 'delete' },
    { table: 'bds_tenant_fees', fk: 'tenant_id', action: 'delete' },
    { table: 'bds_meter_readings', fk: 'tenant_id', action: 'delete' },
    { table: 'bds_invoices', fk: 'tenant_id', action: 'delete' },
  ],
  bds_opex_categories: [{ table: 'bds_opex_monthly', fk: 'category_id', action: 'delete' }],
  bds_breakeven_scenarios: [{ table: 'bds_breakeven_rooms', fk: 'scenario_id', action: 'delete' }],
  bds_rooms: [
    { table: 'bds_tenants', fk: 'room_id', action: 'null' },
    { table: 'bds_assets', fk: 'room_id', action: 'null' },
    { table: 'bds_tickets', fk: 'room_id', action: 'null' },
  ],
  bds_assets: [{ table: 'bds_tickets', fk: 'asset_id', action: 'null' }],
  bds_tickets: [{ table: 'bds_maintenance_logs', fk: 'ticket_id', action: 'delete' }],
};

export type FeePatch = Partial<Pick<BdsTenantFee, 'electricity_amount' | 'motorbike_count' | 'car_count'>>;

export interface OfficeContextValue {
  status: 'loading' | 'ready' | 'blocked' | 'error';
  access: AccessState;
  loadError: string | null;
  opsReady: boolean;
  rows: Rows;
  settings: BdsSettings;
  calc: CalcData;
  months: MonthKey[];
  currentMonth: MonthKey;
  reload: () => Promise<void>;
  insert: <T extends IdTable>(table: T, row: Partial<BdsTables[T]>) => Promise<BdsTables[T] | null>;
  patch: <T extends IdTable>(table: T, id: string, patch: Partial<BdsTables[T]>, immediate?: boolean) => void;
  remove: (table: IdTable, id: string) => Promise<boolean>;
  setRent: (tenantId: string, month: MonthKey, amount: number) => void;
  setFee: (tenantId: string, month: MonthKey, patch: FeePatch) => void;
  setOpex: (categoryId: string, month: MonthKey, amount: number) => void;
  saveState: Record<string, SaveState>;
  saveErrors: Record<string, string>;
  retry: (key?: string) => void;
  flush: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<OfficeContextValue | null>(null);

export function useOffice(): OfficeContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOffice must be used inside OfficeDataProvider');
  return v;
}

export const patchKey = (table: TableName, id: string) => `${table}:${id}`;
export const cellKey = (table: CellTable, owner: string, month: MonthKey) => `${table}:${owner}:${monthToDate(month)}`;

export function buildCalcData(rows: Rows, settings: BdsSettings): CalcData {
  const incByLease = new Map<string, { month: MonthKey; percent: number }[]>();
  for (const i of rows.bds_head_lease_increases) {
    const arr = incByLease.get(i.head_lease_id) || [];
    arr.push({ month: toMonthKey(i.effective_month), percent: Number(i.percent) || 0 });
    incByLease.set(i.head_lease_id, arr);
  }
  const data: CalcData = {
    settings: {
      exchangeRate: Number(settings.exchange_rate) || 0,
      vatRateRent: Number(settings.vat_rate_rent) || 0,
      vatRateUtil: Number(settings.vat_rate_util) || 0,
      parkingPriceMoto: Number(settings.parking_price_moto) || 0,
      parkingPriceCar: Number(settings.parking_price_car) || 0,
      includeForecastInCost: !!settings.include_forecast_in_cost,
    },
    headLeases: rows.bds_head_leases.map(l => ({
      id: l.id, landlord: l.landlord, name: l.name, currency: l.currency, basePrice: Number(l.base_price) || 0,
      baseMonth: toMonthKey(l.base_month), endMonth: l.end_month ? toMonthKey(l.end_month) : null,
      vatMode: l.vat_mode, vatCategory: l.vat_category, isParking: l.is_parking, increases: incByLease.get(l.id) || [],
    })),
    tenants: rows.bds_tenants.map(t => ({ id: t.id, name: t.name, currency: t.currency, vatMode: t.vat_mode, headLeaseId: t.head_lease_id })),
    opexCategories: rows.bds_opex_categories.map(c => ({ id: c.id, name: c.name, vatMode: c.vat_mode, vatCategory: c.vat_category })),
    forecasts: rows.bds_forecast_expenses.map(f => ({ month: toMonthKey(f.month), amount: Number(f.amount) || 0 })),
    rent: {},
    fees: {},
    opex: {},
  };
  for (const r of rows.bds_tenant_rent) (data.rent[toMonthKey(r.month)] ||= {})[r.tenant_id] = Number(r.amount) || 0;
  for (const f of rows.bds_tenant_fees) {
    (data.fees[toMonthKey(f.month)] ||= {})[f.tenant_id] = {
      electricity: Number(f.electricity_amount) || 0, moto: Number(f.motorbike_count) || 0, car: Number(f.car_count) || 0,
    };
  }
  for (const o of rows.bds_opex_monthly) (data.opex[toMonthKey(o.month)] ||= {})[o.category_id] = Number(o.amount) || 0;
  return data;
}

export function OfficeDataProvider({ token, toast, children }: { token: string | null; toast: (m: string) => void; children: ReactNode }) {
  const [status, setStatus] = useState<OfficeContextValue['status']>('loading');
  const [access, setAccess] = useState<AccessState>('ok');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opsReady, setOpsReady] = useState(false);
  const [rows, setRowsState] = useState<Rows>(emptyRows);
  const rowsRef = useRef(rows);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const setRows = useCallback((f: (prev: Rows) => Rows) => {
    setRowsState(prev => {
      const next = f(prev);
      rowsRef.current = next;
      return next;
    });
  }, []);

  // ── Hàng đợi ghi (debounce + tuần tự theo từng ô) ─────────────────────
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runners = useRef(new Map<string, () => Promise<void>>());
  const chains = useRef(new Map<string, Promise<void>>());
  const versions = useRef(new Map<string, number>());
  const patchBuf = useRef(new Map<string, { table: IdTable; id: string; patch: Record<string, unknown> }>());

  const markState = useCallback((key: string, st: SaveState | null) => {
    setSaveState(prev => {
      if (st === null) { if (!(key in prev)) return prev; const n = { ...prev }; delete n[key]; return n; }
      return prev[key] === st ? prev : { ...prev, [key]: st };
    });
  }, []);

  const execute = useCallback((key: string) => {
    const t = timers.current.get(key);
    if (t) { clearTimeout(t); timers.current.delete(key); }
    const run = runners.current.get(key);
    if (!run) return Promise.resolve();
    const v = versions.current.get(key);
    markState(key, 'saving');
    const prev = chains.current.get(key) || Promise.resolve();
    const p = prev.catch(() => undefined).then(run).then(
      () => {
        if (versions.current.get(key) !== v) return;
        runners.current.delete(key);
        markState(key, 'saved');
        setSaveErrors(e => { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; });
        setTimeout(() => setSaveState(s => {
          if (s[key] !== 'saved') return s;
          const n = { ...s };
          delete n[key];
          return n;
        }), 1800);
      },
      (err: unknown) => {
        if (versions.current.get(key) !== v) return;
        markState(key, 'error');
        setSaveErrors(e => ({ ...e, [key]: errMsg(err) }));
      },
    );
    chains.current.set(key, p);
    return p;
  }, [markState]);

  const schedule = useCallback((key: string, run: () => Promise<void>, delay = 400) => {
    runners.current.set(key, run);
    versions.current.set(key, (versions.current.get(key) || 0) + 1);
    markState(key, 'pending');
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.set(key, setTimeout(() => { void execute(key); }, delay));
  }, [execute, markState]);

  const flush = useCallback(async () => {
    const keys = [...timers.current.keys()];
    await Promise.all(keys.map(k => execute(k)));
    await Promise.all([...chains.current.values()].map(p => p.catch(() => undefined)));
  }, [execute]);

  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const retry = useCallback((key?: string) => {
    const keys = key ? [key] : Object.keys(saveStateRef.current).filter(k => saveStateRef.current[k] === 'error');
    for (const k of keys) void execute(k);
  }, [execute]);

  // Rời trang khi còn ô chưa lưu → ghi nốt ngay
  useEffect(() => () => { for (const k of [...timers.current.keys()]) void execute(k); }, [execute]);
  const dirty = Object.values(saveState).some(s => s !== 'saved');
  useBeforeUnloadWarning(dirty);

  // ── Nạp dữ liệu ───────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    const acc = await accessCheck();
    setAccess(acc.state);
    if (acc.state !== 'ok') {
      setStatus(acc.state === 'error' ? 'error' : 'blocked');
      setLoadError(acc.message || null);
      return;
    }
    try {
      const next = emptyRows();
      const core = await Promise.all(CORE_TABLES.map(t => fetchAll(t)));
      CORE_TABLES.forEach((t, i) => { (next as Record<string, unknown[]>)[t] = core[i]; });
      let ready = true;
      try {
        const ops = await Promise.all(OPS_TABLES.map(t => fetchAll(t)));
        OPS_TABLES.forEach((t, i) => { (next as Record<string, unknown[]>)[t] = ops[i]; });
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        ready = false;
      }
      setOpsReady(ready);
      setRows(() => next);
      setStatus('ready');
    } catch (e) {
      setLoadError(errMsg(e));
      setStatus('error');
    }
  }, [setRows]);

  const reload = useCallback(async () => {
    await flush();
    await load();
  }, [flush, load]);

  useEffect(() => {
    setBdsToken(token);
    void load();
  }, [token, load]);

  // ── Ghi theo id ────────────────────────────────────────────────────────
  const insert = useCallback(async <T extends IdTable>(table: T, row: Partial<BdsTables[T]>) => {
    try {
      const created = await insertRow(table, row);
      setRows(r => ({ ...r, [table]: [...(r[table] as BdsTables[T][]), created] }));
      return created;
    } catch (e) {
      toastRef.current('Lỗi: ' + errMsg(e));
      return null;
    }
  }, [setRows]);

  const patch = useCallback(<T extends IdTable>(table: T, id: string, p: Partial<BdsTables[T]>, immediate = false) => {
    setRows(r => ({
      ...r,
      [table]: (r[table] as unknown as { id: string | number }[]).map(x => (String(x.id) === String(id) ? { ...x, ...p } : x)),
    }));
    const key = patchKey(table, id);
    const prev = patchBuf.current.get(key);
    patchBuf.current.set(key, { table, id, patch: { ...(prev?.patch || {}), ...(p as Record<string, unknown>) } });
    schedule(key, async () => {
      const entry = patchBuf.current.get(key);
      if (!entry) return;
      patchBuf.current.delete(key);
      try {
        await updateRow(entry.table, entry.id, entry.patch as never);
      } catch (e) {
        const newer = patchBuf.current.get(key);
        patchBuf.current.set(key, { ...entry, patch: { ...entry.patch, ...(newer?.patch || {}) } });
        throw e;
      }
    }, immediate ? 0 : 400);
  }, [schedule, setRows]);

  const remove = useCallback(async (table: IdTable, id: string) => {
    // Huỷ mọi lệnh ghi đang chờ của dòng này (kể cả ô tháng của nó) để không ghi vào dòng đã xoá
    const ownKeys = [...new Set([...runners.current.keys(), ...timers.current.keys()])]
      .filter(k => k === patchKey(table, id) || k.includes(`:${id}:`));
    for (const key of ownKeys) {
      const t = timers.current.get(key);
      if (t) { clearTimeout(t); timers.current.delete(key); }
      runners.current.delete(key);
      patchBuf.current.delete(key);
      versions.current.set(key, (versions.current.get(key) || 0) + 1);
      markState(key, null);
    }
    try {
      await deleteRow(table, id);
    } catch (e) {
      toastRef.current('Lỗi xoá: ' + errMsg(e));
      return false;
    }
    setRows(r => {
      const next = { ...r } as unknown as Record<string, Record<string, unknown>[]>;
      const drop = (tbl: TableName, pred: (x: Record<string, unknown>) => boolean) => { next[tbl] = next[tbl].filter(x => !pred(x)); };
      drop(table, x => String(x.id) === id);
      const walk = (tbl: TableName, ids: Set<string>) => {
        for (const c of CASCADE[tbl] || []) {
          const affected = next[c.table].filter(x => ids.has(String(x[c.fk])));
          if (!affected.length) continue;
          if (c.action === 'delete') {
            next[c.table] = next[c.table].filter(x => !ids.has(String(x[c.fk])));
            if (CASCADE[c.table]) walk(c.table, new Set(affected.map(x => String(x.id))));
          } else {
            next[c.table] = next[c.table].map(x => (ids.has(String(x[c.fk])) ? { ...x, [c.fk]: null } : x));
          }
        }
      };
      walk(table, new Set([id]));
      return next as unknown as Rows;
    });
    return true;
  }, [markState, setRows]);

  // ── Ghi theo ô (bảng tháng) ───────────────────────────────────────────
  const setRent = useCallback((tenantId: string, month: MonthKey, amount: number) => {
    const m = monthToDate(month);
    setRows(r => ({
      ...r,
      bds_tenant_rent: [
        ...r.bds_tenant_rent.filter(x => !(x.tenant_id === tenantId && x.month === m)),
        ...(amount > 0 ? [{ tenant_id: tenantId, month: m, amount }] : []),
      ],
    }));
    schedule(cellKey('bds_tenant_rent', tenantId, month), async () => {
      const cur = rowsRef.current.bds_tenant_rent.find(x => x.tenant_id === tenantId && x.month === m);
      if (cur && cur.amount > 0) await upsertCells('bds_tenant_rent', [cur]);
      else await deleteCell('bds_tenant_rent', tenantId, m);
    });
  }, [schedule, setRows]);

  const setFee = useCallback((tenantId: string, month: MonthKey, p: FeePatch) => {
    const m = monthToDate(month);
    setRows(r => {
      const old = r.bds_tenant_fees.find(x => x.tenant_id === tenantId && x.month === m)
        || { tenant_id: tenantId, month: m, electricity_amount: 0, motorbike_count: 0, car_count: 0 };
      const merged = { ...old, ...p };
      const empty = !merged.electricity_amount && !merged.motorbike_count && !merged.car_count;
      return {
        ...r,
        bds_tenant_fees: [
          ...r.bds_tenant_fees.filter(x => !(x.tenant_id === tenantId && x.month === m)),
          ...(empty ? [] : [merged]),
        ],
      };
    });
    schedule(cellKey('bds_tenant_fees', tenantId, month), async () => {
      const cur = rowsRef.current.bds_tenant_fees.find(x => x.tenant_id === tenantId && x.month === m);
      if (cur) await upsertCells('bds_tenant_fees', [cur]);
      else await deleteCell('bds_tenant_fees', tenantId, m);
    });
  }, [schedule, setRows]);

  const setOpex = useCallback((categoryId: string, month: MonthKey, amount: number) => {
    const m = monthToDate(month);
    setRows(r => ({
      ...r,
      bds_opex_monthly: [
        ...r.bds_opex_monthly.filter(x => !(x.category_id === categoryId && x.month === m)),
        ...(amount > 0 ? [{ category_id: categoryId, month: m, amount }] : []),
      ],
    }));
    schedule(cellKey('bds_opex_monthly', categoryId, month), async () => {
      const cur = rowsRef.current.bds_opex_monthly.find(x => x.category_id === categoryId && x.month === m);
      if (cur && cur.amount > 0) await upsertCells('bds_opex_monthly', [cur]);
      else await deleteCell('bds_opex_monthly', categoryId, m);
    });
  }, [schedule, setRows]);

  // ── Dẫn xuất ──────────────────────────────────────────────────────────
  const settings = rows.bds_settings[0] || DEFAULT_SETTINGS;
  const calc = useMemo(() => buildCalcData(rows, settings), [rows, settings]);
  const months = useMemo(
    () => monthRange(toMonthKey(settings.start_month || '2026-01-01'), settings.range_months || 24),
    [settings.start_month, settings.range_months],
  );
  const currentMonth = currentMonthKey();

  const value: OfficeContextValue = {
    status, access, loadError, opsReady, rows, settings, calc, months, currentMonth,
    reload, insert, patch, remove, setRent, setFee, setOpex, saveState, saveErrors, retry, flush, toast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
