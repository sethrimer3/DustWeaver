/**
 * Disk-side reader for installed Steam Workshop packages. Runs ONLY in the
 * Electron main process (or Node tests) — never import this from renderer
 * code, which reaches the same logic through the WORKSHOP_READ_PACKAGE IPC
 * channel in `../platform/ipcBridge.ts`.
 *
 * The live Steam UGC calls (publish/subscribe/download) deliberately live in
 * `electron/workshopUgc.cjs` instead of here: that file runs unbundled in the
 * main process alongside `platformBridge.cjs`, so keeping one implementation
 * there avoids a second copy of the native-API surface drifting out of sync.
 */
import type { WorkshopInstalledPackage } from './types';
import type { WorkshopPackageFile } from './packageValidator';

// This module only ever runs in the Electron main process (Node), never in
// the browser/renderer build, so a bare ambient `require` is safe here.
declare const require: (id: string) => unknown;

interface NodeFsModule {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number };
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  realpathSync(path: string): string;
}
interface NodePathModule {
  join(...segments: string[]): string;
  relative(from: string, to: string): string;
  resolve(...segments: string[]): string;
  sep: string;
}

function walkPackageFiles(fs: NodeFsModule, path: NodePathModule, rootDir: string): WorkshopPackageFile[] {
  const results: WorkshopPackageFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
        results.push({ path: relPath, sizeBytes: stat.size });
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * Reads an installed Workshop package directory: `workshop-meta.json` at the
 * root, plus exactly one `*.dwcampaign.json` file (root or nested). Used by
 * both the real Steam adapter and, indirectly, documents the on-disk shape
 * `electron/platformBridge.cjs`'s `dw:workshop-read-package` handler mirrors
 * (that file cannot import this TS module directly — see its own docstring).
 */
export function readInstalledWorkshopPackageFromDisk(localPath: string): WorkshopInstalledPackage {
  const fs = require('fs') as NodeFsModule;
  const path = require('path') as NodePathModule;

  const resolvedRoot = fs.realpathSync(path.resolve(localPath));
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Workshop install directory not found: "${localPath}"`);
  }

  const files = walkPackageFiles(fs, path, resolvedRoot);

  const manifestFile = files.find((f) => f.path === 'workshop-meta.json');
  if (!manifestFile) {
    throw new Error(`Workshop package at "${localPath}" is missing workshop-meta.json`);
  }
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'workshop-meta.json'), 'utf8'));

  const campaignFiles = files.filter((f) => f.path.toLowerCase().endsWith('.dwcampaign.json'));
  if (campaignFiles.length === 0) {
    throw new Error(`Workshop package at "${localPath}" contains no .dwcampaign.json file`);
  }
  const campaignData: unknown = JSON.parse(fs.readFileSync(path.join(resolvedRoot, campaignFiles[0].path), 'utf8'));

  return { manifest, campaignData, files };
}
