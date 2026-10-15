// Builds dab transforms for the document's symmetry settings.
import {
  composeTransforms,
  mirrorX,
  mirrorY,
  rotateAbout,
  type DabTransform,
} from '../engine/stroke/stroke-engine';
import type { AssistState } from '../state/documents';

export function symmetryTransforms(sym: AssistState['symmetry']): DabTransform[] {
  const { cx, cy } = sym;
  switch (sym.mode) {
    case 'vertical':
      return [mirrorX(cx)];
    case 'horizontal':
      return [mirrorY(cy)];
    case 'both':
      return [mirrorX(cx), mirrorY(cy), composeTransforms(mirrorX(cx), mirrorY(cy))];
    case 'radial': {
      const n = Math.max(2, Math.min(32, Math.round(sym.segments)));
      const out: DabTransform[] = [];
      for (let k = 1; k < n; k++) out.push(rotateAbout(cx, cy, (k * Math.PI * 2) / n));
      return out;
    }
    case 'kaleido': {
      const n = Math.max(2, Math.min(32, Math.round(sym.segments)));
      const out: DabTransform[] = [mirrorX(cx)];
      for (let k = 1; k < n; k++) {
        const rot = rotateAbout(cx, cy, (k * Math.PI * 2) / n);
        out.push(rot, composeTransforms(mirrorX(cx), rot));
      }
      return out;
    }
    default:
      return [];
  }
}

export function symmetryLabel(mode: AssistState['symmetry']['mode'], segments: number): string {
  switch (mode) {
    case 'vertical':
      return 'Vertical mirror';
    case 'horizontal':
      return 'Horizontal mirror';
    case 'both':
      return 'Four-way mirror';
    case 'radial':
      return `Radial ×${segments}`;
    case 'kaleido':
      return `Kaleidoscope ×${segments}`;
    default:
      return 'Symmetry off';
  }
}
