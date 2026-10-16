// Runs in <head> before the first paint, so a saved theme or palette never flashes the defaults.
// Kept in a plain module (not 'use client'): a server layout importing a constant from a client module gets
// a client reference, not the string, and the script would silently be missing.
import { PALETTE_KEY } from './palettes';

export const THEME_KEY = 'halden-theme';

export const BOOT_SCRIPT =
  `try{var d=document.documentElement,t=localStorage.getItem('${THEME_KEY}');` +
  `if(t==='light'||t==='dark')d.dataset.theme=t;` +
  `var p=localStorage.getItem('${PALETTE_KEY}');if(p&&p!=='signal')d.dataset.palette=p}catch(e){}`;
