// Colour palettes for the Alpine design preview. Each palette sets the same tokens for light and dark;
// layout, type and shape stay the same. The CSS is generated from this list (scripts/gen-palettes.mjs).
export type Palette = {
  id: string;
  name: string;
  /** Swatches shown in the picker: background, ink, accent. */
  swatch: [string, string, string];
};

export const PALETTES: Palette[] = [
  { id: 'signal', name: 'Signal', swatch: ['#f7f7f7', '#141414', '#d4430f'] },
  { id: 'moss', name: 'Moss and brick', swatch: ['#f3f4ee', '#1f2419', '#b23a2a'] },
  { id: 'glacier', name: 'Glacier blue', swatch: ['#f6f8fb', '#121a2b', '#1f5fe0'] },
  { id: 'night', name: 'Night lime', swatch: ['#16181a', '#f2f3f0', '#b6e33b'] },
  { id: 'slate', name: 'Slate and terracotta', swatch: ['#f2f4f6', '#1e2833', '#c4623a'] },
];

export const PALETTE_KEY = 'halden-palette';
