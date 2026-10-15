// Tool instances by id.
import type { ToolId } from '../state/ui';
import { BrushTool } from './brush-tool';
import { EyedropperTool } from './eyedropper';
import { PanTool, RotateTool, ZoomTool } from './nav-tools';
import { LassoTool, MarqueeTool, PolygonLassoTool, WandTool } from './select-tools';
import { TransformTool } from './transform-tool';
import { CropTool, FillTool, GradientTool, ShapeTool } from './paint-tools';
import { TextTool } from './text-tool';
import type { Tool } from './types';

const tools = new Map<ToolId, Tool>();

export function registerTool(id: ToolId, t: Tool) {
  tools.set(id, t);
}

registerTool('brush', new BrushTool(false));
registerTool('eraser', new BrushTool(true));
registerTool('eyedropper', new EyedropperTool());
registerTool('pan', new PanTool());
registerTool('zoom', new ZoomTool());
registerTool('rotate', new RotateTool());
registerTool('select-rect', new MarqueeTool('rect'));
registerTool('select-ellipse', new MarqueeTool('ellipse'));
registerTool('select-lasso', new LassoTool());
registerTool('select-polygon', new PolygonLassoTool());
registerTool('select-wand', new WandTool());
registerTool('transform', new TransformTool());
registerTool('crop', new CropTool());
registerTool('fill', new FillTool());
registerTool('gradient', new GradientTool());
registerTool('line', new ShapeTool('line'));
registerTool('rect', new ShapeTool('rect'));
registerTool('ellipse', new ShapeTool('ellipse'));
registerTool('polygon', new ShapeTool('polygon'));
registerTool('polyline', new ShapeTool('polyline'));
registerTool('text', new TextTool());

const fallback = tools.get('brush')!;

export function getTool(id: ToolId): Tool {
  return tools.get(id) ?? fallback;
}

/** Tools whose overlays should draw: the active tool plus the eyedropper loupe when used temporarily. */
export function overlayTools(active: ToolId): Tool[] {
  const list = [getTool(active)];
  const eye = tools.get('eyedropper')!;
  if (active !== 'eyedropper') list.push(eye);
  return list;
}

export function hasTool(id: ToolId): boolean {
  return tools.has(id);
}
