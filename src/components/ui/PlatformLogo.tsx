import React from 'react';
export type PlatformBrand = 'youtube' | 'facebook' | 'tiktok' | 'obsstudio';
export const PLATFORM_NAMES = {youtube:'YouTube',facebook:'Facebook',tiktok:'TikTok',obsstudio:'OBS Studio'};
/** Local brand artwork, separate from the interface icon set. */
export function PlatformLogo({platform,size=20,className='',style,...props}: {platform:PlatformBrand;size?:number|string} & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`platform-logo platform-${platform} ${className}`} style={{width:size,height:size,...style}} aria-hidden="true" {...props}><span style={{maskImage:`url(/platforms/${platform}.svg)`,WebkitMaskImage:`url(/platforms/${platform}.svg)`}}/></span>;
}
