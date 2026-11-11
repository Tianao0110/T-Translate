// Caption text sizes: the user's choice as a factor on the base size (the
// overlay's video-relative size, the browser's own cue size on a track).

export const SIZE_SCALES = Object.freeze({ small: 0.65, medium: 0.8, large: 1, xlarge: 1.25 });
export const SIZES = Object.keys(SIZE_SCALES);
export const DEFAULT_SIZE = 'medium';
export const scaleOf = (size) => SIZE_SCALES[size] ?? SIZE_SCALES[DEFAULT_SIZE];
