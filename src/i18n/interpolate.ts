/**
 * Deterministic `{placeholder}` interpolation.
 *
 * Rules:
 *  - `{name}` is replaced by `String(params.name)`.
 *  - An unknown placeholder is left verbatim (never blanked, never throws), so a
 *    catalog typo is visible to translators but harmless to players.
 *  - `{{` and `}}` are literal braces.
 */

import type { TranslationParams } from './types';

const PLACEHOLDER_RE = /\{\{|\}\}|\{([a-zA-Z0-9_]+)\}/g;

export function interpolate(template: string, params?: TranslationParams): string {
  if (params === undefined) {
    // Still collapse literal-brace escapes so output is consistent.
    return template.replace(/\{\{|\}\}/g, (m) => (m === '{{' ? '{' : '}'));
  }
  return template.replace(PLACEHOLDER_RE, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    if (name === undefined) return match;
    const value = params[name];
    if (value === undefined) return match;
    return String(value);
  });
}
