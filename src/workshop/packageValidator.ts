import { validateSavedCampaign } from '../levels/campaignSchema';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export const WORKSHOP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const WORKSHOP_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WORKSHOP_MAX_FILE_COUNT = 500;

export const WORKSHOP_ALLOWED_EXTENSIONS = ['.json', '.png', '.jpg', '.webp', '.ogg', '.wav'];

/** A single file within a Workshop package, prior to being written to disk. */
export interface WorkshopPackageFile {
  /** Path relative to the package root, using forward slashes. */
  path: string;
  sizeBytes: number;
}

const SEMVER_LIKE_RE = /^\d+\.\d+\.\d+$/;

function isPathSafe(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  // Absolute paths (POSIX or Windows-drive) are never allowed.
  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(relativePath)) return false;
  const segments = relativePath.split(/[/\\]/);
  return segments.every((segment) => segment !== '..' && segment !== '');
}

function hasAllowedExtension(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return WORKSHOP_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Validates a Workshop package's manifest, campaign content, and file list.
 * Does not touch the filesystem — callers supply parsed JSON and a file
 * listing so this can run against both real directories and in-memory
 * fixtures in tests.
 */
export function validateWorkshopPackage(
  manifestData: unknown,
  campaignData: unknown,
  files: WorkshopPackageFile[]
): ValidationResult {
  const errors: string[] = [];

  errors.push(...validateWorkshopManifest(manifestData));
  errors.push(...validateWorkshopFiles(files));

  if (campaignData !== undefined) {
    const campaignErrors = validateSavedCampaign(campaignData);
    errors.push(...campaignErrors.map((e) => `campaign: ${e}`));
  } else {
    errors.push('Package is missing campaign content');
  }

  return { valid: errors.length === 0, errors };
}

function validateWorkshopManifest(manifestData: unknown): string[] {
  const errors: string[] = [];

  if (typeof manifestData !== 'object' || manifestData === null) {
    return ['workshop-meta.json is missing or is not a JSON object'];
  }
  const m = manifestData as Record<string, unknown>;

  if (m['formatVersion'] !== 1) {
    errors.push(`workshop-meta.json: unsupported formatVersion "${String(m['formatVersion'])}" — expected 1`);
  }
  if (typeof m['title'] !== 'string' || m['title'].trim().length === 0) {
    errors.push('workshop-meta.json: "title" is required and must be a non-empty string');
  }
  if (typeof m['description'] !== 'string') {
    errors.push('workshop-meta.json: "description" is required and must be a string');
  }
  if (typeof m['authorSteamId'] !== 'string' || m['authorSteamId'].trim().length === 0) {
    errors.push('workshop-meta.json: "authorSteamId" is required and must be a non-empty string');
  }
  if (typeof m['campaignId'] !== 'string' || m['campaignId'].trim().length === 0) {
    errors.push('workshop-meta.json: "campaignId" is required and must be a non-empty string');
  }
  if (typeof m['gameVersion'] !== 'string' || !SEMVER_LIKE_RE.test(m['gameVersion'])) {
    errors.push('workshop-meta.json: "gameVersion" is required and must look like a semver string (e.g. "1.2.3")');
  }
  if (!Array.isArray(m['tags']) || !m['tags'].every((t) => typeof t === 'string')) {
    errors.push('workshop-meta.json: "tags" is required and must be an array of strings');
  }

  return errors;
}

function validateWorkshopFiles(files: WorkshopPackageFile[]): string[] {
  const errors: string[] = [];

  if (files.length > WORKSHOP_MAX_FILE_COUNT) {
    errors.push(`Package contains ${files.length} files, exceeding the limit of ${WORKSHOP_MAX_FILE_COUNT}`);
  }

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.sizeBytes;

    if (!isPathSafe(file.path)) {
      errors.push(`Unsafe file path (path traversal or absolute path): "${file.path}"`);
      continue;
    }
    if (!hasAllowedExtension(file.path)) {
      errors.push(`Disallowed file extension: "${file.path}" (allowed: ${WORKSHOP_ALLOWED_EXTENSIONS.join(', ')})`);
    }
    if (file.sizeBytes > WORKSHOP_MAX_FILE_BYTES) {
      errors.push(`File "${file.path}" is ${file.sizeBytes} bytes, exceeding the per-file limit of ${WORKSHOP_MAX_FILE_BYTES} bytes`);
    }
  }

  if (totalBytes > WORKSHOP_MAX_TOTAL_BYTES) {
    errors.push(`Package total size is ${totalBytes} bytes, exceeding the limit of ${WORKSHOP_MAX_TOTAL_BYTES} bytes`);
  }

  return errors;
}
