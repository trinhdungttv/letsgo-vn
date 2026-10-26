import { branchInitials } from '../../lib/branchAvatar';

/**
 * Avatar chi nhánh: ảnh của Trưởng chi nhánh (branches.manager_avatar_url — cùng nguồn với
 * module Chi nhánh); chưa có ảnh thì hiện chữ cái đầu, cùng màu mint với module Chi nhánh.
 */
export function BranchAvatar({ branch, size = 32, className = '' }: {
  branch: { name?: string | null; short_name?: string | null; manager_avatar_url?: string | null };
  size?: number;
  className?: string;
}) {
  const box = { width: size, height: size };
  if (branch.manager_avatar_url) {
    return <img src={branch.manager_avatar_url} alt="" loading="lazy" className={`rounded-full object-cover shrink-0 ${className}`} style={box} />;
  }
  return (
    <div
      aria-hidden
      className={`rounded-full bg-[#E1F5EE] text-[#085041] flex items-center justify-center font-semibold tracking-tight shrink-0 select-none ${className}`}
      style={{ ...box, fontSize: Math.round(size * 0.38) }}
    >
      {branchInitials(branch.name, branch.short_name)}
    </div>
  );
}
