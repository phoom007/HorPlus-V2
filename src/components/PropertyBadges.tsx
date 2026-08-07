import React from 'react';
import { FieldSource } from '../types';

interface SourceBadgeProps {
  source?: FieldSource | string;
  isLocked?: boolean;
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({ source, isLocked }) => {
  if (isLocked || source === 'CONTRACT_SNAPSHOT') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200" data-testid="badge-locked">
        มีสัญญาที่ล็อกค่าแล้ว
      </span>
    );
  }
  if (source === 'ROOM') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200" data-testid="badge-room">
        กำหนดเฉพาะห้อง
      </span>
    );
  }
  if (source === 'BUILDING') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200" data-testid="badge-building">
        ใช้ค่าจากอาคาร
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200" data-testid="badge-dormitory">
      ใช้ค่าจากหอพัก
    </span>
  );
};
