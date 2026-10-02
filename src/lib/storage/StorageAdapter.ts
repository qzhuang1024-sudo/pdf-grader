import type { AnnotationDoc, Assignment, GradedFile } from '../../types';

/**
 * Persistence boundary. The UI/store only talks to this interface.
 *
 * v1 ships with IndexedDbAdapter (local-first, nothing leaves the machine).
 * A future backend / Google Drive / OneDrive / Dropbox adapter only has to
 * implement these methods; it could also wrap IndexedDbAdapter as a local
 * cache and sync in the background.
 */
export interface StorageAdapter {
  init(): Promise<void>;

  listAssignments(): Promise<Assignment[]>;
  putAssignment(a: Assignment): Promise<void>;
  deleteAssignment(id: string): Promise<void>; // also deletes its files, PDFs and annotations

  listFiles(assignmentId: string): Promise<GradedFile[]>;
  putFiles(files: GradedFile[]): Promise<void>;
  deleteFile(fileId: string): Promise<void>; // also deletes PDF + annotations

  getPdf(fileId: string): Promise<Blob | null>;
  putPdf(fileId: string, data: Blob): Promise<void>;

  getAnnotations(fileId: string): Promise<AnnotationDoc | null>;
  putAnnotations(doc: AnnotationDoc): Promise<void>;

  /** total size of all stored PDFs (all assignments) */
  usage(): Promise<{ pdfBytes: number; fileCount: number; assignmentCount: number }>;
  /** permanently delete EVERYTHING this app stored */
  clearAll(): Promise<void>;

  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}
