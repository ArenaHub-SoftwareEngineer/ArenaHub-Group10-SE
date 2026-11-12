import React from 'react';
export function ArenaMascot({ mood = 'ready', className = '' }: { mood?: 'ready' | 'thinking' | 'shield'; className?: string }) {
  return <span className={`arena-mascot mascot-${mood} ${className}`} aria-hidden="true"><span className="mascot-antenna" /><span className="mascot-ear left" /><span className="mascot-ear right" /><span className="mascot-head"><span className="mascot-visor"><i /><i /></span><span className="mascot-smile" /></span><span className="mascot-base" /></span>;
}
export function AIEntrance() {
  return <div className="ai-entrance" role="status" aria-label="Arena assistant ready"><span className="ai-orbit" /><ArenaMascot mood="thinking" /><span className="ai-entrance-caption">Your arena co-pilot.</span></div>;
}
