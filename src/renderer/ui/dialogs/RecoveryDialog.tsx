// Offers documents recovered from autosave snapshots after an unexpected exit.
import { useState } from 'react';
import { Modal } from '../Overlays';
import { Button } from '../controls/controls';
import { useUi } from '../../state/ui';
import { forge } from '../../platform';
import type { RecoveryEntry } from '../../../shared/ipc';
import { openRecovered } from '../../app/file-actions';

export function RecoveryDialog() {
  const close = useUi((s) => s.closeDialog);
  const initial = (useUi.getState().dialog?.props?.entries as RecoveryEntry[]) ?? [];
  const [entries, setEntries] = useState(initial);
  const restore = async (e: RecoveryEntry) => {
    const bytes = await forge.recoveryRead(e.id);
    if (!bytes) {
      useUi.getState().toast('error', `The recovery data for "${e.title}" could not be read.`);
      return;
    }
    try {
      // same path as opening a file: layers, features, resources, stored brushes and palette
      openRecovered(bytes, e.title);
      await forge.recoveryDelete(e.id);
      setEntries((list) => list.filter((x) => x.id !== e.id));
      useUi.getState().toast('success', `Recovered "${e.title}". Save it to keep it.`);
    } catch (err) {
      useUi.getState().toast('error', `"${e.title}" could not be recovered.`, (err as Error).message);
    }
  };
  const discard = async (e: RecoveryEntry) => {
    await forge.recoveryDelete(e.id);
    setEntries((list) => list.filter((x) => x.id !== e.id));
  };
  return (
    <Modal
      title="Recover unsaved work"
      onClose={close}
      width={560}
      testId="recovery-dialog"
      footer={
        <Button kind="primary" onClick={close}>
          Done
        </Button>
      }
    >
      {entries.length === 0 ? (
        <p>Nothing left to recover.</p>
      ) : (
        <>
          <p>Canvas Forge found work that was not saved when it last closed.</p>
          <ul className="recovery-list">
            {entries.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.title}</strong>
                  <span className="muted">
                    {' '}
                    · {e.width} × {e.height} px · {new Date(e.savedAt).toLocaleString()} ·{' '}
                    {(e.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                  {e.originalPath ? <div className="muted mono">{e.originalPath}</div> : null}
                </div>
                <div className="recovery-actions">
                  <Button kind="primary" onClick={() => void restore(e)}>
                    Recover
                  </Button>
                  <Button kind="danger" onClick={() => void discard(e)}>
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
