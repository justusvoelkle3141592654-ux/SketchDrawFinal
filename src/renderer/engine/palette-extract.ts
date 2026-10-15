// Extracts a small representative palette from straight RGBA pixels (k-means on a sample).
import type { RGB } from './color';
import { mulberry32 } from './random';

export function extractPalette(rgba: Uint8ClampedArray, width: number, height: number, k: number): RGB[] {
  const samples: number[][] = [];
  const total = width * height;
  const stride = Math.max(1, Math.floor(total / 6000));
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (rgba[i + 3] < 128) continue;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (!samples.length) return [];
  const rnd = mulberry32(12345);
  // k-means++ initialisation
  const centers: number[][] = [samples[Math.floor(rnd() * samples.length)]];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (centers.length < k) {
    const dist = samples.map((s) => Math.min(...centers.map((c) => d2(s, c))));
    const sum = dist.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    let r = rnd() * sum;
    let idx = 0;
    while (r > dist[idx] && idx < dist.length - 1) r -= dist[idx++];
    centers.push(samples[idx]);
  }
  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let s = 0; s < samples.length; s++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = d2(samples[s], centers[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[s] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let s = 0; s < samples.length; s++) {
      const acc = sums[assign[s]];
      acc[0] += samples[s][0];
      acc[1] += samples[s][1];
      acc[2] += samples[s][2];
      acc[3]++;
    }
    for (let c = 0; c < centers.length; c++)
      if (sums[c][3])
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  const counts = new Array(centers.length).fill(0);
  for (const a of assign) counts[a]++;
  return centers
    .map((c, i) => ({ c, n: counts[i] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map(({ c }) => ({ r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 }));
}
