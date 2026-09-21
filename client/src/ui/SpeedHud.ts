import {
  formatSpeed,
  rebirthMultiplier,
  resolveLevel,
  type LevelProgress,
} from '@broom/shared';

/**
 * The Speed and Level HUD.
 *
 * This is the WHOLE user interface for the first version, and deliberately so:
 * the big Speed figure over the mount, the rebirth multiplier beside it, and
 * the level bar under both. No shop panel, no inventory, no settings.
 *
 * Everything it shows is SERVER-AUTHORITATIVE state. It renders the replicated
 * lifetime Speed total and the level that follows from it through the shared
 * formula - it never awards, predicts or derives progress of its own.
 *
 * Laid out to match the reference art: heavy white display type with a thick
 * dark rim, a rounded track with a rainbow progress fill, the level name at
 * the left of the fill and the "into / required" figures at the right.
 *
 * Built as three independent rows so a fourth can be added later - a Wins
 * counter, the buy buttons - without re-laying out what is already here.
 */
export class SpeedHud {
  private readonly root: HTMLDivElement;
  private readonly speedLabel: HTMLDivElement;
  private readonly multiLabel: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly levelLabel: HTMLDivElement;
  private readonly amountLabel: HTMLDivElement;

  private lastTotal = -1;
  private lastLevel = -1;
  private lastRebirths = -1;

  constructor(parent: HTMLElement) {
    injectStyles();

    this.root = el('div', 'aoe-hud');

    const speedRow = el('div', 'aoe-hud__speed-row');
    this.speedLabel = el('div', 'aoe-hud__speed');
    this.speedLabel.textContent = '0 Speed';
    this.multiLabel = el('div', 'aoe-hud__multi');
    this.multiLabel.textContent = 'x1 Multi (Rebirth)';
    speedRow.append(this.speedLabel, this.multiLabel);

    const bar = el('div', 'aoe-hud__bar');
    this.fill = el('div', 'aoe-hud__fill');
    this.levelLabel = el('div', 'aoe-hud__level');
    this.levelLabel.textContent = 'Level 1';
    this.amountLabel = el('div', 'aoe-hud__amount');
    this.amountLabel.textContent = '0/0';
    bar.append(this.fill, this.levelLabel, this.amountLabel);

    this.root.append(speedRow, bar);
    parent.appendChild(this.root);
  }

  /**
   * @param totalSpeed lifetime Speed farmed, replicated from the server
   * @param levelCap   highest reachable level for this player
   * @param rebirths   replicated rebirth count
   */
  update(totalSpeed: number, levelCap: number, rebirths: number): void {
    if (totalSpeed !== this.lastTotal) {
      this.lastTotal = totalSpeed;
      this.speedLabel.textContent = `${formatSpeed(totalSpeed)} Speed`;
      this.renderBar(resolveLevel(totalSpeed, levelCap));
    }

    const level = resolveLevel(totalSpeed, levelCap).level;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.levelLabel.textContent = `Level ${level}`;
      // A brief pop marks the moment a level - and a permanent speed rise - is
      // gained. Restarting the animation needs the reflow in between.
      this.root.classList.remove('aoe-hud--levelup');
      void this.root.offsetWidth;
      this.root.classList.add('aoe-hud--levelup');
    }

