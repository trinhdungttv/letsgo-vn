import React from 'react';
import type { ChurnLevel } from '../../utils/healthScore';

interface Props {
  level: ChurnLevel;
}

export const ChurnBadge: React.FC<Props> = ({ level }) => {
  if (!level) return null;

  if (level === 'high') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: '2px 6px',
        borderRadius: 4,
        background: '#FEE2E2',
        color: '#991B1B',
        fontSize: 9.5,
        fontWeight: 700,
        animation: 'churnBlink .8s step-end infinite',
      }}>
        🚨 CHURN
        <style>{`
          @keyframes churnBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </span>
    );
  }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      padding: '2px 6px',
      borderRadius: 4,
      background: '#FEF3C7',
      color: '#92400E',
      fontSize: 9.5,
      fontWeight: 700,
    }}>
      ⚠ Risk
    </span>
  );
};
