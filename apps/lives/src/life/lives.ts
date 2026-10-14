import { hexToRgb, type RGB } from '@/life/sky';

/**
 * Each time the film loops, the light comes down into a new life. The test has
 * one model, so a new life is told by colour alone: the hair and the clothes.
 * The first life keeps the model's own colours.
 */
export interface Palette {
  /** Hair colour the model's own brown is pulled towards. */
  hair: RGB;
  /** 0 keeps the model's own hair colour, 1 is the palette's. */
  hairAmount: number;
  /** Multiplies the white top. */
  top: RGB;
}

const PALETTES: readonly Palette[] = [
  { hair: hexToRgb('#6b4a35'), hairAmount: 0, top: hexToRgb('#ffffff') },
  { hair: hexToRgb('#1f1d24'), hairAmount: 0.85, top: hexToRgb('#bcd3ea') },
  { hair: hexToRgb('#8a3b22'), hairAmount: 0.8, top: hexToRgb('#e9dcb8') },
  { hair: hexToRgb('#d8b67a'), hairAmount: 0.85, top: hexToRgb('#c9dfc0') },
  { hair: hexToRgb('#39414f'), hairAmount: 0.7, top: hexToRgb('#f0c4c4') },
];

/** Soft, faded colour an old person's clothes drift towards. */
export const OLD_TOP: RGB = hexToRgb('#b7aebf');

export function paletteFor(life: number): Palette {
  const n = PALETTES.length;
  const index = ((Math.floor(life) % n) + n) % n;
  const palette = PALETTES[index];
  if (!palette) throw new Error('palette table is empty');
  return palette;
}

export const LIFE_COUNT = PALETTES.length;
