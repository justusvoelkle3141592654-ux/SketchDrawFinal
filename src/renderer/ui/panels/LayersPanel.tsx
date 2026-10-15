// Layers panel: stack, visibility, thumbnails, rename, reorder (drag & drop), blend mode, opacity and actions.
import { useEffect, useRef, useState } from 'react';
import { useActiveSession, useDocs, type DocumentSession } from '../../state/documents';
import { BLEND_MODES, type BlendMode } from '../../engine/blend';
import {
  flattenForPanel,
  LABEL_COLORS,
  type LabelColor,
  type LayerNode,
  type RasterLayer,
} from '../../engine/layers';
import { snapshotStructure, structureEntry, type StructureState } from '../../engine/history';
import * as A from '../../app/actions';
import { tooltipFor } from '../../app/commands';
import { Icon } from '../icons';
import { IconButton, Select, Slider } from '../controls/controls';

function Thumbnail({
  layer,
  version,
  docW,
  docH,
}: {
  layer: RasterLayer;
  version: number;
  docW: number;
  docH: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = layer.pixels;
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      const W = 44;
      const H = 32;
      const k = Math.min(W / docW, H / docH);
      const w = Math.max(1, Math.round(docW * k));
      const h = Math.max(1, Math.round(docH * k));
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      // Box filter over existing tiles only (cost scales with painted area); premultiplied sums.
      const acc = new Float32Array(w * h * 4);
      const ts = grid.tileSize;
      const step = Math.max(1, Math.floor(1 / k / 4));
      const sx = w / docW;
      const sy = h / docH;
      for (const [key, tile] of grid.tiles) {
        const tx = (key % 8192) - 4096;
        const ty = Math.floor(key / 8192) - 4096;
        for (let y = 0; y < ts; y += step) {
          const dy = ty * ts + y;
          if (dy < 0 || dy >= docH) continue;
          const oy = Math.min(h - 1, Math.floor(dy * sy));
          for (let x = 0; x < ts; x += step) {
            const dx = tx * ts + x;
            if (dx < 0 || dx >= docW) continue;
            const i = (y * ts + x) * 4;
            const a = tile[i + 3];
            if (!a) continue;
            const o = (oy * w + Math.min(w - 1, Math.floor(dx * sx))) * 4;
            acc[o] += tile[i] * a;
            acc[o + 1] += tile[i + 1] * a;
            acc[o + 2] += tile[i + 2] * a;
            acc[o + 3] += a;
          }
        }
      }
      const samplesPerPixel = Math.max(1, (1 / sx / step) * (1 / sy / step));
      const img = ctx.createImageData(w, h);
      for (let p = 0; p < w * h; p++) {
        const a = acc[p * 4 + 3];
        if (!a) continue;
        img.data[p * 4] = acc[p * 4] / a;
        img.data[p * 4 + 1] = acc[p * 4 + 1] / a;
        img.data[p * 4 + 2] = acc[p * 4 + 2] / a;
        // boost coverage so thin lines stay visible in a tiny thumbnail
        img.data[p * 4 + 3] = Math.min(255, (a / samplesPerPixel) * 3);
      }
      ctx.putImageData(img, 0, 0);
    }, 150);
    return () => clearTimeout(t);
  }, [grid, version, docW, docH]);
  return <canvas ref={ref} className="layer-thumb" aria-hidden="true" />;
}

interface DragState {
  id: string;
  overId: string | null;
  where: 'above' | 'below' | 'into';
}

