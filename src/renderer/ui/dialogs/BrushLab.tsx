// Temporary Brush Lab shell (replaced by the full editor).
import { Modal } from '../Overlays';
import { useUi } from '../../state/ui';

export function BrushLab() {
  const close = useUi((s) => s.closeDialog);
  return (
    <Modal title="Brush Lab" onClose={close} width={500}>
      <p>Loading…</p>
    </Modal>
  );
}
