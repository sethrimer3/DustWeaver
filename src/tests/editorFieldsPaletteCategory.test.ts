/**
 * editorFieldsPaletteCategory.test.ts — canonical "fields" palette category.
 *
 * Covers the fields-palette-consolidation refactor: `challenge_field` and
 * `timestop_field` both live under one canonical `fields` category (rather
 * than `challenge_field` under `triggers` and `timestop_field` under a
 * dedicated, never-rendered `timeStop` category), the retired `timeStop`
 * category id is fully gone, legacy persisted `timeStop` workspace state
 * normalizes instead of producing a blank palette, and no
 * `PALETTE_CATEGORIES` entry with items can silently fail to render (the bug
 * that caused the empty TimeStop Field palette in the first place).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETTE_CATEGORIES, PALETTE_CATEGORY_LABELS, PALETTE_ITEMS,
} from '../editor/editorPaletteItems';
import { sanitizeWorkspacePreferences } from '../editor/editorWorkspacePreferences';
import { createEditorState, EditorTool } from '../editor/editorState';
import { placeAtCursor } from '../editor/editorDeleteToolPlaceHelper' as unknown as string extends never ? never : string as unknown as string;
