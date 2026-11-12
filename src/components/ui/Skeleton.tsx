/**
 * Skeleton loading components — use instead of blank screens while data fetches.
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
}

/** Single skeleton bar */
export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-[#2A2A2A] rounded-[3px] ${className}`}
    aria-hidden="true"
  />
);

/** Card skeleton */
export const SkeletonCard: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div className={`p-4 rounded-[4px] bg-[#222222] border border-[#2A2A2A] space-y-3 ${className}`}>
    <Skeleton className="h-4 w-3/4" />
    {Array.from({ length: lines - 1 }).map((_, i) => (
      <Skeleton key={i} className={`h-3 ${i % 2 === 0 ? 'w-full' : 'w-5/6'}`} />
    ))}
  </div>
);

/** Row-based list skeleton */
export const SkeletonList: React.FC<{ rows?: number; className?: string }> = ({
  rows = 4,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-3 rounded-[4px] bg-[#222222] border border-[#2A2A2A]">
        <Skeleton className="w-8 h-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      </div>
    ))}
  </div>
);

/** Stat tile skeleton */
export const SkeletonStatTile: React.FC = () => (
  <div className="p-5 rounded-[4px] bg-[#222222] border border-[#2A2A2A] space-y-2">
    <Skeleton className="h-3 w-20" />
    <Skeleton className="h-8 w-24" />
    <Skeleton className="h-2 w-16" />
  </div>
);

/** Full page skeleton (initial app load) */
export const PageSkeleton: React.FC<{ title?: string }> = ({ title }) => (
  <div className="space-y-6 animate-pulse">
    {title && (
      <div className="space-y-1">
        <div className="h-6 w-48 bg-[#2A2A2A] rounded-[3px]" />
        <div className="h-3 w-72 bg-[#222222] rounded-[3px]" />
      </div>
    )}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => <SkeletonStatTile key={i} />)}
    </div>
    <SkeletonList rows={5} />
  </div>
);
