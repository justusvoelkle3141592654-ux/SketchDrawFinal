// Layer tree model.
import type { BlendMode } from './blend';
import type { MaskGrid } from './tiles';
import { TileGrid } from './tiles';
import { uid } from './random';

export type LabelColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'grey';
export const LABEL_COLORS: { id: LabelColor; css: string }[] = [
  { id: 'none', css: 'transparent' },
  { id: 'red', css: '#e0616a' },
  { id: 'orange', css: '#e59a4f' },
  { id: 'yellow', css: '#d9c556' },
  { id: 'green', css: '#6bbf74' },
  { id: 'teal', css: '#3fbfb0' },
  { id: 'blue', css: '#5b8ee6' },
  { id: 'violet', css: '#9b7be8' },
  { id: 'grey', css: '#8d929b' },
];

interface LayerCommon {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  label: LabelColor;
}

export interface RasterLayer extends LayerCommon {
  kind: 'raster';
  pixels: TileGrid;
  mask: MaskGrid | null;
  maskEnabled: boolean;
  /** When true, painting targets the mask instead of the pixels. */
  editMask: boolean;
  alphaLock: boolean;
  /** Clip to the nearest non-clipping layer below. */
  clip: boolean;
}

export interface GroupLayer extends LayerCommon {
  kind: 'group';
  children: LayerNode[];
  expanded: boolean;
  passThrough: boolean;
}

export type LayerNode = RasterLayer | GroupLayer;

export function createRasterLayer(name: string, tileSize: number): RasterLayer {
  return {
    kind: 'raster',
    id: uid('L'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    label: 'none',
    pixels: new TileGrid(tileSize),
    mask: null,
    maskEnabled: true,
    editMask: false,
    alphaLock: false,
    clip: false,
  };
}

export function createGroupLayer(name: string): GroupLayer {
  return {
    kind: 'group',
    id: uid('G'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    label: 'none',
    children: [],
    expanded: true,
    passThrough: true,
  };
}

export interface LayerLocation {
  node: LayerNode;
  parent: GroupLayer | null;
  siblings: LayerNode[];
  index: number;
  depth: number;
}

/** Depth-first search. Lists are ordered bottom → top. */
export function findLayer(roots: LayerNode[], id: string): LayerLocation | null {
  const walk = (list: LayerNode[], parent: GroupLayer | null, depth: number): LayerLocation | null => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.id === id) return { node: n, parent, siblings: list, index: i, depth };
      if (n.kind === 'group') {
        const r = walk(n.children, n, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(roots, null, 0);
}

export function forEachLayer(roots: LayerNode[], cb: (n: LayerNode, depth: number) => void): void {
  const walk = (list: LayerNode[], depth: number) => {
    for (const n of list) {
      cb(n, depth);
      if (n.kind === 'group') walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
}

export function allRasterLayers(roots: LayerNode[]): RasterLayer[] {
  const out: RasterLayer[] = [];
  forEachLayer(roots, (n) => {
    if (n.kind === 'raster') out.push(n);
  });
  return out;
}

/** Display order for the layers panel: top → bottom, respecting collapsed groups. */
export function flattenForPanel(roots: LayerNode[]): { node: LayerNode; depth: number }[] {
  const out: { node: LayerNode; depth: number }[] = [];
  const walk = (list: LayerNode[], depth: number) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      out.push({ node: n, depth });
      if (n.kind === 'group' && n.expanded) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** True when the node and all of its ancestors are visible. */
export function isEffectivelyVisible(roots: LayerNode[], id: string): boolean {
  const path: LayerNode[] = [];
  const walk = (list: LayerNode[]): boolean => {
    for (const n of list) {
      path.push(n);
      if (n.id === id) return true;
      if (n.kind === 'group' && walk(n.children)) return true;
      path.pop();
    }
    return false;
  };
  if (!walk(roots)) return false;
  return path.every((n) => n.visible);
}

export function isDescendant(group: GroupLayer, id: string): boolean {
  for (const c of group.children) {
    if (c.id === id) return true;
    if (c.kind === 'group' && isDescendant(c, id)) return true;
  }
  return false;
}

export function layerByteSize(n: LayerNode): number {
  if (n.kind === 'raster') return n.pixels.byteSize + (n.mask?.byteSize ?? 0);
  return n.children.reduce((s, c) => s + layerByteSize(c), 0);
}

/** Deep copy including pixel data, with fresh ids. */
export function cloneLayer(n: LayerNode, nameSuffix = ''): LayerNode {
  if (n.kind === 'raster') {
    return {
      ...n,
      id: uid('L'),
      name: n.name + nameSuffix,
      pixels: n.pixels.clone(),
      mask: n.mask ? n.mask.clone() : null,
    };
  }
  return { ...n, id: uid('G'), name: n.name + nameSuffix, children: n.children.map((c) => cloneLayer(c)) };
}
