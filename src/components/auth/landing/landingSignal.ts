/**
 * Shared, mutable state between the landing page's HTML (scroll, the prompt reel) and the 3D backdrop.
 * Written by DOM events, read every frame by the scene, so nothing here causes a React render.
 */
export const landingSignal = {
  /** Continuous chapter position: 0 = hero, 1 = first chapter, ... (fractional while scrolling between). */
  chapter: 0,
  /** 0..1, raised while Arena AI is "thinking" in the prompt reel; the orb pulses with it. */
  aiPulse: 0,
  /** Pointer position, -1..1 on both axes. */
  px: 0,
  py: 0,
};

/**
 * The 3D formation shown for each chapter, in page order:
 * hero, live, bracket, fair play, Arena AI, games, finale.
 */
export const CHAPTER_SHAPES = [0, 1, 2, 3, 4, 5, 0] as const;

/** Reads every `[data-chapter]` section and turns the scroll position into a continuous chapter index. */
export function measureChapter(): number {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
  if (!sections.length) return 0;
  const focus = window.innerHeight * 0.55;
  let value = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const box = sections[i].getBoundingClientRect();
    if (box.top <= focus) value = i + Math.min(1, Math.max(0, (focus - box.top) / Math.max(1, box.height)));
  }
  // Each section's own span maps to "arriving" in the first half and "holding" after, so formations settle mid-section.
  const index = Math.floor(value);
  const t = value - index;
  return Math.max(0, index - 1 + Math.min(1, t * 2.2));
}
