// Tool instances by id.
import type { ToolId } from '../state/ui';
import { BrushTool } from './brush-tool';
import { EyedropperTool } from './eyedropper';
import { PanTool, RotateTool, ZoomTool } from './nav-tools';
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
