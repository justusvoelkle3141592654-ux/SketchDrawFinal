// Flipbook timeline: frames (top-level layers), exposure, playback, onion skin, held layers, export.
import { useEffect, useRef } from 'react';
import { useActiveSession, type DocumentSession } from '../../state/documents';
import { useUi } from '../../state/ui';
import { IconButton, Button, Slider, Toggle } from '../controls/controls';
import { Icon } from '../icons';
import { tooltipFor } from '../../app/commands';
import { exposureOf, frameLayout, MAX_EXPOSURE } from '../../engine/animation';
import type { LayerNode } from '../../engine/layers';
import {
  addFrame,
  animationOf,
  currentFrame,
  deleteFrame,
  duplicateFrame,
  goToFrame,
  moveFrame,
  setAnimationEnabled,
  setExposure,
  stepFrame,
  togglePlay,
  updateAnimation,
  usePlayback,
} from '../../app/animation';
import { drawStackThumbnail, nodeVersion, visibleRasters } from '../thumbs';

function FrameThumb({ node, s }: { node: LayerNode; s: DocumentSession }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = nodeVersion(node);
  useEffect(() => {
    const t = setTimeout(() => {
      if (ref.current)
        drawStackThumbnail(ref.current, visibleRasters(node), s.doc.width, s.doc.height, 76, 52);
    }, 60);
    return () => clearTimeout(t);
  }, [node, s, version]);
  return <canvas ref={ref} className="frame-thumb" aria-hidden="true" />;
}

