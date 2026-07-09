import type { BackgroundId } from '../levels/roomDef';

const BASE = import.meta.env.BASE_URL;

const BACKGROUND_GLOB = import.meta.glob(
  '/ASSETS/SPRITES/BACKGROUNDS/*/*.{png,webp,jpg,jpeg}',
  { query: '?url', import: 'default' },
);

export interface EditorBackgroundOption {
  readonly id: BackgroundId;
  readonly label: string;
  readonly previewUrl: string | null;
  readonly imageUrl: string | null;
  readonly isProcedural?: boolean;
}

const PROCEDURAL_BACKGROUND_OPTIONS: readonly EditorBackgroundOption[] = [
  { id: 'crystallineCracks', label: 'Crystalline Cracks', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_prologue', label: 'Thero Prologue (Shape Glow)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch1', label: 'Thero Chapter 1 (Vermiculate)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch2', label: 'Thero Chapter 2 (Gravity Grid)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch3', label: 'Thero Chapter 3 (Euler Fluid)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch4', label: 'Thero Chapter 4 (Floater Lattice)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch5', label: 'Thero Chapter 5 (Tetris Blocks)', previewUrl: null, imageUrl: null, isProcedural: true },
  { id: 'thero_ch6', label: 'Thero Chapter 6 (Substrate)', previewUrl: null, imageUrl: null, isProcedural: true },
];

const LEGACY_BACKGROUND_URLS: Readonly<Record<string, string>> = {
  brownRock: `${BASE}SPRITES/BACKGROUNDS/OLD/brownRock_background_1.png`,
  world1: `${BASE}SPRITES/WORLDS/W-1/background/background.png`,
  world2: `${BASE}SPRITES/WORLDS/W-2/background/background.png`,
  world3: `${BASE}SPRITES/WORLDS/W-3/background/background.png`,
};

function folderToLabel(folder: string): string {
  return folder
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase());
}

function publicUrl(fullPath: string): string {
  return `${BASE}${fullPath.slice('/ASSETS/'.length)}`;
}

function buildStaticBackgroundOptions(): EditorBackgroundOption[] {
  const byFolder = new Map<string, { imageUrl: string | null; previewUrl: string | null }>();
  const depthOneRe = /^\/ASSETS\/SPRITES\/BACKGROUNDS\/([^/]+)\/([^/]+)$/;

  for (const fullPath of Object.keys(BACKGROUND_GLOB)) {
    const match = depthOneRe.exec(fullPath);
    if (match === null) continue;
    const folder = match[1];
    const filename = match[2];
    if (folder === 'OLD') continue;

    const entry = byFolder.get(folder) ?? { imageUrl: null, previewUrl: null };
    const url = publicUrl(fullPath);
    const isBlur = /_Blur(?:_Dark)?\.(png|webp|jpe?g)$/i.test(filename);
    const isPrimary = new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(png|webp|jpe?g)$`, 'i').test(filename);

    if (isPrimary) entry.imageUrl = url;
    if (isBlur && entry.previewUrl === null) entry.previewUrl = url;
    if (entry.previewUrl === null) entry.previewUrl = url;
    byFolder.set(folder, entry);
  }

  return [...byFolder.entries()]
    .filter(([, entry]) => entry.imageUrl !== null)
    .map(([folder, entry]) => ({
      id: folder,
      label: folderToLabel(folder),
      imageUrl: entry.imageUrl,
      previewUrl: entry.previewUrl ?? entry.imageUrl,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const STATIC_BACKGROUND_OPTIONS: readonly EditorBackgroundOption[] = buildStaticBackgroundOptions();

export const BACKGROUND_OPTIONS: readonly EditorBackgroundOption[] = [
  ...STATIC_BACKGROUND_OPTIONS,
  ...PROCEDURAL_BACKGROUND_OPTIONS,
];

const BACKGROUND_IMAGE_URLS = new Map<string, string | null>(
  BACKGROUND_OPTIONS.map(option => [option.id, option.imageUrl]),
);

export function backgroundIdToImageUrl(id: BackgroundId): string | null {
  const discovered = BACKGROUND_IMAGE_URLS.get(id);
  if (discovered !== undefined) return discovered;
  return LEGACY_BACKGROUND_URLS[id] ?? null;
}
