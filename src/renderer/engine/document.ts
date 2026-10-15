// Raster document: dimensions, background, layer tree, selection and change notification.
import type { RGB } from './color';
import type { Rect } from './geometry';
import { createRasterLayer, findLayer, type LayerNode, type RasterLayer } from './layers';
import type { MaskGrid } from './tiles';
import { DEFAULT_TILE_SIZE } from './tiles';
import { uid } from './random';

export interface DocumentBackground {
  transparent: boolean;
  color: RGB;
}

export interface DocumentInit {
  width: number;
  height: number;
  dpi?: number;
  tileSize?: number;
  background?: DocumentBackground;
  title?: string;
}

export type DirtyListener = (rect: Rect | null) => void;

export const MAX_DOCUMENT_SIDE = 16384;
export const MIN_DOCUMENT_SIDE = 1;

export class RasterDocument {
  readonly id = uid('D');
  width: number;
  height: number;
  dpi: number;
  readonly tileSize: number;
  background: DocumentBackground;
  layers: LayerNode[] = [];
  activeLayerId = '';
  /** Selection coverage (0 = unselected). null = no selection, i.e. everything is editable. */
  selection: MaskGrid | null = null;
  title: string;
  created = new Date().toISOString();
  modified = new Date().toISOString();
  /** Bumped whenever the layer tree or layer properties change (drives UI refresh). */
  structureVersion = 0;
  /** Bumped whenever pixels change (drives thumbnails, autosave). */
  pixelVersion = 0;
  selectionVersion = 0;
  private dirtyListeners = new Set<DirtyListener>();

  constructor(init: DocumentInit) {
    if (
      !Number.isInteger(init.width) ||
      !Number.isInteger(init.height) ||
      init.width < MIN_DOCUMENT_SIDE ||
      init.height < MIN_DOCUMENT_SIDE ||
      init.width > MAX_DOCUMENT_SIDE ||
      init.height > MAX_DOCUMENT_SIDE
    ) {
      throw new Error(`Document size must be between 1 and ${MAX_DOCUMENT_SIDE} pixels per side.`);
    }
    this.width = init.width;
    this.height = init.height;
    this.dpi = init.dpi ?? 144;
    this.tileSize = init.tileSize ?? DEFAULT_TILE_SIZE;
    this.background = init.background ?? { transparent: false, color: { r: 1, g: 1, b: 1 } };
    this.title = init.title ?? 'Untitled';
  }

  /** Creates the standard starting stack: one empty paint layer. */
  static createDefault(init: DocumentInit): RasterDocument {
    const doc = new RasterDocument(init);
    const layer = createRasterLayer('Layer 1', doc.tileSize);
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    return doc;
  }

  get bounds(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  getLayer(id: string): LayerNode | null {
    return findLayer(this.layers, id)?.node ?? null;
  }

  get activeLayer(): LayerNode | null {
    return this.getLayer(this.activeLayerId);
  }

  get activeRaster(): RasterLayer | null {
    const l = this.activeLayer;
    return l && l.kind === 'raster' ? l : null;
  }

  onDirty(cb: DirtyListener): () => void {
    this.dirtyListeners.add(cb);
    return () => this.dirtyListeners.delete(cb);
  }

  /** Marks a document rect as needing recomposition. null = whole document. */
  invalidate(rect: Rect | null = null): void {
    for (const l of this.dirtyListeners) l(rect);
  }

  markPixelsChanged(rect: Rect | null = null): void {
    this.pixelVersion++;
    this.modified = new Date().toISOString();
    this.invalidate(rect);
  }

  markStructureChanged(): void {
    this.structureVersion++;
    this.modified = new Date().toISOString();
    this.invalidate(null);
  }

  markSelectionChanged(): void {
    this.selectionVersion++;
  }

  estimatedBytes(): number {
    let total = 0;
    const walk = (list: LayerNode[]) => {
      for (const n of list) {
        if (n.kind === 'raster') total += n.pixels.byteSize + (n.mask?.byteSize ?? 0);
        else walk(n.children);
      }
    };
    walk(this.layers);
    return total;
  }
}

/** Approximate memory for a new document: layers × pixels × 4 + composite surface + view buffers. */
export function estimateDocumentMemory(width: number, height: number, layers = 2): number {
  const px = width * height;
  return px * 4 * layers + px * 4 * 2;
}
