/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Circular Bank Avatar
 * Displays authentic official bank vector logo in a circular badge.
 */

import React, { useState } from 'react';
import { getBankBadgeInfo } from '../tenantHelpers';

export interface BankAvatarProps {
  bankCodeOrName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BankAvatar: React.FC<BankAvatarProps> = ({
  bankCodeOrName,
  size = 'md',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);
  const badgeInfo = getBankBadgeInfo(bankCodeOrName);

  const sizeClasses = {
    sm: 'w-8 h-8 text-[9px]',
    md: 'w-11 h-11 text-xs',
    lg: 'w-14 h-14 text-sm',
  };

  const imageSizes = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-9 h-9',
  };

  return (
    <div
      data-testid="bank-avatar"
      className={`rounded-full overflow-hidden ${badgeInfo.bg} shadow-xs flex items-center justify-center shrink-0 p-2 select-none ${sizeClasses[size]} ${className}`}
      title={badgeInfo.name}
    >
      {badgeInfo.logoUrl && !imgError ? (
        <img
          src={badgeInfo.logoUrl}
          alt={badgeInfo.label}
          className="w-full h-full object-contain transition-transform hover:scale-105"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="font-black text-white">
          {badgeInfo.label}
        </span>
      )}
    </div>
  );
};
