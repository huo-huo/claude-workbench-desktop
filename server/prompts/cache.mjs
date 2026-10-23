import fs from 'node:fs';
import { SKILL_TRANSLATIONS_FILE } from '../core/paths.mjs';
import { safeReadJson } from '../core/storage.mjs';
import { state } from '../core/app-state.mjs';

export function cachedCard(id, file) {
  const card = state().generatedCards?.[id];
  if (!card || !file || !fs.existsSync(file)) return null;
  try { return fs.statSync(file).mtimeMs === card.sourceMtime ? card : null; } catch { return null; }
}

export function skillTranslationStore() {
  return safeReadJson(SKILL_TRANSLATIONS_FILE, {});
}

export function readCachedSkillTranslation(id, file, translations = null) {
  const store = translations || skillTranslationStore();
  const item = store[id];
  if (!item || !file || !fs.existsSync(file)) return null;
  try {
    const stat = fs.statSync(file);
    return stat.mtimeMs === item.sourceMtime && stat.size === item.sourceSize ? item : null;
  } catch { return null; }
}

export function cachedSkillTranslation(id, file, translations = null) {
  const item = readCachedSkillTranslation(id, file, translations);
  if (!item) return null;
  return { displayName: item.displayName, description: item.description, translatedAt: item.translatedAt };
}