export function AnimationPanel() {
  const s = useActiveSession();
  const playing = usePlayback((p) => p.playing);
  const preparing = usePlayback((p) => p.preparing);
  const playFrame = usePlayback((p) => p.frame);
  const stripRef = useRef<HTMLDivElement>(null);
  const cur = s ? currentFrame(s) : -1;
  const shown = playing ? playFrame : cur;
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [shown]);
  if (!s) return <p className="panel-empty">Open a document to animate it.</p>;
  const a = animationOf(s);
  if (!a.enabled) {
    return (
      <div className="anim-off">
        <p>
          Turn this document into a flipbook: every top-level layer or group becomes one frame, from the
          bottom (first) to the top (last).
        </p>
        <Button
          kind="primary"
          icon="animation"
          onClick={() => setAnimationEnabled(s, true)}
          testId="anim-enable"
        >
          Turn on animation
        </Button>
      </div>
    );
  }
  const layout = frameLayout(s.doc, a);
  const list = layout.frames;
  const total = list.reduce((t, f) => t + exposureOf(a, f), 0);
  const seconds = total / a.fps;
  const curNode = list[cur];
  return (
    <div className="anim-panel">
      <div className="anim-transport" role="toolbar" aria-label="Playback">
        <IconButton
          icon="chevronLeft"
          label="Previous frame"
          tip={tooltipFor('anim.prev')}
          onClick={() => stepFrame(s, -1)}
          disabled={playing}
        />
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause' : 'Play'}
          tip={tooltipFor('anim.play')}
          onClick={togglePlay}
          pressed={playing}
          testId="anim-play"
        />
        <IconButton
          icon="chevronRight"
          label="Next frame"
          tip={tooltipFor('anim.next')}
          onClick={() => stepFrame(s, 1)}
          disabled={playing}
        />
        <IconButton
          icon="loop"
          label="Loop"
          tip="Loop playback"
          pressed={a.loop}
          onClick={() => updateAnimation(s, 'Loop playback', (x) => void (x.loop = !x.loop))}
        />
        <IconButton
          icon="onion"
          label="Onion skin"
          tip={tooltipFor('anim.onion')}
          pressed={a.onion.enabled}
          onClick={() => updateAnimation(s, 'Onion skin', (x) => void (x.onion.enabled = !x.onion.enabled))}
          testId="anim-onion"
        />
        <label className="anim-fps">
          <input
            type="number"
            min={1}
            max={60}
            value={a.fps}
            aria-label="Frames per second"
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 1 && v <= 60) updateAnimation(s, 'Frame rate', (x) => void (x.fps = v));
            }}
            data-testid="anim-fps"
          />
          <span>fps</span>
        </label>
        <span className="anim-time" aria-label="Duration">
          {preparing !== null
            ? `Preparing ${Math.round(preparing * 100)} %`
            : `${list.length} frames · ${seconds.toFixed(2)} s`}
        </span>
        <IconButton
          icon="export"
          label="Export animation…"
          tip="Export as animated GIF or PNG sequence"
          onClick={() => useUi.getState().openDialog('animation-export')}
          testId="anim-export"
        />
      </div>
      <div
        className="frame-strip"
        role="list"
        aria-label="Frames"
        ref={stripRef}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          stepFrame(s, e.key === 'ArrowRight' ? 1 : -1);
          requestAnimationFrame(() =>
            stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus(),
          );
        }}
      >
        {layout.background ? (
          <div
            role="listitem"
            className="frame-card is-held"
            data-tip="Held background: shown behind every frame"
          >
            <FrameThumb node={layout.background} s={s} />
            <span className="frame-label">BG</span>
          </div>
        ) : null}
        {list.map((f, i) => {
          const exp = exposureOf(a, f);
          return (
            <div role="listitem" key={f.id} className="frame-item" style={{ flexGrow: 0 }}>
              <button
                type="button"
                className={`frame-card ${i === shown ? 'is-current' : ''} ${f.visible ? '' : 'is-hidden'}`}
                aria-current={i === shown}
                aria-label={`Frame ${i + 1}: ${f.name}${exp > 1 ? `, held for ${exp} frames` : ''}${f.visible ? '' : ', hidden'}`}
                tabIndex={i === shown ? 0 : -1}
                onClick={() => goToFrame(s, i)}
                disabled={playing}
                data-testid="frame-card"
              >
                <FrameThumb node={f} s={s} />
                <span className="frame-label">{i + 1}</span>
                {exp > 1 ? <span className="frame-exposure">×{exp}</span> : null}
              </button>
            </div>
          );
        })}
        {layout.foreground ? (
          <div
            role="listitem"
            className="frame-card is-held"
            data-tip="Held foreground: shown above every frame"
          >
            <FrameThumb node={layout.foreground} s={s} />
            <span className="frame-label">FG</span>
          </div>
        ) : null}
      </div>
      <div className="anim-frame-actions" role="toolbar" aria-label="Frame actions">
        <IconButton
          icon="frameAdd"
          label="New frame"
          tip={tooltipFor('anim.addFrame')}
          onClick={() => addFrame(s)}
          disabled={playing}
          testId="anim-add"
        />
        <IconButton
          icon="duplicate"
          label="Duplicate frame"
          tip={tooltipFor('anim.duplicateFrame')}
          onClick={() => duplicateFrame(s)}
          disabled={playing || !curNode}
        />
        <IconButton
          icon="trash"
          label="Delete frame"
          tip="Delete the current frame"
          onClick={() => void deleteFrame(s)}
          disabled={playing || !curNode}
        />
        <IconButton
          icon="chevronLeft"
          label="Move frame earlier"
          tip="Move the current frame earlier"
          onClick={() => moveFrame(s, -1)}
          disabled={playing || cur <= 0}
        />
        <IconButton
          icon="chevronRight"
          label="Move frame later"
          tip="Move the current frame later"
          onClick={() => moveFrame(s, 1)}
          disabled={playing || cur < 0 || cur >= list.length - 1}
        />
        <span className="anim-sep" aria-hidden="true" />
        <span className="anim-exposure" role="group" aria-label="Exposure of the current frame">
          <IconButton
            icon="minus"
            label="Shorter exposure"
            tip="Hold this frame for fewer ticks"
            disabled={!curNode || exposureOf(a, curNode) <= 1}
            onClick={() => setExposure(s, cur, exposureOf(a, curNode!) - 1)}
            size={14}
          />
          <span className="anim-exposure-value" data-testid="anim-exposure">
            ×{curNode ? exposureOf(a, curNode) : 1}
          </span>
          <IconButton
            icon="plus"
            label="Longer exposure"
            tip="Hold this frame for more ticks"
            disabled={!curNode || exposureOf(a, curNode) >= MAX_EXPOSURE}
            onClick={() => setExposure(s, cur, exposureOf(a, curNode!) + 1)}
            size={14}
          />
        </span>
      </div>
      <details className="anim-settings">
        <summary>
          <Icon name="settings" size={14} /> Onion skin and held layers
        </summary>
        <Slider
          label="Before"
          value={a.onion.before}
          min={0}
          max={5}
          step={1}
          onChange={(v) => updateAnimation(s, 'Onion skin', (x) => void (x.onion.before = Math.round(v)))}
        />
        <Slider
          label="After"
          value={a.onion.after}
          min={0}
          max={5}
          step={1}
          onChange={(v) => updateAnimation(s, 'Onion skin', (x) => void (x.onion.after = Math.round(v)))}
        />
        <Slider
          label="Opacity"
          value={a.onion.opacity}
          min={0.05}
          max={1}
          step={0.01}
          displayScale={100}
          unit="%"
          onChange={(v) => updateAnimation(s, 'Onion skin', (x) => void (x.onion.opacity = v))}
        />
        <Toggle
          label="Tint (earlier red, later blue)"
          checked={a.onion.tint}
          onChange={(v) => updateAnimation(s, 'Onion skin', (x) => void (x.onion.tint = v))}
        />
        <Toggle
          label="Hold bottom layer as background"
          checked={a.holdBackground}
          onChange={(v) => updateAnimation(s, 'Hold background', (x) => void (x.holdBackground = v))}
        />
        <Toggle
          label="Hold top layer as foreground"
          checked={a.holdForeground}
          onChange={(v) => updateAnimation(s, 'Hold foreground', (x) => void (x.holdForeground = v))}
        />
        <Button kind="ghost" onClick={() => setAnimationEnabled(s, false)}>
          Turn off animation
        </Button>
      </details>
    </div>
  );
}
