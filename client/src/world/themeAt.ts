import { COURSE, STAGES, stageAt } from '@broom/shared';
import { THEMES, themeNameForStage, type StageTheme, type ThemeName } from '../config/worldVisuals.js';

/**
 * The theme worn at a world Z.
 *
 * The vault is everything before the first stage; past the last stage the
 * last stage's theme carries on, so the run-out after the final win pad is
 * never a stray fallback colour.
 */
export const themeNameAt = (z: number): ThemeName => {
  if (z < COURSE.lobbyEndZ) return 'vault';
  const stage = stageAt(z);
  if (stage) return themeNameForStage(stage.index);
  const last = STAGES[STAGES.length - 1];
  return themeNameForStage(last ? last.index : 1);
};

export const themeAt = (z: number): StageTheme => THEMES[themeNameAt(z)];
