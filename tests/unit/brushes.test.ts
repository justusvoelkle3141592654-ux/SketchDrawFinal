import { describe, expect, it } from 'vitest';
import { FACTORY_BRUSHES } from '../../src/renderer/engine/brush/presets';
import { BRUSH_SCHEMA_VERSION, validateBrush, migrateBrush } from '../../src/renderer/engine/brush/schema';

const REQUIRED: Record<string, string[]> = {
  Sketch: [
    'Graphite Fine',
    'Graphite Soft',
    'Mechanical 0.5',
    'Blue Construction',
    'Rough Charcoal',
    'Compressed Charcoal',
  ],
  Ink: ['Studio Ink', 'Tapered Liner', 'Technical Pen', 'Brush Pen', 'Dry Ink', 'Calligraphy Edge'],
  Paint: ['Soft Air', 'Hard Round', 'Flat Gouache', 'Opaque Painter', 'Round Bristle', 'Fan Bristle'],
  Markers: ['Chisel Marker', 'Alcohol Soft', 'Highlighter', 'Felt Fine', 'Broad Felt', 'Neon Accent'],
  Texture: ['Chalk Dust', 'Dry Pastel', 'Grain Pencil', 'Canvas Dab', 'Speckle Wash', 'Stipple Field'],
  Effects: ['Water Blend', 'Finger Smudge', 'Edge Blender', 'Pixel Eraser', 'Soft Eraser', 'Texture Eraser'],
};

describe('factory brushes', () => {
  it('contains all 36 required presets in their categories', () => {
    for (const [cat, names] of Object.entries(REQUIRED)) {
      for (const name of names) {
        const b = FACTORY_BRUSHES.find((x) => x.name === name);
        expect(b, name).toBeDefined();
        expect(b!.category, name).toBe(cat);
      }
    }
    expect(FACTORY_BRUSHES.length).toBeGreaterThanOrEqual(36);
    expect(FACTORY_BRUSHES.length).toBeLessThanOrEqual(48);
  });
  it('ids are unique and presets survive validation unchanged', () => {
    const ids = new Set(FACTORY_BRUSHES.map((b) => b.id));
    expect(ids.size).toBe(FACTORY_BRUSHES.length);
    for (const b of FACTORY_BRUSHES) {
      const v = validateBrush(JSON.parse(JSON.stringify(b)));
      expect(v, b.name).toEqual(b);
    }
  });
  it('validation clamps hostile values', () => {
    const v = validateBrush({
      id: 'x',
      name: 'x',
      diameter: 1e9,
      opacity: -3,
      count: 999,
      dynamics: [{ input: 'nope', output: 'size', curve: 'bad' }],
      stroke: { blendMode: 'evil' },
    });
    expect(v.diameter).toBe(1000);
    expect(v.opacity).toBe(0);
    expect(v.count).toBe(16);
    expect(v.dynamics[0].input).toBe('pressure');
    expect(v.stroke.blendMode).toBe('normal');
    expect(v.schemaVersion).toBe(BRUSH_SCHEMA_VERSION);
  });
  it('migrates v0 drafts and refuses future versions', () => {
    expect(migrateBrush({ id: 'a', size: 33, spacing: 0.5 })).toMatchObject({
      diameter: 33,
      schemaVersion: 1,
      stroke: { spacing: 0.5 },
    });
    expect(() => validateBrush({ id: 'a', name: 'n', schemaVersion: 99 })).toThrow(/newer brush format/);
  });
});
