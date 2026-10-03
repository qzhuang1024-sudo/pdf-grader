/** Collect PDF files from <input type=file>, a folder picker, or a drag & drop (incl. folders). */

export function isPdf(f: File) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

export function pdfsFromFileList(list: FileList | File[] | null): File[] {
  if (!list) return [];
  return Array.from(list).filter(isPdf);
}

// Minimal typings for the (non-standard but universally supported) entries API
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FsFileEntry extends FsEntry {
  file(cb: (f: File) => void, err: (e: unknown) => void): void;
}
interface FsDirEntry extends FsEntry {
  createReader(): { readEntries(cb: (e: FsEntry[]) => void, err: (e: unknown) => void): void };
}

async function walk(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FsFileEntry).file(res, rej));
    if (isPdf(f)) out.push(f);
  } else if (entry.isDirectory) {
    const reader = (entry as FsDirEntry).createReader();
    // readEntries returns results in batches; keep reading until empty
    for (;;) {
      const batch = await new Promise<FsEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

export interface DropResult {
  pdfs: File[];
  /** folders that were dropped but could not be read (e.g. Chrome blocks this for file:// pages) */
  unreadableFolders: string[];
}

/**
 * Everything that touches the DataTransfer happens synchronously first — the browser empties it
 * as soon as the drop event handler returns.
 *  - Plain files come from dt.files (works everywhere, including a page opened from file://).
 *  - Dropped folders are walked with the entries API; if the browser refuses (file:// pages in
 *    Chrome can), they are reported so the UI can suggest "Open folder" instead.
 */
export async function pdfsFromDataTransfer(dt: DataTransfer): Promise<DropResult> {
  const files = Array.from(dt.files ?? []);
  const dirs: FsEntry[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== 'file' || !('webkitGetAsEntry' in it)) continue;
    try {
      const e = it.webkitGetAsEntry() as FsEntry | null;
      if (e?.isDirectory) dirs.push(e);
    } catch {
      /* ignore */
    }
  }

  const pdfs = files.filter(isPdf);
  const unreadableFolders: string[] = [];
  for (const d of dirs) {
    try {
      const found: File[] = [];
      await walk(d, found);
      pdfs.push(...found);
    } catch (err) {
      console.warn('Could not read dropped folder', d.name, err);
      unreadableFolders.push(d.name);
    }
  }
  return { pdfs, unreadableFolders };
}