function LayerRow(props: {
  session: DocumentSession;
  node: LayerNode;
  depth: number;
  active: boolean;
  drag: DragState | null;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onMenu: (id: string, x: number, y: number) => void;
}) {
  const { node, depth, active, session } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  useEffect(() => setName(node.name), [node.name]);
  const commitName = () => {
    setEditing(false);
    const n = name.trim().slice(0, 120);
    if (n && n !== node.name) A.setLayerProps(node.id, { name: n }, 'Rename layer');
    else setName(node.name);
  };
  const dropClass =
    props.drag && props.drag.overId === node.id && props.drag.id !== node.id
      ? `drop-${props.drag.where}`
      : '';
  const label = LABEL_COLORS.find((l) => l.id === node.label);
  const meta = [
    node.blendMode !== 'normal' ? BLEND_MODES.find((b) => b.id === node.blendMode)?.label : '',
    node.opacity < 1 ? `${Math.round(node.opacity * 100)}%` : '',
    node.kind === 'group' && !node.passThrough ? 'isolated' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const thumb =
    node.kind === 'raster' ? (
      <span className={`layer-thumb-wrap ${node.clip ? 'is-clipped' : ''}`}>
        {node.clip ? <Icon name="clip" size={12} className="clip-mark" /> : null}
        <Thumbnail
          layer={node}
          version={node.pixels.version}
          docW={session.doc.width}
          docH={session.doc.height}
        />
      </span>
    ) : (
      <span className="layer-thumb-wrap is-group">
        <Icon name="group" size={20} />
      </span>
    );
  const text = (
    <span className="layer-text">
      {editing ? (
        <input
          className="layer-name-input"
          value={name}
          autoFocus
          aria-label="Layer name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') {
              setName(node.name);
              setEditing(false);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="layer-name">{node.name}</span>
      )}
      <span className="layer-meta">{meta}</span>
    </span>
  );
  return (
    <div
      role="listitem"
      className={`layer-row ${active ? 'is-active' : ''} ${!node.visible ? 'is-hidden' : ''} ${dropClass} ${props.drag?.id === node.id ? 'is-dragging' : ''}`}
      data-layer-id={node.id}
      data-testid="layer-row"
      style={{ paddingLeft: 6 + depth * 14 }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.layer-side-btn, input')) return;
        A.selectLayer(node.id);
        props.onDragStart(node.id, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        A.selectLayer(node.id);
        props.onMenu(node.id, e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.layer-side-btn')) return;
        setEditing(true);
      }}
    >
      {label && label.id !== 'none' ? (
        <span className="layer-label" style={{ background: label.css }} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className="mini-btn layer-eye layer-side-btn"
        aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
        aria-pressed={node.visible}
        data-tip={node.visible ? 'Hide layer' : 'Show layer'}
        onClick={() =>
          A.setLayerProps(node.id, { visible: !node.visible }, node.visible ? 'Hide layer' : 'Show layer')
        }
        data-testid="layer-eye"
      >
        <Icon name={node.visible ? 'eye' : 'eyeOff'} size={15} />
      </button>
      {node.kind === 'group' ? (
        <button
          type="button"
          className="mini-btn layer-side-btn"
          aria-label={node.expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={node.expanded}
          onClick={() => {
            node.expanded = !node.expanded;
            session.doc.structureVersion++;
            useDocs.getState().bump();
          }}
        >
          <Icon name={node.expanded ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
      ) : null}
      {editing ? (
        <span className="layer-select">
          {thumb}
          {text}
        </span>
      ) : (
        <button
          type="button"
          className="layer-select"
          aria-pressed={active}
          aria-label={`${node.name}${node.kind === 'group' ? ' (group)' : ''}${meta ? `, ${meta}` : ''}`}
          tabIndex={active ? 0 : -1}
          data-layer-select={node.id}
          onClick={() => A.selectLayer(node.id)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              setEditing(true);
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              A.selectLayerRelative(e.key === 'ArrowUp' ? 1 : -1);
              // keep keyboard focus on the newly active layer
              requestAnimationFrame(() => {
                const id = session.doc.activeLayerId;
                document.querySelector<HTMLElement>(`[data-layer-select="${id}"]`)?.focus();
              });
            }
          }}
        >
          {thumb}
          {text}
        </button>
      )}
      {node.kind === 'raster' && node.mask ? (
        <button
          type="button"
          className={`mask-chip layer-side-btn ${node.editMask ? 'is-on' : ''} ${!node.maskEnabled ? 'is-disabled' : ''}`}
          aria-label={
            node.editMask ? 'Painting on mask — click to paint on pixels' : 'Click to paint on the mask'
          }
          data-tip={
            node.editMask
              ? 'Painting on the mask (click to paint pixels). Shift+click disables the mask.'
              : 'Paint on the mask. Shift+click disables the mask.'
          }
          onClick={(e) => {
            if (e.shiftKey)
              A.setLayerProps(
                node.id,
                { maskEnabled: !node.maskEnabled },
                node.maskEnabled ? 'Disable mask' : 'Enable mask',
              );
            else A.setLayerProps(node.id, { editMask: !node.editMask }, 'Mask editing');
          }}
        >
          <Icon name="mask" size={14} />
        </button>
      ) : null}
      <span className="layer-flags">
        {node.kind === 'raster' && node.alphaLock ? (
          <Icon name="alphaLock" size={13} title="Transparency locked" />
        ) : null}
        {node.locked ? <Icon name="lock" size={13} title="Locked" /> : null}
      </span>
    </div>
  );
}

export function LayersPanel() {
  const session = useActiveSession();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const opacityEdit = useRef<StructureState | null>(null);
  if (!session) return <p className="panel-empty">Open or create a document to see its layers.</p>;
  const doc = session.doc;
  const rows = flattenForPanel(doc.layers);
  const active = doc.activeLayer;

  const startDrag = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sy = e.clientY;
    let dragging = false;
    let state: DragState | null = null;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - sy) < 5) return;
      dragging = true;
      const under = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((x) => (x as HTMLElement).dataset?.layerId) as HTMLElement | undefined;
      if (!under) return;
      const r = under.getBoundingClientRect();
      const overId = under.dataset.layerId!;
      const overNode = doc.getLayer(overId);
      const t = (ev.clientY - r.top) / r.height;
      const where: DragState['where'] =
        overNode?.kind === 'group' && t > 0.3 && t < 0.7 ? 'into' : t < 0.5 ? 'above' : 'below';
      state = { id, overId, where };
      setDrag(state);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!dragging || !state || state.overId === id) return;
      const target = (state as DragState).overId;
      if (!target) return;
      const loc = findLoc(session, target);
      if (!loc) return;
      if ((state as DragState).where === 'into') A.moveLayerTo(id, target, Number.MAX_SAFE_INTEGER);
      else {
        // panel order is top→bottom; lists are bottom→top
        const idx = (state as DragState).where === 'above' ? loc.index + 1 : loc.index;
        A.moveLayerTo(id, loc.parentId, idx);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const beginOpacity = () => {
    if (!opacityEdit.current) opacityEdit.current = snapshotStructure(doc);
  };
  const changeOpacity = (v: number) => {
    if (!active) return;
    beginOpacity();
    active.opacity = v;
    doc.markStructureChanged();
    useDocs.getState().bump();
  };
  const commitOpacity = () => {
    if (!opacityEdit.current) return;
    const before = opacityEdit.current;
    opacityEdit.current = null;
    session.history.push(structureEntry(doc, 'Layer opacity', before, snapshotStructure(doc)));
  };

  return (
    <div className="layers-panel">
      <div className="panel-toolbar">
        <IconButton
          icon="plus"
          label="New layer"
          tip={tooltipFor('layer.new')}
          onClick={A.newLayer}
          testId="layer-new"
        />
        <IconButton icon="group" label="New group" tip="New group" onClick={A.newGroup} />
        <IconButton
          icon="duplicate"
          label="Duplicate layer"
          tip={tooltipFor('layer.duplicate')}
          onClick={A.duplicateLayer}
        />
        <IconButton
          icon="merge"
          label="Merge down"
          tip={tooltipFor('layer.mergeDown')}
          onClick={A.mergeDown}
        />
        <IconButton
          icon="mask"
          label="Add layer mask"
          tip="Add layer mask (from selection when one exists)"
          onClick={() => A.addMask(!!doc.selection)}
        />
        <IconButton
          icon="trash"
          label="Delete layer"
          tip={tooltipFor('layer.delete')}
          onClick={() => void A.deleteLayer()}
          testId="layer-delete"
        />
        <IconButton
          icon="more"
          label="More layer actions"
          tip="More layer actions"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (active) setMenu({ id: active.id, x: r.left, y: r.bottom + 4 });
          }}
        />
      </div>
      {active ? (
        <div className="layer-props">
          <Select<BlendMode>
            label="Blend"
            compact
            value={active.blendMode}
            options={BLEND_MODES}
            onChange={(v) => A.setLayerProps(active.id, { blendMode: v }, 'Blend mode')}
            testId="layer-blend"
          />
          <Slider
            label="Opacity"
            value={active.opacity}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            onChange={changeOpacity}
            onCommit={commitOpacity}
            testId="layer-opacity"
          />
          <div className="layer-prop-toggles">
            {active.kind === 'raster' ? (
              <>
                <IconButton
                  icon="alphaLock"
                  label="Lock transparency"
                  tip={tooltipFor('layer.alphaLock')}
                  pressed={active.alphaLock}
                  onClick={A.toggleAlphaLock}
                  size={16}
                />
                <IconButton
                  icon="clip"
                  label="Clip to layer below"
                  tip={tooltipFor('layer.clip')}
                  pressed={active.clip}
                  onClick={A.toggleClip}
                  size={16}
                />
              </>
            ) : (
              <IconButton
                icon="layers"
                label="Isolate group"
                tip="Isolated group: blend mode and opacity apply to the group as a whole (otherwise pass-through)"
                pressed={!active.passThrough}
                onClick={() =>
                  A.setLayerProps(active.id, { passThrough: !active.passThrough }, 'Group blending')
                }
                size={16}
              />
            )}
            <IconButton
              icon={active.locked ? 'lock' : 'unlock'}
              label="Lock layer"
              tip="Lock layer against painting"
              pressed={active.locked}
              onClick={() =>
                A.setLayerProps(
                  active.id,
                  { locked: !active.locked },
                  active.locked ? 'Unlock layer' : 'Lock layer',
                )
              }
              size={16}
            />
          </div>
        </div>
      ) : null}
      <div className="layer-list" role="list" aria-label="Layers" ref={listRef} data-testid="layer-list">
        {rows.map(({ node, depth }) => (
          <LayerRow
            key={node.id}
            session={session}
            node={node}
            depth={depth}
            active={node.id === doc.activeLayerId}
            drag={drag}
            onDragStart={startDrag}
            onMenu={(id, x, y) => setMenu({ id, x, y })}
          />
        ))}
        <div
          className={`layer-row layer-bg ${doc.background.transparent ? 'is-transparent' : ''}`}
          role="listitem"
        >
          <span className="layer-thumb-wrap">
            <span
              className="bg-thumb"
              style={{
                background: doc.background.transparent
                  ? undefined
                  : `rgb(${doc.background.color.r * 255},${doc.background.color.g * 255},${doc.background.color.b * 255})`,
              }}
            />
          </span>
          <div className="layer-text">
            <span className="layer-name">Background</span>
            <span className="layer-meta">{doc.background.transparent ? 'Transparent' : 'Solid colour'}</span>
          </div>
        </div>
      </div>
      {menu ? (
        <LayerMenu session={session} id={menu.id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}

function findLoc(session: DocumentSession, id: string): { parentId: string | null; index: number } | null {
  const walk = (
    list: LayerNode[],
    parentId: string | null,
  ): { parentId: string | null; index: number } | null => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.id === id) return { parentId, index: i };
      if (n.kind === 'group') {
        const r = walk(n.children, n.id);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(session.doc.layers, null);
}

function LayerMenu({
  session,
  id,
  x,
  y,
  onClose,
}: {
  session: DocumentSession;
  id: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const node = session.doc.getLayer(id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  if (!node) return null;
  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      {label}
    </button>
  );
  const raster = node.kind === 'raster' ? node : null;
  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 380) }}
    >
      {item('Duplicate', A.duplicateLayer)}
      {item('Delete', () => void A.deleteLayer(id))}
      {item('Group into new group', A.groupLayer)}
      <div className="menu-sep" />
      {item('Merge down', A.mergeDown, !raster)}
      {item('Merge visible', A.mergeVisible)}
      {item('Flatten to new layer', A.flattenCopy)}
      {item(session.doc.selection ? 'Clear selection area' : 'Clear layer', A.clearLayer, !raster)}
      <div className="menu-sep" />
      {item(
        raster?.mask ? 'Delete layer mask' : 'Add layer mask',
        () => (raster?.mask ? A.deleteMask() : A.addMask(!!session.doc.selection)),
        !raster,
      )}
      {item('Apply layer mask', A.applyMask, !raster?.mask)}
      {item(raster?.alphaLock ? 'Unlock transparency' : 'Lock transparency', A.toggleAlphaLock, !raster)}
      {item(raster?.clip ? 'Release clipping mask' : 'Clip to layer below', A.toggleClip, !raster)}
      {item(node.locked ? 'Unlock layer' : 'Lock layer', () => A.setLayerProps(id, { locked: !node.locked }))}
      <div className="menu-sep" />
      <div className="menu-labels" role="group" aria-label="Colour label">
        {LABEL_COLORS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`label-dot ${node.label === l.id ? 'is-on' : ''}`}
            style={{ background: l.id === 'none' ? undefined : l.css }}
            aria-label={`Label ${l.id}`}
            data-tip={l.id === 'none' ? 'No label' : `${l.id} label`}
            onClick={() => {
              onClose();
              A.setLayerProps(id, { label: l.id as LabelColor }, 'Layer label');
            }}
          />
        ))}
      </div>
    </div>
  );
}
