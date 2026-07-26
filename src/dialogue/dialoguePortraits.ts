/**
 * dialoguePortraits.ts - Build-time discovery for dialogue portrait assets.
 *
 * Portrait IDs are the image file names without extensions. Add image files
 * directly under ASSETS/SPRITES/Portraits/ and they become editor options.
 */

export interface DialoguePortraitOption {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

const _IS_VITE_RUNTIME = import.meta.env?.BASE_URL !== undefined;
const BASE = import.meta.env?.BASE_URL ?? '/';

const _PORTRAIT_GLOB = _IS_VITE_RUNTIME
  ? import.meta.glob(
      '/ASSETS/SPRITES/Portraits/*.{png,webp,jpg,jpeg}',
      { query: '?url', import: 'default' },
    )
  : {};

const _PORTRAIT_FILE_RE = /^\/ASSETS\/SPRITES\/Portraits\/([^/]+)\.(png|webp|jpg|jpeg)$/i;

function _stripExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

function _buildPortraitOptions(): DialoguePortraitOption[] {
  const options: DialoguePortraitOption[] = [
    { id: 'none', label: 'none', url: '' },
  ];

  const discovered: DialoguePortraitOption[] = [];
  for (const fullPath of Object.keys(_PORTRAIT_GLOB)) {
    const match = _PORTRAIT_FILE_RE.exec(fullPath);
    if (match === null) continue;

    const filename = fullPath.slice(fullPath.lastIndexOf('/') + 1);
    const id = _stripExtension(filename);
    const publicUrl = `${BASE}${fullPath.slice('/ASSETS/'.length)}`;
    discovered.push({ id, label: id, url: publicUrl });
  }

  discovered.sort((a, b) => a.label.localeCompare(b.label));
  options.push(...discovered);
  return options;
}

export const DIALOGUE_PORTRAIT_OPTIONS: readonly DialoguePortraitOption[] = _buildPortraitOptions();

const _PORTRAIT_BY_ID = new Map(DIALOGUE_PORTRAIT_OPTIONS.map(option => [option.id, option]));

export function getDialoguePortraitOption(id: string): DialoguePortraitOption | undefined {
  return _PORTRAIT_BY_ID.get(id);
}
