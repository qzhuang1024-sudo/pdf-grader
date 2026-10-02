import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { isTypingTarget } from '../lib/util';
import { scoreInputRef } from '../components/Sidebar';
import { viewerApi } from '../components/PdfViewer';
import type { ToolId } from '../types';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'highlight',
  d: 'pen',
  t: 'text',
  r: 'rectangle',
  o: 'ellipse',
  a: 'arrow',
  u: 'underline',
  k: 'strikethrough',
  c: 'note',
  e: 'eraser',
};

/**
 * Global shortcuts. Rules to avoid fighting the browser:
 *  - single-letter keys only fire when no modifier is held and focus is not in a text field
 *  - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are only taken over outside text fields
 *    (inside a text field the browser's native text undo keeps working)
 *  - browser zoom (Ctrl + / Ctrl −), find (Ctrl+F), print, tabs etc. are never intercepted
 *  - Ctrl+S is intercepted (it would otherwise save the web page) and flushes autosave
 */
export function useShortcuts(onHelp: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = isTypingTarget(e.target);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey && key === 's') {
        e.preventDefault();
        void s.flush().then(() => s.toast('Saved', 'success'));
        return;
      }
      if (typing) return;

      if (mod && !e.altKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          s.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          s.redo();
        }
        return;
      }
      if (e.altKey || (e.repeat && !['pagedown', 'pageup', 'j', 'l', '+', '=', '-', '_'].includes(key))) return;

      if (e.shiftKey && key === 'r') {
        s.rotateView(90);
        return;
      }
      if (e.shiftKey && !['+', '?', '_'].includes(key)) return;

      switch (key) {
        case 'n':
          e.preventDefault();
          void s.flush().then(() => s.next());
          return;
        case 'p':
          e.preventDefault();
          void s.prev();
          return;
        case 's':
          e.preventDefault();
          scoreInputRef.current?.focus();
          scoreInputRef.current?.select();
          return;
        case '+':
        case '=':
          e.preventDefault();
          s.setZoom(s.zoom * 1.15);
          return;
        case '-':
        case '_':
          e.preventDefault();
          s.setZoom(s.zoom / 1.15);
          return;
        case '0':
          s.setZoom(1);
          return;
        case 'w':
          s.setZoomMode('fit-width');
          return;
        case 'f':
          s.setZoomMode('fit-page');
          return;
        case 'pagedown':
        case 'j':
          if (viewerApi.pageCount) {
            e.preventDefault();
            viewerApi.goToPage(viewerApi.currentPage + 1);
          }
          return;
        case 'pageup':
        case 'l':
          if (viewerApi.pageCount) {
            e.preventDefault();
            viewerApi.goToPage(viewerApi.currentPage - 1);
          }
          return;
        case 'delete':
        case 'backspace':
          if (s.selectedAnnId) {
            e.preventDefault();
            s.removeAnnotation(s.selectedAnnId);
          }
          return;
        case 'escape':
          s.setTool('select');
          s.select(null);
          return;
        case '?':
          onHelp();
          return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) {
        e.preventDefault();
        s.setTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onHelp]);
}

export const SHORTCUTS: [string, string][] = [
  ['N', 'Save & next student'],
  ['P', 'Previous student'],
  ['S', 'Focus the score box'],
  ['Enter (in score box)', 'Save & next student'],
  ['Ctrl+S', 'Save now (autosave is always on)'],
  ['Ctrl+Z', 'Undo annotation'],
  ['Ctrl+Shift+Z / Ctrl+Y', 'Redo annotation'],
  ['+ / −', 'Zoom in / out'],
  ['Ctrl + mouse wheel', 'Zoom the PDF'],
  ['0', 'Zoom 100%'],
  ['W / F', 'Fit width / fit page'],
  ['PageDown / PageUp (J / L)', 'Next / previous page'],
  ['Shift+R', 'Rotate view 90°'],
  ['V', 'Select / move'],
  ['H', 'Highlight'],
  ['D', 'Pen (draw)'],
  ['T', 'Text'],
  ['R', 'Rectangle'],
  ['O', 'Circle / ellipse'],
  ['A', 'Arrow'],
  ['U', 'Underline'],
  ['K', 'Strikethrough'],
  ['C', 'Sticky note / comment'],
  ['E', 'Eraser'],
  ['Delete', 'Delete selected annotation'],
  ['Esc', 'Back to Select tool'],
  ['?', 'Show this list'],
];
