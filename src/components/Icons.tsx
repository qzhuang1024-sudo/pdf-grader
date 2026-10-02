// Tiny inline icon set (no icon-font dependency). 20×20 viewBox, stroke = currentColor.
import type { ReactNode } from 'react';

const P = ({ children, fill }: { children: ReactNode; fill?: boolean }) => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Icon = {
  select: () => <P><path d="M5 3l10 6.5-4.6 1 2.6 5-2 1-2.6-5L5 15z" /></P>,
  highlight: () => <P><path d="M4 16h12" strokeWidth="2.5" stroke="#f2c500" /><path d="M7 12l6-8 3 2-6 8H7z" /></P>,
  pen: () => <P><path d="M3 17c3-1 4-6 7-7s3 3 7-3" /></P>,
  text: () => <P><path d="M5 5h10M10 5v11M7.5 16h5" /></P>,
  rectangle: () => <P><rect x="3.5" y="5" width="13" height="10" rx="1" /></P>,
  ellipse: () => <P><ellipse cx="10" cy="10" rx="7" ry="5" /></P>,
  arrow: () => <P><path d="M4 16L16 4M9 4h7v7" /></P>,
  underline: () => <P><path d="M6 4v5a4 4 0 008 0V4M5 16.5h10" /></P>,
  strikethrough: () => <P><path d="M14 6c-1-1.4-2.4-2-4-2-2 0-3.5 1-3.5 2.6 0 3.4 7.5 2 7.5 5.6C14 14 12.4 16 10 16c-1.8 0-3.2-.7-4-2M3.5 10h13" /></P>,
  note: () => <P><path d="M4 4h12v9l-3 3H4z" /><path d="M13 16v-3h3M7 8h6M7 11h4" /></P>,
  eraser: () => <P><path d="M8 16l-4-4 8-8 5 5-7 7zM11 16h6M6 10l5 5" /></P>,
  undo: () => <P><path d="M7 8H13a4 4 0 010 8h-3M7 8l3-3M7 8l3 3" /></P>,
  redo: () => <P><path d="M13 8H7a4 4 0 000 8h3M13 8l-3-3M13 8l-3 3" /></P>,
  zoomIn: () => <P><path d="M10 5v10M5 10h10" /></P>,
  zoomOut: () => <P><path d="M5 10h10" /></P>,
  fitWidth: () => <P><path d="M3 4v12M17 4v12M6 10h8M6 10l2-2M6 10l2 2M14 10l-2-2M14 10l-2 2" /></P>,
  fitPage: () => <P><rect x="5" y="3" width="10" height="14" rx="1" /><path d="M8 7h4M8 10h4M8 13h2" /></P>,
  rotate: () => <P><path d="M15 9a5.5 5.5 0 10-1.6 4.4M15 4v5h-5" /></P>,
  chevUp: () => <P><path d="M6 12l4-4 4 4" /></P>,
  chevDown: () => <P><path d="M6 8l4 4 4-4" /></P>,
  chevLeft: () => <P><path d="M12 5l-5 5 5 5" /></P>,
  chevRight: () => <P><path d="M8 5l5 5-5 5" /></P>,
  file: () => <P><path d="M5 2.5h6.5L15 6v11.5H5z" /><path d="M11 2.5V6h4" /></P>,
  folder: () => <P><path d="M2.5 5.5V15a1 1 0 001 1h13a1 1 0 001-1V7.5a1 1 0 00-1-1H9.5L8 4.5H3.5a1 1 0 00-1 1z" /></P>,
  download: () => <P><path d="M10 3v10M6 9l4 4 4-4M4 16h12" /></P>,
  trash: () => <P><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" /></P>,
  check: () => <P><path d="M4.5 10.5l3.5 3.5 7.5-8" /></P>,
  keyboard: () => <P><rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M5.5 8h1M9.5 8h1M13.5 8h1M5.5 11.5h9" /></P>,
  plus: () => <P><path d="M10 4v12M4 10h12" /></P>,
  edit: () => <P><path d="M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3" /></P>,
};
