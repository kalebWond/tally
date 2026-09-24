/** The video's timing, shared by the command-line render and the browser player (F28). */
export const FPS = 30;
export const SECTIONS = { intro: 3, race: 16, standings: 6, winner: 7 } as const;
export const DURATION_FRAMES = Object.values(SECTIONS).reduce((s, x) => s + x, 0) * FPS;
export const WIDTH = 1920;
export const HEIGHT = 1080;
