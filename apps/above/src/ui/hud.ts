/** Tiny debug overlay. Press H to toggle. Never part of the real UI. */
export function createHud(): { set: (text: string) => void } {
  const el = document.getElementById('hud');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') el?.classList.toggle('hidden');
  });
  return {
    set: (text) => {
      if (el && !el.classList.contains('hidden')) el.textContent = text;
    },
  };
}
