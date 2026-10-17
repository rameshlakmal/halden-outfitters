// Runs in <head> before the first paint, so a saved theme never flashes the system one. A plain module (not
// 'use client'): a server layout importing a constant from a client module gets a client reference, not the string.
export const THEME_KEY = 'halden-admin-theme';

export const BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
