// Commands for drawing assists (symmetry, guides, grid). Selection/transform/shape commands register here too.
import { register } from './commands';
import { activeSession, useDocs, type SymmetryMode } from '../state/documents';
import { requestRedraw } from './actions';
import { toast } from '../state/ui';
import { symmetryLabel } from '../tools/symmetry';

function assist(fn: (a: NonNullable<ReturnType<typeof activeSession>>['assist']) => void) {
  const s = activeSession();
  if (!s) return;
  fn(s.assist);
  requestRedraw();
  useDocs.getState().bump();
}

const SYM_CYCLE: SymmetryMode[] = ['off', 'vertical', 'horizontal', 'both', 'radial', 'kaleido'];

export function setSymmetry(mode: SymmetryMode, segments?: number) {
  assist((a) => {
    a.symmetry.mode = mode;
    if (segments) a.symmetry.segments = segments;
  });
}

export function registerExtendedFeatures() {
  const hasDoc = () => !!activeSession();
  register({
    id: 'assist.symmetry',
    label: 'Symmetry',
    group: 'Assist',
    icon: 'symmetry',
    keys: ['Shift+Y'],
    hint: 'Cycles off → vertical → horizontal → four-way → radial → kaleidoscope. Configure in the assist bar.',
    enabled: hasDoc,
    checked: () => (activeSession()?.assist.symmetry.mode ?? 'off') !== 'off',
    run: () =>
      assist((a) => {
        const i = SYM_CYCLE.indexOf(a.symmetry.mode);
        a.symmetry.mode = SYM_CYCLE[(i + 1) % SYM_CYCLE.length];
        toast('info', symmetryLabel(a.symmetry.mode, a.symmetry.segments));
      }),
  });
  register({
    id: 'assist.ruler',
    label: 'Ruler guide',
    group: 'Assist',
    icon: 'ruler',
    hint: 'Strokes that start near the ruler follow it. Drag its end points with the Transform tool or the assist bar.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.ruler.enabled,
    run: () => assist((a) => void (a.ruler.enabled = !a.ruler.enabled)),
  });
  register({
    id: 'assist.ellipse',
    label: 'Ellipse guide',
    group: 'Assist',
    icon: 'ellipseGuide',
    hint: 'Strokes that start near the ellipse follow its outline.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.ellipse.enabled,
    run: () => assist((a) => void (a.ellipse.enabled = !a.ellipse.enabled)),
  });
  register({
    id: 'assist.perspective',
    label: 'Perspective guides',
    group: 'Assist',
    icon: 'perspective',
    hint: 'Strokes lock toward the vanishing point that matches your initial direction.',
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.perspective.enabled,
    run: () => assist((a) => void (a.perspective.enabled = !a.perspective.enabled)),
  });
  register({
    id: 'assist.grid',
    label: 'Grid',
    group: 'Assist',
    icon: 'grid',
    keys: ["Ctrl+'"],
    enabled: hasDoc,
    checked: () => !!activeSession()?.assist.grid.visible,
    run: () => assist((a) => void (a.grid.visible = !a.grid.visible)),
  });
}
