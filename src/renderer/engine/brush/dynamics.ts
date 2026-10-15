// Evaluates brush dynamics mappings for one dab.
import { makeCurveLut } from '../curve';
import type { BrushPreset, DynamicsInput, DynamicsMapping } from './schema';

export interface DynamicsInputs {
  pressure: number; // 0..1
  speed: number; // 0..1
  tiltX: number; // degrees
  tiltY: number;
  twist: number; // degrees
  /** Stroke direction in radians. */
  direction: number;
  /** Distance along the stroke in px. */
  distance: number;
  random: () => number;
}

export interface DynamicsResult {
  size: number; // multiplier 0..1
  opacity: number;
  flow: number;
  scatter: number;
  texture: number;
  /** Additive, radians. */
  angle: number;
  hue: number; // turns
  saturation: number; // −1..1
  luminance: number; // −1..1
}

const ANGULAR: DynamicsInput[] = ['direction', 'tiltDirection', 'rotation'];
const TWO_PI = Math.PI * 2;

export interface CompiledDynamics {
  mappings: { m: DynamicsMapping; f: (x: number) => number; angular: boolean }[];
  fadeLength: number;
}

export function compileDynamics(brush: BrushPreset): CompiledDynamics {
  return {
    mappings: brush.dynamics
      .filter((m) => m.enabled && m.amount > 0)
      .map((m) => ({ m, f: makeCurveLut(m.curve, 256), angular: ANGULAR.includes(m.input) })),
    fadeLength: Math.max(50, brush.diameter * 30),
  };
}

function inputValue(input: DynamicsInput, s: DynamicsInputs, fadeLength: number): number {
  switch (input) {
    case 'pressure':
      return s.pressure;
    case 'speed':
      return s.speed;
    case 'tilt': {
      // 0 = upright pen, 1 = fully tilted
      const t = Math.hypot(s.tiltX, s.tiltY) / 90;
      return t > 1 ? 1 : t;
    }
    case 'tiltDirection': {
      if (s.tiltX === 0 && s.tiltY === 0) return 0;
      const a = Math.atan2(s.tiltY, s.tiltX);
      return (a < 0 ? a + TWO_PI : a) / TWO_PI;
    }
    case 'direction': {
      const a = s.direction;
      return (((a % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI;
    }
    case 'rotation':
      return (((s.twist % 360) + 360) % 360) / 360;
    case 'random':
      return s.random();
    case 'fade': {
      const f = s.distance / fadeLength;
      return f > 1 ? 1 : f;
    }
  }
}

export function evaluateDynamics(c: CompiledDynamics, s: DynamicsInputs): DynamicsResult {
  const r: DynamicsResult = {
    size: 1,
    opacity: 1,
    flow: 1,
    scatter: 1,
    texture: 1,
    angle: 0,
    hue: 0,
    saturation: 0,
    luminance: 0,
  };
  for (const { m, f, angular } of c.mappings) {
    const v = f(inputValue(m.input, s, c.fadeLength));
    switch (m.output) {
      case 'size':
      case 'opacity':
      case 'flow':
      case 'scatter':
      case 'texture':
        r[m.output] *= 1 - m.amount * (1 - v);
        break;
      case 'angle':
        r.angle += angular ? m.amount * v * TWO_PI : m.amount * (v - 0.5) * TWO_PI;
        break;
      case 'hue':
        r.hue += m.amount * (v - 0.5);
        break;
      case 'saturation':
        r.saturation += m.amount * (v - 0.5) * 2;
        break;
      case 'luminance':
        r.luminance += m.amount * (v - 0.5) * 2;
        break;
    }
  }
  return r;
}
