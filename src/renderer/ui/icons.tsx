// Original Canvas Forge icon set: 20×20 line icons drawn with currentColor.
import type { ReactNode } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS = {
  new: (
    <>
      {P('M5 2.5h6.5l3.5 3.5v11.5H5z')}
      {P('M11.5 2.5V6H15')}
      {P('M10 9v5M7.5 11.5h5')}
    </>
  ),
  open: (
    <>
      {P('M2.5 5.5v10h13.5l2-7H6l-2 7')}
      {P('M2.5 5.5V4h5l1.5 1.5h6v3')}
    </>
  ),
  save: (
    <>
      {P('M3.5 3.5h10l3 3v10h-13z')}
      {P('M6.5 3.5v4h6v-4')}
      {P('M6.5 16.5v-5h7v5')}
    </>
  ),
  export: (
    <>
      {P('M10 12.5V3M6.5 6.5 10 3l3.5 3.5')}
      {P('M4 10v6.5h12V10')}
    </>
  ),
  import: (
    <>
      {P('M10 3v9.5M6.5 9 10 12.5 13.5 9')}
      {P('M4 10v6.5h12V10')}
    </>
  ),
  undo: (
    <>
      {P('M7.5 4 4 7.5 7.5 11')}
      {P('M4 7.5h7.5a4.5 4.5 0 0 1 0 9H8')}
    </>
  ),
  redo: (
    <>
      {P('M12.5 4 16 7.5 12.5 11')}
      {P('M16 7.5H8.5a4.5 4.5 0 0 0 0 9H12')}
    </>
  ),
  zoomIn: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      {P('M12.5 12.5 17 17M8.5 6v5M6 8.5h5')}
    </>
  ),
  zoomOut: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      {P('M12.5 12.5 17 17M6 8.5h5')}
    </>
  ),
  zoom: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      {P('M12.5 12.5 17 17')}
    </>
  ),
  fit: (
    <>
      {P('M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4')}
      <rect x="6.5" y="6.5" width="7" height="7" rx="1" />
    </>
  ),
  actual: (
    <>
      {P('M4.5 7 6 6v8M14 7l1.5-1v8')}
      <circle cx="10" cy="8" r=".6" fill="currentColor" />
      <circle cx="10" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  rotateLeft: (
    <>
      {P('M4 4v4h4')}
      {P('M4.6 7.6A6 6 0 1 1 5 13.5')}
    </>
  ),
  rotateRight: (
    <>
      {P('M16 4v4h-4')}
      {P('M15.4 7.6A6 6 0 1 0 15 13.5')}
    </>
  ),
  rotateReset: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      {P('M10 3.5v3M10 10l2.5-2.5')}
    </>
  ),
  mirror: (
    <>
      {P('M10 2.5v15')}
      {P('M7.5 5.5 3 14.5h4.5zM12.5 5.5 17 14.5h-4.5z')}
    </>
  ),
  focus: (
    <>
      {P('M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4')}
      <circle cx="10" cy="10" r="2" />
    </>
  ),
  brush: (
    <>
      {P('M14.5 2.5 17.5 5.5 9 14l-3-3z')}
      {P('M6 11c-2 0-3 1.5-3 3.5V17h2.5C7.5 17 9 16 9 14')}
    </>
  ),
  eraser: (
    <>
      {P('M11.5 3.5 17 9l-7.5 7.5H5L2.5 14z')}
      {P('M7 8l5.5 5.5M9.5 16.5H17')}
    </>
  ),
  eyedropper: (
    <>
      {P('M12 4.5 15.5 8M13 3.2a2 2 0 0 1 3.8 3.8L14.5 9.3 10.7 5.5z')}
      {P('M11.5 7 4.5 14v2.5H7l7-7')}
    </>
  ),
  fill: (
    <>
      {P('M8.5 3.5 15 10l-5.5 5.5L3 9z')}
      {P('M3 9h12')}
      {P('M16.5 12.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z')}
    </>
  ),
  gradient: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      {P('M6 3v14M9 3v14M12.5 3v14')}
    </>
  ),
  selectRect: <>{P('M3 5V3h2M8 3h4M15 3h2v2M17 8v4M17 15v2h-2M12 17H8M5 17H3v-2M3 12V8')}</>,
  selectEllipse: <>{P('M10 3a7 7 0 0 1 7 7M17 10a7 7 0 0 1-7 7M10 17a7 7 0 0 1-7-7M3 10a7 7 0 0 1 7-7')}</>,
  lasso: (
    <>
      {P('M9.5 13.5C5 13.5 2.5 11.5 2.5 8.5S6 3 10 3s7.5 2 7.5 5-3 5-7 5.5')}
      {P('M9.5 13.5c-1 1.5-.5 3.5 1.5 3.5')}
    </>
  ),
  polygonLasso: <>{P('M3 15 5 4l7 3 5-2-2 11z')}</>,
  wand: (
    <>
      {P('M3 17 12 8')}
      {P('M14 2.5v3M14 9.5v1M17.5 6h-1M11.5 6h-1M16.3 3.7l-.9.9M12.6 7.4l-.6.6M16.3 8.3l-.9-.9')}
    </>
  ),
  transform: (
    <>
      <rect x="5" y="5" width="10" height="10" />
      <rect x="3" y="3" width="3" height="3" fill="currentColor" />
      <rect x="14" y="3" width="3" height="3" fill="currentColor" />
      <rect x="3" y="14" width="3" height="3" fill="currentColor" />
      <rect x="14" y="14" width="3" height="3" fill="currentColor" />
    </>
  ),
  crop: (
    <>
      {P('M5.5 2v12.5H18')}
      {P('M2 5.5h12.5V18')}
    </>
  ),
  line: <>{P('M4 16 16 4')}</>,
  rect: <rect x="3.5" y="5" width="13" height="10" rx="1" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5" />,
  polygon: <>{P('M10 3l7 5-2.7 8.5H5.7L3 8z')}</>,
  polyline: <>{P('M3 15l4-8 4 5 6-8')}</>,
  text: <>{P('M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5')}</>,
  pan: (
    <>
      {P('M10 2.5v15M2.5 10h15')}
      {P('M8 4.5l2-2 2 2M8 15.5l2 2 2-2M4.5 8l-2 2 2 2M15.5 8l2 2-2 2')}
    </>
  ),
  rotate: (
    <>
      {P('M15.5 6.5A6.5 6.5 0 1 0 16.5 11')}
      {P('M16 3v3.8h-3.8')}
    </>
  ),
  layers: (
    <>
      {P('M10 3 17.5 7 10 11 2.5 7z')}
      {P('M2.5 10.5 10 14.5l7.5-4')}
      {P('M2.5 14 10 18l7.5-4')}
    </>
  ),
  colour: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3" />
    </>
  ),
  palette: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </>
  ),
  brushes: (
    <>
      {P('M4 17V9l1.5-4L7 9v8M10 17V7l1.5-4L13 7v10M16 17v-6')}
      {P('M3 17h14')}
    </>
  ),
  animation: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      {P('M6.5 4.5v11M13.5 4.5v11M2.5 8h4M2.5 12h4M13.5 8h4M13.5 12h4')}
    </>
  ),
  reference: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      {P('M2.5 13.5l4-4 3 3 2-2 6 5')}
      <circle cx="13" cy="7.5" r="1.3" />
    </>
  ),
  symmetry: (
    <>
      {P('M10 2v16')}
      {P('M7.5 6C4.5 6 3 8 3 10s1.5 4 4.5 4M12.5 6c3 0 4.5 2 4.5 4s-1.5 4-4.5 4')}
    </>
  ),
  ruler: (
    <>
      {P('M2.5 12.5 12.5 2.5l5 5-10 10z')}
      {P('M6 9l1.5 1.5M8.5 6.5l1.5 1.5M11 4l1.5 1.5')}
    </>
  ),
  ellipseGuide: (
    <>
      <ellipse cx="10" cy="10" rx="7.5" ry="4.5" transform="rotate(-25 10 10)" />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
    </>
  ),
  perspective: (
    <>
      {P('M1.5 9h17')}
      {P('M10 9 2 17M10 9l8 8M10 9l-3 8M10 9l3 8')}
    </>
  ),
  grid: <>{P('M3 3h14v14H3zM3 7.7h14M3 12.3h14M7.7 3v14M12.3 3v14')}</>,
  predictive: (
    <>
      {P('M3 15c3-8 6 0 9-6 1-2 2-3 3.5-3')}
      {P('M15.5 2.5v2M15.5 7.5v2M13 6h-1M19 6h-1')}
    </>
  ),
  stabilizer: (
    <>
      {P('M2.5 7c2-2 3-2 5 0s3 2 5 0 3-2 5 0')}
      {P('M2.5 13.5c5 0 10 0 15 0')}
    </>
  ),
  settings: (
    <>
      {P('M3 5.5h8M15 5.5h2M3 10h3M10 10h7M3 14.5h9M16 14.5h1')}
      <circle cx="13" cy="5.5" r="2" />
      <circle cx="8" cy="10" r="2" />
      <circle cx="14" cy="14.5" r="2" />
    </>
  ),
  plus: <>{P('M10 4v12M4 10h12')}</>,
  minus: <>{P('M4 10h12')}</>,
  trash: (
    <>
      {P('M3.5 5.5h13M8 5.5V3.5h4v2')}
      {P('M5 5.5l.8 11h8.4l.8-11M8.5 8.5v5.5M11.5 8.5v5.5')}
    </>
  ),
  duplicate: (
    <>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
      {P('M13.5 6.5V4a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h2.5')}
    </>
  ),
  eye: (
    <>
      {P('M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z')}
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      {P('M3 3l14 14')}
      {P(
        'M8 5c.6-.2 1.3-.3 2-.3 5 0 8.2 5.3 8.2 5.3s-.8 1.4-2.3 2.8M12.7 14.9c-.8.4-1.7.6-2.7.6-5 0-8.2-5.5-8.2-5.5s1-1.7 2.8-3.2',
      )}
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      {P('M7 9V6.5a3 3 0 0 1 6 0V9')}
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      {P('M7 9V6.5a3 3 0 0 1 5.8-1')}
    </>
  ),
  alphaLock: (
    <>
      <rect x="3" y="3" width="9" height="9" rx="1" />
      {P('M3 7.5h9M7.5 3v9')}
      <rect x="11" y="12" width="6.5" height="5" rx="1" />
      {P('M12.5 12v-1.5a1.75 1.75 0 0 1 3.5 0V12')}
    </>
  ),
  clip: <>{P('M5 3v8.5a2.5 2.5 0 0 0 2.5 2.5H15M12 11l3 3-3 3')}</>,
  mask: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <circle cx="10" cy="10" r="4" fill="currentColor" fillOpacity=".35" />
    </>
  ),
  group: <>{P('M2.5 5.5V15.5h15V7h-8L8 5.5z')}</>,
  merge: (
    <>
      {P('M10 3v9M6.5 8.5 10 12l3.5-3.5')}
      {P('M3.5 16h13')}
    </>
  ),
  chevronDown: <>{P('M5 7.5l5 5 5-5')}</>,
  chevronRight: <>{P('M7.5 5l5 5-5 5')}</>,
  chevronLeft: <>{P('M12.5 5l-5 5 5 5')}</>,
  chevronUp: <>{P('M5 12.5l5-5 5 5')}</>,
  close: <>{P('M5 5l10 10M15 5 5 15')}</>,
  more: (
    <>
      <circle cx="4.5" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1.2" fill="currentColor" />
    </>
  ),
  star: <>{P('M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z')}</>,
  starFilled: (
    <path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" fill="currentColor" />
  ),
  swap: (
    <>
      {P('M4 7h10.5M11.5 4l3 3-3 3')}
      {P('M16 13H5.5M8.5 10l-3 3 3 3')}
    </>
  ),
  reset: (
    <>
      {P('M4 10a6 6 0 1 0 1.8-4.3')}
      {P('M4 3v3.5h3.5')}
    </>
  ),
  check: <>{P('M4 10.5l4 4 8-9')}</>,
  warning: (
    <>
      {P('M10 3 18 17H2z')}
      {P('M10 8v4.5')}
      <circle cx="10" cy="14.8" r=".7" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      {P('M10 9v5')}
      <circle cx="10" cy="6.3" r=".7" fill="currentColor" />
    </>
  ),
  play: <path d="M6 4l10 6-10 6z" fill="currentColor" />,
  pause: (
    <>
      <rect x="5" y="4" width="3.5" height="12" rx=".5" fill="currentColor" />
      <rect x="11.5" y="4" width="3.5" height="12" rx=".5" fill="currentColor" />
    </>
  ),
  stop: <rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" />,
  onion: (
    <>
      <circle cx="7.5" cy="10" r="5" />
      <circle cx="12.5" cy="10" r="5" strokeDasharray="2 1.6" />
    </>
  ),
  frameAdd: (
    <>
      <rect x="3" y="4" width="10" height="12" rx="1.5" />
      {P('M16 7v6M13 10h6')}
    </>
  ),
  loop: (
    <>
      {P('M4 9V8a3 3 0 0 1 3-3h9M13.5 2.5 16 5l-2.5 2.5')}
      {P('M16 11v1a3 3 0 0 1-3 3H4M6.5 17.5 4 15l2.5-2.5')}
    </>
  ),
  record: <circle cx="10" cy="10" r="5" fill="currentColor" />,
  keyboard: (
    <>
      <rect x="2" y="5" width="16" height="10" rx="1.5" />
      {P('M5 8h1M8 8h1M11 8h1M14 8h1M5 11h1M14 11h1M7.5 11h5')}
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      {P('M7.8 7.8A2.3 2.3 0 0 1 12.2 8.5c0 1.6-2.2 1.8-2.2 3.3')}
      <circle cx="10" cy="14.3" r=".7" fill="currentColor" />
    </>
  ),
  menu: <>{P('M3 5.5h14M3 10h14M3 14.5h14')}</>,
  float: (
    <>
      <rect x="2.5" y="6.5" width="11" height="11" rx="1.5" />
      {P('M8 3.5h8.5V12')}
    </>
  ),
  dock: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      {P('M12 3.5v13')}
    </>
  ),
  collapse: <>{P('M5 12.5l5-5 5 5')}</>,
  expand: <>{P('M5 7.5l5 5 5-5')}</>,
  fullscreen: <>{P('M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 7l-4-4M13 7l4-4M13 13l4 4M7 13l-4 4')}</>,
  orbit: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <circle cx="10" cy="10" r="7" strokeDasharray="3.2 2.3" />
    </>
  ),
  puck: (
    <>
      <circle cx="10" cy="10" r="7" />
      {P('M6 10h8M10 6v8')}
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      {P('M2.5 13.5l4-4 3 3 2-2 6 5')}
    </>
  ),
  pin: <>{P('M10 17v-5M6 4h8l-1.5 4L15 11H5l2.5-3z')}</>,
  adjust: (
    <>
      <circle cx="10" cy="10" r="7" />
      {P('M10 3v14')}
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </>
  ),
  resize: (
    <>
      <rect x="2.5" y="8.5" width="9" height="9" rx="1" />
      {P('M11 3h6v6M17 3l-6.5 6.5')}
    </>
  ),
  flipH: (
    <>
      {P('M10 2.5v15')}
      {P('M7 6 3 10l4 4zM13 6l4 4-4 4z')}
    </>
  ),
  flipV: (
    <>
      {P('M2.5 10h15')}
      {P('M6 7l4-4 4 4zM6 13l4 4 4-4z')}
    </>
  ),
  copy: (
    <>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
      {P('M13.5 6.5V4a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h2.5')}
    </>
  ),
  cut: (
    <>
      <circle cx="5.5" cy="14.5" r="2.5" />
      <circle cx="14.5" cy="14.5" r="2.5" />
      {P('M7.3 12.7 15 3M12.7 12.7 5 3')}
    </>
  ),
  paste: (
    <>
      {P('M7 4H4.5v13.5h11V4H13')}
      <rect x="7" y="2.5" width="6" height="3" rx="1" />
    </>
  ),
  selectAll: <>{P('M3 3h14v14H3z')}</>,
  deselect: <>{P('M3 5V3h2M8 3h4M15 3h2v2M17 8v4M17 15v2h-2M12 17H8M5 17H3v-2M3 12V8M6 6l8 8M14 6l-8 8')}</>,
  invert: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1" />
      <path d="M3 3h14L3 17z" fill="currentColor" fillOpacity=".4" />
    </>
  ),
  timelapse: (
    <>
      <circle cx="10" cy="10" r="7" />
      {P('M10 5.5V10l3 2')}
      {P('M3 3.5 5 5.5')}
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}): ReactNode {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}

/** Canvas Forge app mark: an original anvil-and-spark glyph in the accent gradient. */
export function AppMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cf-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ec4b2" />
          <stop offset="0.55" stopColor="#5f97e6" />
          <stop offset="1" stopColor="#8b6ef0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#cf-mark)" />
      <path
        d="M5.8 12.2C7.9 11.4 9.6 11 11.6 11H25v3.2h-4.2l-1.6 4L23 21.2v1.9H10.2v-1.9l3.6-3-1.4-4h-1.1c-2.2 0-4-.7-5.5-2z"
        fill="#0f1114"
        opacity=".88"
      />
      <path d="M23 4.8l1.1 2.7 2.7 1.1-2.7 1.1L23 12.4l-1.1-2.7-2.7-1.1 2.7-1.1z" fill="#fff" />
    </svg>
  );
}
