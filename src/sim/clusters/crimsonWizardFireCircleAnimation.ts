export const CW_FIRE_CIRCLE_FRAME_COUNT = 125;
export const CW_FIRE_CIRCLE_FRAME_TICKS = 1;
export const CW_FIRE_CIRCLE_HOLD_TICKS = 30;
export const CW_FIRE_CIRCLE_FADE_TICKS = 45;
export const CW_FIRE_CIRCLE_TOTAL_TICKS =
  CW_FIRE_CIRCLE_FRAME_COUNT * CW_FIRE_CIRCLE_FRAME_TICKS +
  CW_FIRE_CIRCLE_HOLD_TICKS +
  CW_FIRE_CIRCLE_FADE_TICKS;

export interface CrimsonWizardFireCircleFrame {
  frameIndex: number;
  opacity: number;
}

/**
 * Converts the 1-based simulation timer into a 0-based atlas frame and alpha.
 * One simulation tick equals one animation frame because both run at 60 Hz.
 */
export function getCrimsonWizardFireCircleFrame(
  elapsedTicks: number,
): CrimsonWizardFireCircleFrame | null {
  if (elapsedTicks <= 0 || elapsedTicks > CW_FIRE_CIRCLE_TOTAL_TICKS) return null;

  const zeroBasedTick = elapsedTicks - 1;
  const playbackTicks = CW_FIRE_CIRCLE_FRAME_COUNT * CW_FIRE_CIRCLE_FRAME_TICKS;
  const frameIndex = Math.min(
    CW_FIRE_CIRCLE_FRAME_COUNT - 1,
    Math.floor(zeroBasedTick / CW_FIRE_CIRCLE_FRAME_TICKS),
  );
  const fadeStartTick = playbackTicks + CW_FIRE_CIRCLE_HOLD_TICKS;
  const opacity = zeroBasedTick < fadeStartTick
    ? 1
    : Math.max(0, 1 - (zeroBasedTick - fadeStartTick + 1) / CW_FIRE_CIRCLE_FADE_TICKS);

  return { frameIndex, opacity };
}
