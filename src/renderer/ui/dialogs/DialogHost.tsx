// Renders the active modal dialog.
import { useUi } from '../../state/ui';
import { AboutDialog, ExportDialog, NewDocumentDialog } from './BasicDialogs';
import { PreferencesDialog } from './PreferencesDialog';
import { BrushLab } from './BrushLab';
import { RecoveryDialog } from './RecoveryDialog';
import { AdjustDialog, CanvasSizeDialog, ImageSizeDialog } from './ImageDialogs';

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'new-document':
      return <NewDocumentDialog />;
    case 'export':
      return <ExportDialog />;
    case 'preferences':
      return <PreferencesDialog />;
    case 'about':
      return <AboutDialog />;
    case 'brush-lab':
      return <BrushLab />;
    case 'recovery':
      return <RecoveryDialog />;
    case 'image-size':
      return <ImageSizeDialog />;
    case 'canvas-size':
      return <CanvasSizeDialog />;
    case 'adjust':
      return <AdjustDialog />;
    default:
      return null;
  }
}
