import type { AnnotationDoc, Assignment, GradedFile } from '../../types';
import type { StorageAdapter } from './StorageAdapter';

const DB_NAME = 'pdf-grading-workspace';
const DB_VERSION = 1;

/*
 * Object stores
 *   assignments  key: id
 *   files        key: id          index: assignmentId
 *   pdfs         key: fileId      { fileId, data: Blob }   ← original, untouched PDF bytes
 *   annotations  key: fileId      { fileId, annotations[], updatedAt }
 *   settings     key: key         { key, value }
 */

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export class IndexedDbAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('assignments')) db.createObjectStore('assignments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'id' });
          s.createIndex('assignmentId', 'assignmentId', { unique: false });
        }
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('annotations')) db.createObjectStore('annotations', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab of this app.'));
    });
    // Ask the browser not to evict our data under storage pressure (best effort).
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
  }

  private get d(): IDBDatabase {
    if (!this.db) throw new Error('Storage not initialised');
    return this.db;
  }

  async listAssignments(): Promise<Assignment[]> {
    const tx = this.d.transaction('assignments', 'readonly');
    return req(tx.objectStore('assignments').getAll() as IDBRequest<Assignment[]>);
  }

  async putAssignment(a: Assignment): Promise<void> {
    const tx = this.d.transaction('assignments', 'readwrite');
    tx.objectStore('assignments').put(a);
    await txDone(tx);
  }

  async deleteAssignment(id: string): Promise<void> {
    const files = await this.listFiles(id);
    const tx = this.d.transaction(['assignments', 'files', 'pdfs', 'annotations'], 'readwrite');
    tx.objectStore('assignments').delete(id);
    for (const f of files) {
      tx.objectStore('files').delete(f.id);
      tx.objectStore('pdfs').delete(f.id);
      tx.objectStore('annotations').delete(f.id);
    }
    await txDone(tx);
  }

  async listFiles(assignmentId: string): Promise<GradedFile[]> {
    const tx = this.d.transaction('files', 'readonly');
    const idx = tx.objectStore('files').index('assignmentId');
    return req(idx.getAll(assignmentId) as IDBRequest<GradedFile[]>);
  }

  async putFiles(files: GradedFile[]): Promise<void> {
    if (!files.length) return;
    const tx = this.d.transaction('files', 'readwrite');
    const s = tx.objectStore('files');
    for (const f of files) s.put(f);
    await txDone(tx);
  }

  async deleteFile(fileId: string): Promise<void> {
    const tx = this.d.transaction(['files', 'pdfs', 'annotations'], 'readwrite');
    tx.objectStore('files').delete(fileId);
    tx.objectStore('pdfs').delete(fileId);
    tx.objectStore('annotations').delete(fileId);
    await txDone(tx);
  }

  async getPdf(fileId: string): Promise<Blob | null> {
    const tx = this.d.transaction('pdfs', 'readonly');
    const rec = (await req(tx.objectStore('pdfs').get(fileId))) as { data: Blob } | undefined;
    return rec?.data ?? null;
  }

  async putPdf(fileId: string, data: Blob): Promise<void> {
    const tx = this.d.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put({ fileId, data });
    await txDone(tx);
  }

  async getAnnotations(fileId: string): Promise<AnnotationDoc | null> {
    const tx = this.d.transaction('annotations', 'readonly');
    return ((await req(tx.objectStore('annotations').get(fileId))) as AnnotationDoc | undefined) ?? null;
  }

  async putAnnotations(doc: AnnotationDoc): Promise<void> {
    const tx = this.d.transaction('annotations', 'readwrite');
    tx.objectStore('annotations').put(doc);
    await txDone(tx);
  }

  async usage() {
    const tx = this.d.transaction(['files', 'assignments'], 'readonly');
    const files = (await req(tx.objectStore('files').getAll())) as GradedFile[];
    const assignmentCount = (await req(tx.objectStore('assignments').count())) as number;
    return { pdfBytes: files.reduce((a, f) => a + (f.size || 0), 0), fileCount: files.length, assignmentCount };
  }

  async clearAll(): Promise<void> {
    this.db?.close();
    this.db = null;
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Close other tabs/windows of this tool, then try again.'));
    });
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const tx = this.d.transaction('settings', 'readonly');
    const rec = (await req(tx.objectStore('settings').get(key))) as { value: T } | undefined;
    return rec?.value;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const tx = this.d.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    await txDone(tx);
  }
}

export const storage: StorageAdapter = new IndexedDbAdapter();
