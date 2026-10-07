// Theme constants shared by server (layout) and client code.
export const THEME_KEY = "wa_viewer_theme"; // kept for compatibility with saved preferences

// Inline pre-hydration script for the root layout: applies body.dark before first paint.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark"||(!t&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches))document.body.classList.add("dark")}catch(e){}`;
