import React from 'react';
import { hsColor, hsLabel } from '../../utils/healthScore';

interface Props {
  score: number;
  size?: 'sm' | 'md';
}

export const HealthScoreRing: React.FC<Props> = ({ score, size = 'sm' }) => {
  const color = hsColor(score);
  const dim = size === 'sm' ? 34 : 52;
  const r = size === 'sm' ? 13 : 21;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: dim, height: dim, flexShrink: 0 }}>
        <svg
          width={dim}
          height={dim}
          viewBox={`0 0 ${dim} ${dim}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={dim / 2} cy={dim / 2} r={r}
            fill="none" stroke="#E5E7EB" strokeWidth="3"
          />
          <circle
            cx={dim / 2} cy={dim / 2} r={r}
            fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: size === 'sm' ? 9 : 12,
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}>
          {score}
        </div>
      </div>
      {size === 'md' && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color }}>
            {hsLabel(score)}
          </div>
          <div style={{ fontSize: 10, color: '#9CA3AF' }}>/100 điểm</div>
        </div>
      )}
    </div>
  );
};
