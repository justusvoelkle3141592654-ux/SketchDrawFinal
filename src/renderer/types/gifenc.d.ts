// Minimal typings for gifenc 1.0.3 (the package ships JavaScript only); covers the API used here.
declare module 'gifenc' {
  export type GifPalette = number[][];
  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    format?: GifColorFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
  }

  export interface WriteFrameOptions {
    palette?: GifPalette;
    /** Frame duration in milliseconds. */
    delay?: number;
    /** -1 = play once, 0 = loop forever, > 0 = repeat count (first frame only). */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions,
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array;
}
