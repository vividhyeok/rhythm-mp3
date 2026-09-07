export type ScreenBuilder = (root: HTMLElement) => (() => void) | void;

let currentCleanup: (() => void) | null = null;
let generation = 0;

/** Switch to a new screen: runs previous cleanup, clears #app, mounts builder. */
export function show(builder: ScreenBuilder): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app element missing');
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch {
      // ignore cleanup errors
    }
    currentCleanup = null;
  }
  root.innerHTML = '';
  const gen = ++generation;
  const c = builder(root);
  // builder may have navigated away synchronously (nested show); don't clobber it
  if (gen === generation) {
    currentCleanup = typeof c === 'function' ? c : null;
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
