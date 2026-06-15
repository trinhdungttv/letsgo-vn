// ─── Health Score Utility ───────────────────────────────
export interface HealthScore {
  total: number;
  stability: number;
  payment: number;
  contact: number;
  contract: number;
  growth: number;
}

export function calcHealthScore(params: {
  currentWorkers: number;
  minWorkers: number;
  paidThisMonth: boolean;
  progCutoff: boolean;
  contractEnd: string;
  lastContactDate: string;
  workerHistory: number[];
}): HealthScore {
  const today = new Date();

  const ratio = params.minWorkers > 0
    ? params.currentWorkers / params.minWorkers : 1;
  const stability = Math.round(Math.min(1, ratio) * 30);

  const payment = params.paidThisMonth ? 25
    : params.progCutoff ? 12 : 0;

  let contact = 2;
  if (params.lastContactDate) {
    const last = new Date(params.lastContactDate);
    const daysSince = Math.round(
      (today.getTime() - last.getTime()) / 86400000
    );
    contact = daysSince <= 7 ? 20
      : daysSince <= 14 ? 14
      : daysSince <= 30 ? 8 : 2;
  }

  const daysLeft = params.contractEnd
    ? Math.round(
        (new Date(params.contractEnd).getTime() - today.getTime()) / 86400000
      )
    : 0;
  const contract = daysLeft > 180 ? 15
    : daysLeft > 90 ? 10
    : daysLeft > 30 ? 5
    : daysLeft > 0 ? 2 : 0;

  let growth = 7;
  if (params.workerHistory.length >= 2) {
    const delta =
      params.workerHistory[params.workerHistory.length - 1]
      - params.workerHistory[0];
    growth = delta > 0 ? 10
      : delta === 0 ? 7
      : Math.max(0, 10 + delta / 5);
  }
  growth = Math.round(growth);

  const total = Math.min(
    100,
    stability + payment + contact + contract + growth
  );

  return { total, stability, payment, contact, contract, growth };
}

export function hsColor(score: number): string {
  return score >= 75 ? '#059669'
    : score >= 50 ? '#D97706'
    : '#DC2626';
}

export function hsLabel(score: number): string {
  return score >= 75 ? 'Tốt'
    : score >= 50 ? 'Cần chú ý'
    : 'Nguy hiểm';
}

export type ChurnLevel = 'high' | 'medium' | null;

export function detectChurnRisk(workerHistory: number[]): ChurnLevel {
  if (workerHistory.length < 3) return null;
  const first = workerHistory[0];
  const last = workerHistory[workerHistory.length - 1];
  if (first === 0) return null;
  const pctChange = (last - first) / first * 100;
  const recent = workerHistory.slice(-3);
  const trendDown = recent.every((v, i) => i === 0 || v <= recent[i - 1]);
  if (pctChange <= -15 && trendDown) return 'high';
  if (pctChange <= -5 && trendDown) return 'medium';
  return null;
}
