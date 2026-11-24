import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/** True when motion should stay still: the device asks for reduced motion, or the in-app setting does. */
export function useCalm() {
  const device = useReducedMotion();
  const [setting, setSetting] = useState(() => document.documentElement.dataset.motion === 'reduced');
  useEffect(() => {
    const watch = new MutationObserver(() => setSetting(document.documentElement.dataset.motion === 'reduced'));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => watch.disconnect();
  }, []);
  return Boolean(device) || setting;
}
