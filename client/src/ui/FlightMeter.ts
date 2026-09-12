import { injectHudStyles } from './hudStyles.js';

/**
 * THE FLIGHT METER, along the bottom of the screen.
 *
 * The one new piece of HUD this game needs, and the most important thing on
 * the screen while a stage is being played: it is the resource every gap in
 * the course is priced in, so a player who cannot read it at a glance cannot
 * make the decision the course is asking them to make.
 *
 * WHAT IT SHOWS is the broom's own capacity, always. The bar starts full at
 * the broom's maximum, drains toward zero while thrust is held, and refills
 * while the player rests on the ground. It is drawn from the CLIENT's
 * prediction rather than from the last replicated figure, and that is
 * deliberate: the server owns the meter and reconciles it twenty times a
 * second, but a bar that only moved on a patch would lag the key by up to
 * fifty milliseconds - and this particular bar is being watched at exactly the
 * moment the player is deciding whether to commit to a crossing.
 *
 * Three states, because the reading has to survive a glance:
 *
 *  - draining, while thrust is being spent: the fill brightens and the whole
 *    bar lifts, so spending looks like spending.
 *  - low, under a quarter: the fill goes amber and pulses. A player who is
 *    about to run out mid-gap needs to know BEFORE they commit, not after.
 *  - empty: the fill is gone and the label says so. Holding the key does
 *    nothing at zero, and the bar is the only thing that explains why.
 */
export class FlightMeter {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly hint: HTMLDivElement;

  /** Last rendered state, so a quiet frame writes nothing to the DOM. */
  private lastWidth = -1;
  private lastText = '';
  private lastFlying = false;
  private lastLow = false;
  private lastEmpty = false;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    injectStyles();

    this.root = el('div', 'aoe-fly aoe-font');

    const bar = el('div', 'aoe-fly__bar');
    this.fill = el('div', 'aoe-fly__fill');
    this.label = el('div', 'aoe-fly__label aoe-outline');
    this.label.textContent = 'FLIGHT';
    bar.append(this.fill, this.label);

    /*
     * The key cap.
     *
     * The existing HUD pattern puts a key hint on every control a desktop
     * player has to discover, and this is the control the whole game is built
     * on - so it gets one too. It is hidden in touch mode by the same
     * `aoe-touch-mode` class every other key cap uses, because a phone has no
     * Space bar and the on-screen FLY button says the same thing.
     */
    this.hint = el('div', 'aoe-fly__hint');
    this.hint.innerHTML = '<span class="aoe-fly__key">SPACE</span> HOLD TO FLY';

