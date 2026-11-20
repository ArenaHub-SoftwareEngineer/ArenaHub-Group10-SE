import institution from '../../institution.config.json' with { type: 'json' };

/** The school's primary colour (institution.config.json theme.primary), for places CSS cannot reach, like WebGL. */
export const BRAND_COLOR: string = /^#[0-9a-f]{6}$/i.test(institution.theme?.primary || '') ? institution.theme.primary : '#ff6600';
