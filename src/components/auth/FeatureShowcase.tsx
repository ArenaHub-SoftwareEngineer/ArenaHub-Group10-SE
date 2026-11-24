import React, { lazy, Suspense } from 'react';
import { Modal } from '../ui/Modal';

const WatchDemo = lazy(() => import('./FeatureDemos').then(module => ({ default: module.WatchDemo })));
const BracketDemo = lazy(() => import('./FeatureDemos').then(module => ({ default: module.BracketDemo })));
const FairPlayDemo = lazy(() => import('./FeatureDemos').then(module => ({ default: module.FairPlayDemo })));
const AiDemo = lazy(() => import('./FeatureDemos').then(module => ({ default: module.AiDemo })));

/** The interactive previews (sample data) that the welcome page's chapters open. */
export const FEATURE_PREVIEWS = {
  watch: { title: 'Watch live', Demo: WatchDemo },
  bracket: { title: 'Follow the tournament', Demo: BracketDemo },
  fair: { title: 'Play fair', Demo: FairPlayDemo },
  ai: { title: 'Ask Arena AI', Demo: AiDemo },
} as const;

export type FeaturePreviewKey = keyof typeof FEATURE_PREVIEWS;

export function FeaturePreview({ feature, onClose }: { feature: FeaturePreviewKey | null; onClose: () => void }) {
  const entry = feature ? FEATURE_PREVIEWS[feature] : null;
  const Demo = entry?.Demo;
  return <Modal open={Boolean(entry)} title={entry?.title ?? 'Feature preview'} description="Interactive preview with sample data."
    onClose={onClose} className="landing-feature-dialog">
    {Demo && <Suspense fallback={<p role="status">Loading preview…</p>}><Demo /></Suspense>}
  </Modal>;
}
