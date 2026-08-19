import React from 'react';
import { BAMBOOK_OS } from './bambookOsTokens';

type UserAvatarProps = {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  sizeClassName?: string;
  textClassName?: string;
  isDarkMode?: boolean;
  className?: string;
  adaptive?: boolean;
};

export function getUserInitial(name?: string | null, email?: string | null): string {
  const source = (name || email || '?').trim();
  return (source.charAt(0) || '?').toUpperCase();
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  email,
  avatarUrl,
  sizeClassName = 'h-10 w-10',
  textClassName = 'text-sm',
  isDarkMode = false,
  className = '',
  adaptive = false,
}) => {
  const initial = getUserInitial(name, email);
  const fallbackClass = adaptive
    ? 'bg-[var(--os-adaptive-primary)]/[0.12] text-[var(--os-adaptive-primary)]'
    : 'bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-strong)]';

  // 批 J（rimless 纪律）：静态阴影 haloShadowClass + inset ringOverlay 已移除——
  // BDS 无阴影规范无豁免条款（评审报告 M3）。仅保留 4% 边缘羽化 mask（非阴影，材质裁切）。
  return (
    <div
      className={`relative shrink-0 rounded-full ${sizeClassName} ${className}`}
      aria-label={name || email || '用户头像'}
    >
      <div
        className={`relative h-full w-full overflow-hidden rounded-full ${fallbackClass}`}
        style={{
          // 边缘 1px 羽化：96%~100% 半径处 alpha 由 1 渐到 0。极窄，肉眼只感"不刀切"。
          WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 96%, transparent 100%)',
          maskImage: 'radial-gradient(circle at 50% 50%, #000 96%, transparent 100%)',
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center rounded-full font-light ${textClassName}`}>
            {initial}
          </div>
        )}
        {/* 几乎不可见的环境光吸收：opacity 0.22 + soft-light，潜移默化与背景融合。 */}
        <div className={`pointer-events-none absolute inset-0 rounded-full ${BAMBOOK_OS.material.panelSurface} opacity-[0.22] mix-blend-soft-light`} />
      </div>
    </div>
  );
};

export default UserAvatar;
