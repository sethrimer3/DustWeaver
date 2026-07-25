import type { BackgroundId } from '../levels/roomDef';

// `import.meta.env`/`import.meta.glob` are Vite build-time constructs and are
// undefined when this module loads outside a Vite bundle (e.g. the plain
// `node --import tsx` test runner). Guard both so those environments get an
// empty catalogue instead of a hard crash; production (always under Vite)
// behavior is unchanged.
const BASE = import.meta.env?.BASE_URL ?? '/';

// Vite statically replaces the direct glob call, but does not expose a
// runtime `import.meta.glob` function. Guard on Vite's environment instead so
// the generated catalogue is retained in-game while plain Node tests stay safe.
const BACKGROUND_GLOB: Record<string, unknown> = import.meta.env?.BASE_URL !== undefined
  ? import.meta.glob(
      '/ASSETS/SPRITES/BACKGROUNDS/*/*.{png,webp,jpg,jpeg}',
      { query: '?url', import: 'default' },
    )
  : {};

export interface EditorBackgroundOption {
  readonly id: BackgroundId;
  readonly label: string;
  readonly previewUrl: string | null;
  readonly imageUrl: string | null;
  /** URL of the `_Blur`/`_Blur_Dark` asset variant, if one was discovered. `null` when no blur variant exists (e.g. procedural backgrounds). */
  readonly blurUrl: string | null;
  readonly isProcedural?: boolean;
}

const PROCEDURAL_BACKGROUND_OPTIONS: readonly EditorBackgroundOption[] = [
  { id: 'crystallineCracks', label: 'Crystalline Cracks', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_prologue', label: 'Thero Prologue (Shape Glow)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch1', label: 'Thero Chapter 1 (Vermiculate)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch2', label: 'Thero Chapter 2 (Gravity Grid)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch3', label: 'Thero Chapter 3 (Euler Fluid)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch4', label: 'Thero Chapter 4 (Floater Lattice)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch5', label: 'Thero Chapter 5 (Tetris Blocks)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
  { id: 'thero_ch6', label: 'Thero Chapter 6 (Substrate)', previewUrl: null, imageUrl: null, blurUrl: null, isProcedural: true },
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
  const byFolder = new Map<string, { imageUrl: string | null; previewUrl: string | null; blurUrl: string | null }>();
  const depthOneRe = /^\/ASSETS\/SPRITES\/BACKGROUNDS\/([^/]+)\/([^/]+)$/;

  for (const fullPath of Object.keys(BACKGROUND_GLOB)) {
    const match = depthOneRe.exec(fullPath);
    if (match === null) continue;
    const folder = match[1];
    const filename = match[2];
    if (folder === 'OLD') continue;

    const entry = byFolder.get(folder) ?? { imageUrl: null, previewUrl: null, blurUrl: null };
    const url = publicUrl(fullPath);
    const isBlurDark = /_Blur_Dark\.(png|webp|jpe?g)$/i.test(filename);
    const isBlur = /_Blur(?:_Dark)?\.(png|webp|jpe?g)$/i.test(filename);
    const isPrimary = new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(png|webp|jpe?g)$`, 'i').test(filename);

    if (isPrimary) entry.imageUrl = url;
    if (isBlur && entry.previewUrl === null) entry.previewUrl = url;
    if (entry.previewUrl === null) entry.previewUrl = url;
    // Prefer the plain `_Blur` variant over `_Blur_Dark` when both exist, but
    // accept either — a folder with only `_Blur_Dark` still counts as having
    // a usable blur asset.
    if (isBlur && (entry.blurUrl === null || !isBlurDark)) entry.blurUrl = url;
    byFolder.set(folder, entry);
  }

  return [...byFolder.entries()]
    .filter(([, entry]) => entry.imageUrl !== null)
    .map(([folder, entry]) => ({
      id: folder,
      label: folderToLabel(folder),
      imageUrl: entry.imageUrl,
      previewUrl: entry.previewUrl ?? entry.imageUrl,
      blurUrl: entry.blurUrl,
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

const BACKGROUND_BLUR_URLS = new Map<string, string | null>(
  BACKGROUND_OPTIONS.map(option => [option.id, option.blurUrl]),
);

export function backgroundIdToImageUrl(id: BackgroundId): string | null {
  const discovered = BACKGROUND_IMAGE_URLS.get(id);
  if (discovered !== undefined) return discovered;
  return LEGACY_BACKGROUND_URLS[id] ?? null;
}

/** Returns the discovered `_Blur`/`_Blur_Dark` asset URL for a background, or `null` if none exists (legacy and procedural backgrounds never have one). */
export function backgroundIdToBlurUrl(id: BackgroundId): string | null {
  return BACKGROUND_BLUR_URLS.get(id) ?? null;
}