    if (rebirths !== this.lastRebirths) {
      this.lastRebirths = rebirths;
      this.multiLabel.textContent = `x${rebirthMultiplier(rebirths)} Multi (Rebirth)`;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private renderBar(progress: LevelProgress): void {
    this.fill.style.width = `${(progress.fraction * 100).toFixed(2)}%`;
    this.amountLabel.textContent = progress.capped
      ? 'MAX LEVEL'
      : `${formatSpeed(progress.into)}/${formatSpeed(progress.required)}`;
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

/** One stylesheet for the HUD, injected on first construction. */
const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.aoe-hud {
  /*
   * NOT positioned here. It lives in the bottom dock (\`.aoe-dock-bottom\` in
   * hudStyles), which anchors it bottom-centre, gives it its width, and
   * stacks it above the flight meter - so its placement can never drift from
   * the meter's height, at any window size.
   */
  position: relative;
  width: 100%;
  pointer-events: none;
  user-select: none;
  /*
   * A heavy grotesque with a real black weight. The reference art uses a
   * rounded display face; Arial Black is the closest thing every platform
   * already has, and shipping a font file would be the single largest asset in
   * a build that currently has none.
   */
  font-family: "Arial Black", "Arial Bold", Arial, system-ui, sans-serif;
  z-index: 20;
}

/*
 * The chunky dark rim on every figure. Eight offsets plus a soft drop: a
 * -webkit-text-stroke would be one declaration, but it thins badly at small
 * sizes on some platforms and this reads identically everywhere.
 */
/* Every size below is in the HUD unit (--u, hudStyles), so the bar scales
 * with the rest of the HUD as one design. */
.aoe-hud__speed,
.aoe-hud__level,
.aoe-hud__amount {
  color: #ffffff;
  text-shadow:
    var(--hud-o) 0 0 #12181f, calc(-1 * var(--hud-o)) 0 0 #12181f,
    0 var(--hud-o) 0 #12181f, 0 calc(-1 * var(--hud-o)) 0 #12181f,
    var(--hud-o2) var(--hud-o2) 0 #12181f, calc(-1 * var(--hud-o2)) var(--hud-o2) 0 #12181f,
    var(--hud-o2) calc(-1 * var(--hud-o2)) 0 #12181f,
    calc(-1 * var(--hud-o2)) calc(-1 * var(--hud-o2)) 0 #12181f,
    0 calc(5 * var(--u)) calc(9 * var(--u)) rgba(0, 0, 0, 0.45);
}

.aoe-hud__speed-row {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: calc(10 * var(--u));
  margin-bottom: calc(8 * var(--u));
}
.aoe-hud__speed {
  font-size: max(18px, calc(42 * var(--u)));
  letter-spacing: 0.01em;
  line-height: 1.05;
  white-space: nowrap;
}
/* The rebirth multiplier: purple, smaller, and sitting off the baseline of the
 * Speed figure rather than centred with it. */
.aoe-hud__multi {
  font-size: max(10px, calc(16 * var(--u)));
  color: #d46bff;
  white-space: nowrap;
  padding-bottom: 0.35em;
  text-shadow:
    var(--hud-o2) 0 0 #2a1038, calc(-1 * var(--hud-o2)) 0 0 #2a1038,
    0 var(--hud-o2) 0 #2a1038, 0 calc(-1 * var(--hud-o2)) 0 #2a1038,
    0 calc(3 * var(--u)) calc(6 * var(--u)) rgba(0, 0, 0, 0.4);
}

.aoe-hud__bar {
  position: relative;
  height: max(26px, calc(50 * var(--u)));
  border-radius: 999px;
  border: max(2px, calc(4 * var(--u))) solid #12181f;
  box-shadow: 0 calc(5 * var(--u)) calc(12 * var(--u)) rgba(0, 0, 0, 0.4);
  overflow: hidden;
  /*
   * The empty track is a studded white plate, matching the brick surfaces in
   * the world. Two crossed gradients draw the stud grid without an image.
   */
  background-color: #f4f6f8;
  background-image:
    linear-gradient(90deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px),
    linear-gradient(0deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px);
  background-size: calc(14 * var(--u)) calc(14 * var(--u));
}
/*
 * The progress fill is the rainbow, and the level name sits ON it - so the bar
 * reads as one object filling up rather than as a chip beside a gauge.
 */
.aoe-hud__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  border-radius: 999px 6px 6px 999px;
  background: linear-gradient(
    90deg,
    #b46bff 0%,
    #5b8cff 22%,
    #37d17a 44%,
    #ffe14d 66%,
    #ff9c3d 84%,
    #ff5a4d 100%
  );
  box-shadow: inset 0 calc(-4 * var(--u)) 0 rgba(0, 0, 0, 0.16);
  transition: width 130ms linear;
}
.aoe-hud__level,
.aoe-hud__amount {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  font-size: max(12px, calc(22 * var(--u)));
  white-space: nowrap;
}
.aoe-hud__level { left: calc(18 * var(--u)); }
.aoe-hud__amount { right: calc(18 * var(--u)); }

.aoe-hud--levelup .aoe-hud__bar {
  animation: aoe-hud-pop 460ms ease-out;
}
@keyframes aoe-hud-pop {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 226, 120, 0.9); }
  35% { transform: scale(1.03); box-shadow: 0 0 0 9px rgba(255, 226, 120, 0); }
  100% { transform: scale(1); box-shadow: 0 5px 12px rgba(0, 0, 0, 0.4); }
}

@media (prefers-reduced-motion: reduce) {
  .aoe-hud__fill { transition: none; }
  .aoe-hud--levelup .aoe-hud__bar { animation: none; }
}
`;
  document.head.appendChild(style);
};
