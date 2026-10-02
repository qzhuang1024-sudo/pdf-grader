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

export async function pdfsFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (it.kind === 'file' && 'webkitGetAsEntry' in it ? (it.webkitGetAsEntry() as FsEntry | null) : null))
    .filter((e): e is FsEntry => !!e);
  if (entries.length) {
    const out: File[] = [];
    for (const e of entries) await walk(e, out);
    return out;
  }
  return pdfsFromFileList(dt.files);
}
