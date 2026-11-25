export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const mix = (a, b, t) => a + (b - a) * t;
export const lerpExp = (previous, target, deltaSeconds, response = 0.13) =>
  previous + (target - previous) * (1 - Math.exp(-clamp(deltaSeconds, 0, 0.1) / response));
export const normRange = (min, max, normalized) => mix(min, max, clamp((normalized + 1) / 2, 0, 1));
export const unitRange = (min, max, unit) => mix(min, max, clamp(unit, 0, 1));
export const getBlend = (map, key) => map[key] ?? 0;
export const scoreMap = classifications => Object.fromEntries((classifications?.categories ?? []).map(({ categoryName, score }) => [categoryName, score]));
