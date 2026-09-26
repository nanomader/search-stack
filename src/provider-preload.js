const { ipcRenderer } = require('electron');

function isSafeHttpsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, location.href);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

document.addEventListener('click', (event) => {
  if (!event.isTrusted || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!target) return;

  const rawHref = target.getAttribute('href')?.trim() || '';
  const opensSeparateContext = Boolean(target.target && target.target.toLowerCase() !== '_self');
  const usesScriptUrl = /^\s*javascript:/i.test(rawHref);
  if (usesScriptUrl) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  if (!opensSeparateContext || target.hasAttribute('download')) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (isSafeHttpsUrl(target.href)) {
    void ipcRenderer.invoke('provider:open-link', target.href).catch(() => {});
  }
}, true);

function findScrollableElement(event, deltaY) {
  const candidates = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue;
    const style = getComputedStyle(candidate);
    const scrollable = candidate.scrollHeight > candidate.clientHeight + 1
      && ['auto', 'scroll', 'overlay'].includes(style.overflowY);
    if (!scrollable) continue;

    const top = candidate.scrollTop;
    const bottom = top + candidate.clientHeight;
    if ((deltaY < 0 && top > 0) || (deltaY > 0 && bottom < candidate.scrollHeight - 1)) return candidate;
  }

  const root = document.scrollingElement;
  if (root) {
    const top = root.scrollTop;
    const bottom = top + root.clientHeight;
    if ((deltaY < 0 && top > 0) || (deltaY > 0 && bottom < root.scrollHeight - 1)) return root;
  }
  return null;
}

document.addEventListener('wheel', (event) => {
  if (!event.cancelable || event.deltaY === 0) return;
  const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? window.innerHeight
      : 1;
  const deltaY = event.deltaY * multiplier;

  if (findScrollableElement(event, deltaY)) return;

  event.preventDefault();
  ipcRenderer.send('provider:edge-wheel', deltaY);
}, { capture: true, passive: false });