    this.root.append(bar, this.hint);
    parent.appendChild(this.root);
  }

  /**
   * @param remaining seconds of flight left, from the local prediction
   * @param capacity  the equipped broom's maximum, from replicated state
   * @param flying    true while thrust is actually being spent
   */
  update(remaining: number, capacity: number, flying: boolean): void {
    const max = capacity > 0 ? capacity : 0;
    const left = Math.min(Math.max(remaining, 0), max);
    const fraction = max > 0 ? left / max : 0;

    // Rounded to a tenth before it is compared, so a bar that is physically
    // draining still only touches the DOM when the pixel would actually move.
    const width = Math.round(fraction * 1000) / 10;
    if (width !== this.lastWidth) {
      this.lastWidth = width;
      this.fill.style.width = `${width}%`;
    }

    const text = max > 0 ? `${left.toFixed(1)}s / ${max.toFixed(0)}s` : 'FLIGHT';
    if (text !== this.lastText) {
      this.lastText = text;
      this.label.textContent = text;
    }

    const low = fraction > 0 && fraction <= 0.25;
    const empty = fraction <= 0;

    if (flying !== this.lastFlying) {
      this.lastFlying = flying;
      this.root.classList.toggle('aoe-fly--active', flying);
    }
    if (low !== this.lastLow) {
      this.lastLow = low;
      this.root.classList.toggle('aoe-fly--low', low);
    }
    if (empty !== this.lastEmpty) {
      this.lastEmpty = empty;
      this.root.classList.toggle('aoe-fly--empty', empty);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.aoe-fly {
  position: fixed;
  left: 50%;
  /*
   * The very BOTTOM of the screen, under the Speed/Level bar rather than
   * beside it. The two are read at completely different moments - Speed
   * between runs, flight during one - so stacking them keeps each a single
   * glance, and the flight bar being the lower of the two puts it closest to
   * the action and furthest from anything it could be confused with.
   */
  bottom: max(10px, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  width: min(720px, 74vw);
  pointer-events: none;
  user-select: none;
  z-index: 21;
  transition: transform 140ms ease;
}

.aoe-fly__bar {
  position: relative;
  height: clamp(20px, 2.6vw, 30px);
  border-radius: 999px;
  border: 3px solid var(--aoe-ink);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  /* An empty track reads as dark stone, so the fill is the only lit thing. */
  background-color: #1b2130;
  background-image: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3));
}

/*
 * The fill: arcane blue-violet, which is the colour every enchantment in this
 * game is lit with, so the bar and the glow on the broom are plainly the same
 * resource.
 */
.aoe-fly__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  border-radius: 999px 4px 4px 999px;
  background: linear-gradient(90deg, #5b8cff 0%, #8b5cf6 55%, #d46bff 100%);
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.2);
  /*
   * Fast, and faster still than the Speed bar's. This is a live gauge of a
   * key being held: a slow transition would make the bar lag the thrust it is
   * reporting, which is the one thing it must never do.
   */
  transition: width 70ms linear, background 160ms ease;
}

.aoe-fly__label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(10px, 1.25vw, 15px);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.aoe-fly__hint {
  margin-top: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: clamp(9px, 1vw, 12px);
  letter-spacing: 0.1em;
  color: rgba(226, 232, 255, 0.72);
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.aoe-fly__key {
  padding: 2px 7px;
  border: 2px solid rgba(226, 232, 255, 0.5);
  border-bottom-width: 3px;
  border-radius: 5px;
  background: rgba(12, 16, 26, 0.7);
  color: #e2e8ff;
}

/* Spending: the bar lifts and the fill brightens. */
.aoe-fly--active { transform: translateX(-50%) translateY(-2px); }
.aoe-fly--active .aoe-fly__fill {
  background: linear-gradient(90deg, #8fd4ff 0%, #b48bff 55%, #ff9df5 100%);
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.2), 0 0 14px rgba(180, 139, 255, 0.85);
}

/* Low: amber and pulsing, so the warning arrives BEFORE the commitment. */
.aoe-fly--low .aoe-fly__fill {
  background: linear-gradient(90deg, #ffb32e 0%, #ff7a3d 100%);
  animation: aoe-fly-pulse 640ms ease-in-out infinite;
}
@keyframes aoe-fly-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* Empty: say so, because holding the key now does nothing. */
.aoe-fly--empty .aoe-fly__bar { border-color: #7f1d1d; }
.aoe-fly--empty .aoe-fly__label::after {
  content: " - LAND TO REFILL";
  color: #ff9d9d;
}

/* The key cap is desktop only; a phone has the FLY button instead. */
body.aoe-touch-mode .aoe-fly__hint { display: none; }
/*
 * On a phone the bar sits ABOVE the thumb controls, not between them.
 *
 * The stick owns the bottom-left corner and the FLY button the bottom-right,
 * and they are TALL - the stick is over a hundred pixels of it. A centred bar
 * squeezed into what is left ends up a few pixels from a control a thumb is
 * resting on, which is both unreadable and in the way. Lifted clear of both,
 * it is still the lowest readable thing on screen and still directly over the
 * button it reports on.
 */
body.aoe-touch-mode .aoe-fly {
  bottom: calc(max(10px, env(safe-area-inset-bottom, 0px)) + 154px);
  width: min(420px, 62vw);
}

@media (prefers-reduced-motion: reduce) {
  .aoe-fly__fill { transition: none; }
  .aoe-fly--low .aoe-fly__fill { animation: none; }
  .aoe-fly { transition: none; }
}
`;
  document.head.appendChild(style);
};
