import React from 'react';
import type { ChurnLevel } from '../../utils/healthScore';

interface Props {
  level: ChurnLevel;
}

export const ChurnBadge: React.FC<Props> = ({ level }) => {
  if (!level) return null;
  return <span title={level === 'high' ? 'Churn Risk cao' : 'Churn Risk'} style={{ fontSize: 13 }}>🚩</span>;
};
