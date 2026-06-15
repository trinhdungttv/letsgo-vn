import React from 'react';

interface Props {
  progCutoff: boolean;
  progCalc: boolean;
  progPaid: boolean;
  paidThisMonth: boolean;
}

export const CycleTrack: React.FC<Props> = ({
  progCutoff,
  progCalc,
  progPaid,
  paidThisMonth,
}) => {
  const steps = [progCutoff, progCalc, progPaid, paidThisMonth];
  const curIdx = Math.min(3, steps.lastIndexOf(true) + 1);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {steps.map((done, i) => {
        const isCur = !done && i === curIdx;
        return (
          <React.Fragment key={i}>
            <div style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 7.5,
              fontWeight: 700,
              flexShrink: 0,
              border: '1.5px solid',
              background: done ? '#059669' : '#fff',
              borderColor: done ? '#059669' : isCur ? '#1D4ED8' : '#E5E7EB',
              color: done ? '#fff' : isCur ? '#1D4ED8' : '#D1D5DB',
              boxShadow: isCur ? '0 0 0 2px rgba(29,78,216,0.2)' : 'none',
            }}>
              {done ? '✓' : i + 1}
            </div>
            {i < 3 && (
              <div style={{
                width: 10,
                height: 1.5,
                background: done ? '#059669' : '#E5E7EB',
                flexShrink: 0,
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
