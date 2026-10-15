// Animation export and time-lapse replay/export dialogs.
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Overlays';
import { Button, Segmented, Slider, Toggle } from '../controls/controls';
import { useUi, confirmDialog } from '../../state/ui';
import { useActiveSession } from '../../state/documents';
import { animationOf, exportAnimation, frames } from '../../app/animation';
import { exposureOf } from '../../engine/animation';
import {
  clearTimelapse,
  decodeFrame,
  exportTimelapse,
  setRecording,
  timelapseFrames,
  timelapseSettings,
  useTimelapse,
} from '../../app/timelapse';

export function AnimationExportDialog() {
  const close = useUi((s) => s.closeDialog);
  const s = useActiveSession();
  const [format, setFormat] = useState<'gif' | 'png-sequence'>('gif');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(!!s?.doc.background.transparent);
  const [progress, setProgress] = useState<number | null>(null);
  if (!s) return null;
  const a = animationOf(s);
  const list = frames(s);
  const ticks = list.reduce((t, f) => t + exposureOf(a, f), 0);
  const w = Math.max(1, Math.round(s.doc.width * scale));
  const h = Math.max(1, Math.round(s.doc.height * scale));
  const run = async () => {
    setProgress(0);
    try {
      await exportAnimation(s, { format, scale, transparent }, setProgress);
      close();
    } finally {
      setProgress(null);
    }
  };
  return (
    <Modal
      title="Export animation"
      onClose={() => progress === null && close()}
      width={440}
      testId="animation-export-dialog"
      footer={
        <>
          <Button onClick={close} disabled={progress !== null}>
            Cancel
          </Button>
          <Button
            kind="primary"
            onClick={() => void run()}
            disabled={progress !== null || !list.length}
            testId="animation-export-run"
          >
            {progress !== null ? `Exporting ${Math.round(progress * 100)} %` : 'Export…'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Segmented
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { id: 'gif', label: 'Animated GIF' },
            { id: 'png-sequence', label: 'PNG sequence' },
          ]}
        />
        <Slider
          label="Size"
          value={scale}
          min={0.1}
          max={1}
          step={0.05}
          displayScale={100}
          unit="%"
          onChange={setScale}
        />
        <Toggle label="Keep transparency" checked={transparent} onChange={setTransparent} />
        <p className="form-note">
          {list.length} frames, {ticks} ticks at {a.fps} fps ({(ticks / a.fps).toFixed(2)} s), {w} × {h} px.{' '}
          {format === 'gif'
            ? `GIF uses up to 256 colours per frame${transparent ? ' and one fully transparent colour (soft edges become hard)' : ''}; ${a.loop ? 'it loops' : 'it plays once'}.`
            : 'One PNG per tick, so held frames repeat and the sequence plays correctly at the frame rate.'}{' '}
          Onion skins are never exported.
        </p>
      </div>
    </Modal>
  );
}

export function TimelapseDialog() {
  const close = useUi((s) => s.closeDialog);
  const s = useActiveSession();
  useTimelapse((t) => t.rev);
  const names = s ? timelapseFrames(s) : [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(20);
  const [format, setFormat] = useState<'gif' | 'png-sequence'>('gif');
  const [progress, setProgress] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const count = names.length;

  const current = count ? names[Math.min(index, count - 1)] : null;
  useEffect(() => {
    if (!s || !current || !s.resources[current]) return;
    let alive = true;
    void decodeFrame(s.resources[current]).then((bmp) => {
      const c = canvas.current;
      if (!alive || !c) return bmp.close();
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
    });
    return () => {
      alive = false;
    };
  }, [s, current]);

  useEffect(() => {
    if (!playing || !count) return;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i + 1 >= count) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [playing, fps, count]);

  if (!s) return null;
  const recording = timelapseSettings(s).recording;
  return (
    <Modal
      title="Time-lapse"
      onClose={() => progress === null && close()}
      width={620}
      testId="timelapse-dialog"
      footer={
        <>
          <Button
            kind="danger"
            disabled={!count || progress !== null}
            onClick={async () => {
              const r = await confirmDialog({
                title: 'Delete the time-lapse?',
                message: `All ${count} recorded frames are removed from the document. This cannot be undone.`,
                buttons: [
                  { id: 'delete', label: 'Delete frames', kind: 'danger' },
                  { id: 'cancel', label: 'Cancel' },
                ],
                cancelId: 'cancel',
              });
              if (r === 'delete') {
                clearTimelapse(s);
                setIndex(0);
              }
            }}
          >
            Delete recording
          </Button>
          <Button onClick={close} disabled={progress !== null}>
            Close
          </Button>
          <Button
            kind="primary"
            disabled={!count || progress !== null}
            testId="timelapse-export"
            onClick={async () => {
              setProgress(0);
              try {
                await exportTimelapse(s, { format, fps, maxSide: 720 }, setProgress);
              } finally {
                setProgress(null);
              }
            }}
          >
            {progress !== null ? `Exporting ${Math.round(progress * 100)} %` : 'Export…'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Toggle
          label="Record a time-lapse of this document"
          checked={recording}
          onChange={(v) => setRecording(s, v)}
          testId="timelapse-record"
        />
        {count ? (
          <>
            <div className="timelapse-view">
              <canvas
                ref={canvas}
                aria-label={`Time-lapse frame ${Math.min(index, count - 1) + 1} of ${count}`}
                role="img"
              />
            </div>
            <div className="timelapse-controls">
              <Button
                icon={playing ? 'pause' : 'play'}
                onClick={() =>
                  index >= count - 1 && !playing ? (setIndex(0), setPlaying(true)) : setPlaying(!playing)
                }
                testId="timelapse-play"
              >
                {playing ? 'Pause' : 'Play'}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0, count - 1)}
                value={Math.min(index, count - 1)}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
                aria-label="Time-lapse position"
                className="timelapse-scrub"
              />
              <span className="timelapse-count">
                {Math.min(index, count - 1) + 1} / {count}
              </span>
            </div>
            <Slider
              label="Speed"
              value={fps}
              min={5}
              max={60}
              step={1}
              unit="fps"
              onChange={(v) => setFps(Math.round(v))}
            />
            <Segmented
              label="Export format"
              value={format}
              onChange={setFormat}
              options={[
                { id: 'gif', label: 'Animated GIF' },
                { id: 'png-sequence', label: 'PNG sequence' },
              ]}
            />
          </>
        ) : (
          <p className="form-note">
            No frames yet. While recording is on, Canvas Forge keeps a small snapshot ({720} px) after your
            edits — at most one every {(timelapseSettings(s).interval / 1000).toFixed(1)} s — and saves them
            with the document.
          </p>
        )}
      </div>
    </Modal>
  );
}
