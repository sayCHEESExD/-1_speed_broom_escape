import {
  maxLevelForRebirth,
  nextRebirthTier,
  rebirthMultiplier,
} from '@broom/shared';
import { Panel } from './Panel.js';

/**
 * The rebirth confirmation.
 *
 * Laid out as a BEFORE and AFTER pair, as the reference art frames it: the two
 * things a rebirth changes shown side by side with an arrow between them, so
 * what is being traded is legible at a glance rather than buried in a
 * paragraph. It is the one irreversible button in the game, and the cost - the
 * level reset - is stated in red under the swap rather than left to be
 * inferred.
 *
 * The button only ever ASKS. Eligibility is decided by the server from its own
 * level and rebirth count, and this panel's enabled state is a mirror of the
 * replicated figures rather than a second opinion about them.
 */
export class RebirthPanel extends Panel {
  private readonly beforeSpeed: HTMLSpanElement;
  private readonly afterSpeed: HTMLSpanElement;
  private readonly beforeLevel: HTMLSpanElement;
  private readonly afterLevel: HTMLSpanElement;
  private readonly barFill: HTMLDivElement;
  private readonly barLabel: HTMLSpanElement;
  private readonly action: HTMLButtonElement;

  private level = 1;
  private rebirths = 0;

  constructor(parent: HTMLElement, onRebirth: () => void) {
    super(parent, 'rebirth', 'Rebirth');

    const grid = document.createElement('div');
    grid.className = 'aoe-rb';
    grid.innerHTML =
      '<span class="aoe-rb__head aoe-font">Before</span>' +
      '<span></span>' +
      '<span class="aoe-rb__head aoe-font">After</span>';

    // Two rows, each a card, an arrow and a card. Built once and only ever
    // re-labelled, so a redraw never touches the layout.
    const speedRow = this.row(grid, 'speed');
    const levelRow = this.row(grid, 'level');
    this.beforeSpeed = speedRow[0];
    this.afterSpeed = speedRow[1];
    this.beforeLevel = levelRow[0];
    this.afterLevel = levelRow[1];

    const warning = document.createElement('p');
    warning.className = 'aoe-rb__warn aoe-font';
    warning.textContent = 'Rebirth resets your level!';

    const bar = document.createElement('div');
    bar.className = 'aoe-rb__bar';
    this.barFill = document.createElement('div');
    this.barFill.className = 'aoe-rb__fill';
    this.barLabel = document.createElement('span');
    this.barLabel.className = 'aoe-rb__barlabel aoe-font';
    bar.append(this.barFill, this.barLabel);

    this.action = document.createElement('button');
    this.action.type = 'button';
    this.action.className = 'aoe-action aoe-rb__go aoe-font';
    this.action.textContent = 'Rebirth';
    this.action.addEventListener('click', () => {
      if (this.action.disabled) return;
      onRebirth();
      this.setOpen(false);
    });

    this.body.append(grid, warning, bar, this.action);
    this.render();
  }

  /** Mirror the replicated progression. */
  setProgress(level: number, rebirths: number): void {
    if (level === this.level && rebirths === this.rebirths) return;
    this.level = level;
    this.rebirths = rebirths;
    this.render();
  }

  /** True when the server would accept a rebirth right now. */
  get isEligible(): boolean {
    return this.level >= nextRebirthTier(this.rebirths).requiredLevel;
  }

  protected override onOpened(): void {
    this.render();
  }

  /**
   * One before / arrow / after row, appended to the three-column grid.
   *
   * Returns the two value spans, which are the only parts a redraw touches.
   */
  private row(grid: HTMLDivElement, variant: string): [HTMLSpanElement, HTMLSpanElement] {
    const card = (): HTMLSpanElement => {
      const box = document.createElement('div');
      box.className = `aoe-rb__card aoe-rb__card--${variant}`;
      const value = document.createElement('span');
      value.className = 'aoe-font';
      box.appendChild(value);
      grid.appendChild(box);
      return value;
    };

    const before = card();

    const arrow = document.createElement('span');
    arrow.className = 'aoe-rb__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    grid.appendChild(arrow);

    return [before, card()];
  }

  private render(): void {
    const tier = nextRebirthTier(this.rebirths);
    const eligible = this.isEligible;
    const cap = maxLevelForRebirth(this.rebirths);

    this.beforeSpeed.textContent = `Speed x${rebirthMultiplier(this.rebirths)}`;
    this.afterSpeed.textContent = `Speed x${tier.multiplier}`;
    this.beforeLevel.textContent = `Max Level ${cap}`;
    this.afterLevel.textContent = `Max Level ${maxLevelForRebirth(this.rebirths + 1)}`;

    const shown = Math.min(this.level, cap);
    this.barFill.style.width = `${Math.min(Math.max(shown / cap, 0), 1) * 100}%`;
    this.barLabel.textContent = `LEVEL ${shown}/${cap}`;

    this.action.disabled = !eligible;
    this.action.textContent = eligible ? 'Rebirth' : `Level ${tier.requiredLevel} required`;
  }
}
