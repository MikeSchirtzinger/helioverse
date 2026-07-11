/**
 * scene/canvas-labels.ts — DOM overlay labels (CSS2DRenderer), not canvas sprites.
 *
 * Labels are real HTML elements positioned over the WebGL/WebGPU canvas by a
 * CSS2DRenderer. That makes them:
 *   • clickable (a CME label selects its event);
 *   • styled with CSS — they read as an overlay, not geometry painted into the
 *     scene, and can fade/appear contextually;
 *   • decluttered — non-relevant bodies (the other planets) stay pointer-inert
 *     and hidden until the cursor is near them, so they never block the view.
 *
 * The overlay container is pointer-transparent; only interactive labels opt back
 * in to pointer events, so dragging/zooming the scene works everywhere else.
 */

import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type LabelKind = 'sun' | 'earth' | 'l1' | 'planet' | 'cme';

export interface DomLabel {
  /** The CSS2DObject to add to the scene graph (or position manually). */
  object: CSS2DObject;
  /** The underlying HTML element (for class/opacity toggling). */
  el: HTMLButtonElement;
  /** Secondary line for a live data readout (e.g. a CME's width + leading-edge
   * distance). Empty by default; the caller fills it per frame. */
  sub: HTMLSpanElement;
  kind: LabelKind;
}

export interface DomLabelOptions {
  kind: LabelKind;
  /** Accent dot colour (CSS). */
  accent?: string;
  /** Click handler — only set for interactive labels (e.g. CMEs). */
  onClick?: () => void;
}

/** Build the CSS2DRenderer that hosts the DOM label overlay. */
export function createLabelRenderer(width: number, height: number): CSS2DRenderer {
  const renderer = new CSS2DRenderer();
  renderer.setSize(width, height);
  const style = renderer.domElement.style;
  style.position = 'absolute';
  style.inset = '0';
  style.zIndex = '2';
  // The overlay itself is transparent to the pointer; individual interactive
  // labels re-enable pointer events on themselves.
  style.pointerEvents = 'none';
  renderer.domElement.className = 'hv-label-layer';
  return renderer;
}

/** Create one DOM label as a CSS2DObject. */
export function createDomLabel(text: string, opts: DomLabelOptions): DomLabel {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `hv-label hv-label--${opts.kind}`;
  el.dataset.kind = opts.kind;
  if (opts.accent) el.style.setProperty('--label-accent', opts.accent);

  const dot = document.createElement('span');
  dot.className = 'hv-label__dot';
  const span = document.createElement('span');
  span.className = 'hv-label__text';
  span.textContent = text;
  const sub = document.createElement('span');
  sub.className = 'hv-label__sub';
  el.append(dot, span, sub);

  if (opts.onClick) {
    const handler = (event: Event) => {
      event.stopPropagation();
      opts.onClick?.();
    };
    el.addEventListener('click', handler);
    el.addEventListener('pointerdown', (event) => event.stopPropagation());
    el.style.pointerEvents = 'auto';
  } else {
    // Non-interactive labels never intercept the pointer — they can't get in
    // the way of dragging or zooming the scene.
    el.style.pointerEvents = 'none';
    el.tabIndex = -1;
  }

  const object = new CSS2DObject(el);
  object.userData = { isLabel: true, kind: opts.kind };
  return { object, el, sub, kind: opts.kind };
}
