/** Công tắc kiểu iOS (dùng trong các khung Workspace). */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      className={`relative w-[42px] h-[26px] rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[#34C759]' : 'bg-black/[0.12]'}`}>
      <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform duration-200 ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}
