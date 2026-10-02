/** Initialize after hydration; dispose before unmount. Never replaces renderer-owned nodes. */
export function initializePreviews(root: HTMLElement): () => void {
  const events = new AbortController();
  const dismissed = new WeakSet<Element>();
  const open = new Set<HTMLElement>();
  const closing = new Map<Element, ReturnType<typeof setTimeout>>();
  let pointerCard: Element | null = null;
  let pointerWasOpen = false;
  const owner = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('.clp-inline') : null;
  const toggleFor = (card: Element) => card.querySelector<HTMLButtonElement>('[data-clp-toggle]');
  const panelFor = (card: Element) => card.querySelector<HTMLElement>('.clp-panel');
  function cancelClose(card: Element) {
    clearTimeout(closing.get(card));
    closing.delete(card);
  }
  function show(card: Element, explicit = false) {
    cancelClose(card);
    if (dismissed.has(card) && !explicit) return;
    const panel = panelFor(card);
    if (!panel || panel.matches(':popover-open')) return;
    if (explicit) dismissed.delete(card);
    panel.showPopover();
    const bounds = card.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(bounds.left, innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(bounds.bottom + 4, innerHeight - panel.offsetHeight - 8)) + 'px';
    toggleFor(card)?.setAttribute('aria-expanded', 'true');
    open.add(panel);
  }
  function close(card: Element, dismiss = false) {
    cancelClose(card);
    const panel = panelFor(card);
    if (panel?.matches(':popover-open')) panel.hidePopover();
    if (panel) open.delete(panel);
    toggleFor(card)?.setAttribute('aria-expanded', 'false');
    if (dismiss) dismissed.add(card);
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      pointerCard = owner(event.target);
      pointerWasOpen = !!(pointerCard && panelFor(pointerCard)?.matches(':popover-open'));
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'pointercancel',
    () => {
      pointerCard = null;
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'pointerover',
    (event) => {
      const card = owner(event.target);
      if (card && event.pointerType !== 'touch') show(card);
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'pointerout',
    (event) => {
      const card = owner(event.target);
      if (
        card &&
        !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) &&
        !card.contains(document.activeElement)
      ) {
        cancelClose(card);
        closing.set(
          card,
          setTimeout(() => close(card), 160),
        );
      }
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'focusin',
    (event) => {
      const card = owner(event.target);
      if (card && pointerCard !== card) show(card);
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'focusout',
    (event) => {
      const card = owner(event.target);
      if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) {
        close(card);
        dismissed.delete(card);
      }
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-clp-toggle]') : null;
      const card = owner(target);
      if (card) {
        const wasOpen = pointerCard === card ? pointerWasOpen : panelFor(card)?.matches(':popover-open');
        if (wasOpen) close(card, true);
        else show(card, true);
      }
      pointerCard = null;
    },
    { signal: events.signal },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      pointerCard = null;
      if (event.key === 'Escape')
        for (const panel of [...open]) {
          const card = owner(panel);
          if (card) close(card, true);
        }
    },
    { signal: events.signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      for (const panel of [...open]) {
        const card = owner(panel);
        if (card && event.target instanceof Node && !card.contains(event.target)) close(card);
      }
    },
    { signal: events.signal },
  );
  function imageState(target: EventTarget | null, loaded: boolean) {
    if (target instanceof HTMLImageElement && target.hasAttribute('data-clp-media'))
      target.setAttribute('data-clp-loaded', String(loaded));
  }
  const refresh = (image: HTMLImageElement) => imageState(image, image.complete && image.naturalWidth > 0);
  root.addEventListener('load', (event) => imageState(event.target, true), {
    capture: true,
    signal: events.signal,
  });
  root.addEventListener('error', (event) => imageState(event.target, false), {
    capture: true,
    signal: events.signal,
  });
  const observer = new MutationObserver((records) => {
    for (const panel of open) if (!root.contains(panel)) open.delete(panel);
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) refresh(record.target);
      for (const node of record.addedNodes)
        if (node instanceof Element) {
          if (node instanceof HTMLImageElement) refresh(node);
          for (const image of node.querySelectorAll<HTMLImageElement>('img[data-clp-media]')) refresh(image);
        }
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-clp-media]')) refresh(image);
  return () => {
    events.abort();
    observer.disconnect();
    for (const timer of closing.values()) clearTimeout(timer);
    closing.clear();
    for (const panel of open) if (panel.matches(':popover-open')) panel.hidePopover();
    open.clear();
  };
}
