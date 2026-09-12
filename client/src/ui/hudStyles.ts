/**
 * One stylesheet for the whole HUD, injected on first use.
 *
 * Every panel and button in the game shares these rules, so the rail, the win
 * counter and the two shop panels cannot drift apart visually. The look is
 * taken from the reference art: heavy white display type with a thick dark
 * rim, saturated gradient tiles with a chunky border, and a red badge when
 * something is waiting to be collected.
 */
let injected = false;

export const injectHudStyles = (): void => {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.textContent = `
:root {
  /* ONE number scales the whole left rail, so the column grows together. */
  --aoe-rail: 78px;
  --aoe-ink: #12181f;
}

.aoe-font {
  font-family: "Arial Black", "Arial Bold", Arial, system-ui, sans-serif;
}

/*
 * The chunky dark rim on every figure. Eight offsets plus a soft drop: a
 * -webkit-text-stroke would be one declaration, but it thins badly at small
 * sizes on some platforms and this reads identically everywhere.
 */
.aoe-outline {
  color: #fff;
  text-shadow:
    3px 0 0 var(--aoe-ink), -3px 0 0 var(--aoe-ink),
    0 3px 0 var(--aoe-ink), 0 -3px 0 var(--aoe-ink),
    2px 2px 0 var(--aoe-ink), -2px 2px 0 var(--aoe-ink),
    2px -2px 0 var(--aoe-ink), -2px -2px 0 var(--aoe-ink),
    0 5px 9px rgba(0, 0, 0, 0.45);
}

/* ---- Wins, upper centre ------------------------------------------------- */
.aoe-wins {
  position: fixed;
  top: max(10px, env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  user-select: none;
  z-index: 22;
}
.aoe-wins__icon {
  width: clamp(32px, 3.6vw, 50px);
  height: clamp(32px, 3.6vw, 50px);
}
.aoe-wins__icon .aoe-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
}
.aoe-wins__value {
  font-size: clamp(22px, 3vw, 40px);
  line-height: 1;
  /* Orange, as the reference art has it - the one warm figure on screen. */
  color: #ff9d1f;
  text-shadow:
    3px 0 0 #fff, -3px 0 0 #fff, 0 3px 0 #fff, 0 -3px 0 #fff,
    2px 2px 0 #fff, -2px 2px 0 #fff, 2px -2px 0 #fff, -2px -2px 0 #fff,
    0 6px 10px rgba(0, 0, 0, 0.5);
}
.aoe-wins--pop .aoe-wins__value { animation: aoe-pop 520ms ease-out; }
@keyframes aoe-pop {
  0% { transform: scale(1); }
  35% { transform: scale(1.22); }
  100% { transform: scale(1); }
}

/* ---- Left rail ---------------------------------------------------------- */
.aoe-rail {
  position: fixed;
  left: max(10px, env(safe-area-inset-left, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  z-index: 21;
  user-select: none;
}
.aoe-tile {
  position: relative;
  width: var(--aoe-rail);
  height: var(--aoe-rail);
  border: 4px solid var(--aoe-ink);
  border-radius: 20px;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.38);
  transition: transform 110ms ease;
}
.aoe-tile:hover { transform: scale(1.06); }
.aoe-tile:active { transform: scale(0.97); }
.aoe-tile .aoe-icon {
  width: 74%;
  height: 74%;
  object-fit: contain;
  /* The art carries its own outline, so it needs a drop shadow rather than a
   * stroke to lift it off the gradient behind it. */
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}
/* The label sits UNDER the tile, overlapping its bottom edge, as in the art. */
.aoe-tile__label {
  position: absolute;
  left: 50%;
  bottom: -9px;
  transform: translateX(-50%);
  font-size: clamp(11px, 1.15vw, 15px);
  white-space: nowrap;
  pointer-events: none;
}
/* The PC key cap, top-left, as in the reference art.
 *
 * Top LEFT because the red "!" badge already owns the bottom right and the
 * label owns the bottom edge - the corner is the only place it can sit without
 * covering something that was there first.
 */
.aoe-tile__key {
  position: absolute;
  left: -7px;
  top: -7px;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 3px solid var(--aoe-ink);
  border-radius: 7px;
  background: #ffffff;
  color: var(--aoe-ink);
  font-size: 13px;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.28);
  pointer-events: none;
}
/* Touch has no keyboard, so the mobile layout keeps exactly what it had. */
body.aoe-touch-mode .aoe-tile__key { display: none; }

/* The red "!" badge: something is available. */
.aoe-tile__badge {
  position: absolute;
  right: -8px;
  bottom: -8px;
  width: 24px;
  height: 24px;
  border: 3px solid var(--aoe-ink);
  border-radius: 50%;
  background: #f5363f;
  color: #fff;
  font-size: 15px;
  line-height: 18px;
  text-align: center;
  display: none;
}
.aoe-tile--ready .aoe-tile__badge { display: block; }
.aoe-tile--locked { filter: saturate(0.45) brightness(0.78); }

.aoe-tile--rebirth {
  background: linear-gradient(160deg, #ff5ff0 0%, #b23bff 55%, #7a1fd6 100%);
}
.aoe-tile--trail {
  background: linear-gradient(160deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
}
.aoe-tile--audio {
  background: linear-gradient(160deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
}
/* Muted: the tile stays lit enough to find, and plainly off. */
.aoe-tile--off { filter: saturate(0.25) brightness(0.7); }
.aoe-tile--off .aoe-icon { opacity: 0.55; }

/* ---- Trophies flying to the Wins counter --------------------------------
 * Above the HUD, unlike the Speed popups: these are meant to arrive AT the
 * counter, so passing behind it would hide the moment they exist for. They
 * last about half a second and nothing can be clicked through them.
 */
.aoe-flight {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 30;
}
.aoe-flight__cup {
  position: absolute;
  left: 0;
  top: 0;
  width: clamp(26px, 3vw, 40px);
  height: auto;
  opacity: 0;
  will-change: transform, opacity;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}
.aoe-flight__cup[hidden] { display: none; }
.aoe-flight__cup--run { animation: aoe-flight 620ms cubic-bezier(0.4, 0, 0.5, 1) forwards; }
@keyframes aoe-flight {
  0% {
    opacity: 0;
    transform: translate(calc(var(--aoe-fx) - 50%), calc(var(--aoe-fy) - 50%)) scale(0.4) rotate(0deg);
  }
  18% {
    opacity: 1;
    transform: translate(calc(var(--aoe-fx) - 50%), calc(var(--aoe-fy) - 50%)) scale(1.1) rotate(-20deg);
  }
  60% {
    opacity: 1;
    transform: translate(calc(var(--aoe-mx) - 50%), calc(var(--aoe-my) - 50%)) scale(0.95) rotate(140deg);
  }
  100% {
    opacity: 0;
    transform: translate(calc(var(--aoe-tx) - 50%), calc(var(--aoe-ty) - 50%)) scale(0.35) rotate(340deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Still travels - that is the information - but without the tumble. */
  .aoe-flight__cup--run { animation: aoe-flight-plain 620ms ease-out forwards; }
  @keyframes aoe-flight-plain {
    0% { opacity: 0; transform: translate(calc(var(--aoe-fx) - 50%), calc(var(--aoe-fy) - 50%)); }
    20%, 70% { opacity: 1; }
    100% { opacity: 0; transform: translate(calc(var(--aoe-tx) - 50%), calc(var(--aoe-ty) - 50%)); }
  }
}

/* ---- The Rebirth panel ---------------------------------------------------
 * A BEFORE and AFTER pair with an arrow between them, as the reference art
 * frames it: the two things a rebirth changes, side by side, so the trade is
 * legible at a glance instead of buried in a paragraph.
 */
.aoe-rb {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px 12px;
  margin-bottom: 14px;
}
.aoe-rb__head {
  text-align: center;
  font-size: clamp(15px, 1.6vw, 20px);
  color: #43506b;
}
.aoe-rb__card {
  display: grid;
  place-items: center;
  padding: 10px 8px;
  border-radius: 12px;
  border: 3px solid var(--aoe-ink);
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.18);
  font-size: clamp(14px, 1.7vw, 22px);
  color: #ffffff;
  /* The figure is the point of the card, so it never wraps and never clips:
   * it shrinks to fit instead, the same rule the world signs follow. */
  white-space: nowrap;
  overflow: hidden;
  text-shadow:
    2px 0 0 var(--aoe-ink), -2px 0 0 var(--aoe-ink),
    0 2px 0 var(--aoe-ink), 0 -2px 0 var(--aoe-ink);
}
.aoe-rb__card--speed {
  background: linear-gradient(180deg, #8fd0ff 0%, #4b9ff0 55%, #2f7ad4 100%);
}
.aoe-rb__card--level {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #e07f10 100%);
}
.aoe-rb__arrow {
  width: 0;
  height: 0;
  justify-self: center;
  border-top: 15px solid transparent;
  border-bottom: 15px solid transparent;
  border-left: 22px solid #c6d8ef;
  filter: drop-shadow(2px 2px 0 rgba(43, 60, 88, 0.35));
}
/* The reference panel sits on a pale blue ground rather than plain white,
 * which is what keeps the white card text legible. */
.aoe-panel--rebirth .aoe-panel__body {
  background: #dce7f5;
}
.aoe-rb__warn {
  margin: 0 0 12px;
  text-align: center;
  font-size: clamp(14px, 1.5vw, 19px);
  color: #f4506a;
  text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.75);
}
.aoe-rb__bar {
  position: relative;
  height: 34px;
  border-radius: 10px;
  border: 3px solid var(--aoe-ink);
  background: #ffffff;
  overflow: hidden;
  margin-bottom: 14px;
}
.aoe-rb__fill {
  height: 100%;
  background: linear-gradient(180deg, #9bf06a 0%, #4fce2e 60%, #37a81f 100%);
  transition: width 220ms ease-out;
}
.aoe-rb__barlabel {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: clamp(13px, 1.4vw, 17px);
  color: #ffffff;
  text-shadow:
    2px 0 0 var(--aoe-ink), -2px 0 0 var(--aoe-ink),
    0 2px 0 var(--aoe-ink), 0 -2px 0 var(--aoe-ink);
}
.aoe-rb__go {
  background: linear-gradient(180deg, #ff8cf0 0%, #b44bff 55%, #7f22d6 100%);
  color: #ffffff;
  font-size: clamp(17px, 2vw, 26px);
}
.aoe-rb__go:disabled {
  filter: saturate(0.3) brightness(0.85);
}
@media (prefers-reduced-motion: reduce) {
  .aoe-rb__fill { transition: none; }
}

/* ---- The Bloxity account chip -------------------------------------------
 * Top RIGHT: the Wins counter owns the top centre and the rail owns the left,
 * and this is the only corner left that a player is not already reading.
 */
.aoe-account {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 23;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.aoe-account__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border: 3px solid var(--aoe-ink);
  border-radius: 999px;
  background: rgba(18, 24, 38, 0.82);
}
.aoe-account__pfp {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid var(--aoe-ink);
  object-fit: cover;
}
.aoe-account__name {
  font-size: clamp(12px, 1.2vw, 15px);
  color: #ffffff;
  max-width: 22vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aoe-account__note {
  font-size: clamp(10px, 1vw, 13px);
  color: #ffffff;
  opacity: 0.6;
}
.aoe-account__actions {
  display: flex;
  gap: 6px;
}
.aoe-account__btn,
.aoe-account__login {
  cursor: pointer;
  border: 3px solid var(--aoe-ink);
  border-radius: 10px;
  padding: 5px 10px;
  font-size: clamp(11px, 1.1vw, 14px);
  color: #ffffff;
  background: linear-gradient(180deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
}
.aoe-account__login {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
  padding: 7px 14px;
}
.aoe-account__btn:hover,
.aoe-account__login:hover { filter: brightness(1.1); }
/* Touch keeps the chip but drops the row of buttons to a single tap target's
 * worth of width, so it never crowds the jump button. */
body.aoe-touch-mode .aoe-account__name { max-width: 30vw; }

/* ---- Friends and Bux rows ----------------------------------------------- */
.aoe-friend {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-bottom: 2px solid rgba(43, 60, 88, 0.16);
}
.aoe-friend:last-of-type { border-bottom: none; }
.aoe-friend__pfp {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid var(--aoe-ink);
  object-fit: cover;
  flex: none;
}
.aoe-friend__name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  flex: 1 1 auto;
  min-width: 0;
}
.aoe-friend__name b,
.aoe-friend__name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aoe-friend__name small { opacity: 0.6; }
.aoe-friend__status {
  font-size: 12px;
  opacity: 0.75;
  flex: none;
}
.aoe-friend__invite,
.aoe-bux__buy {
  cursor: pointer;
  flex: none;
  border: 3px solid var(--aoe-ink);
  border-radius: 9px;
  padding: 5px 11px;
  color: #ffffff;
  font: inherit;
  font-size: 13px;
  background: linear-gradient(180deg, #9bf06a 0%, #4fce2e 60%, #37a81f 100%);
}
.aoe-friend__invite:disabled,
.aoe-bux__buy:disabled { filter: saturate(0.3) brightness(0.85); cursor: default; }

.aoe-bux {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 2px solid rgba(43, 60, 88, 0.16);
}
.aoe-bux:last-of-type { border-bottom: none; }
.aoe-bux__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  flex: 1 1 auto;
}
.aoe-bux__text small { opacity: 0.65; }
.aoe-bux__buy {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
}

.aoe-panel--friends .aoe-panel__head,
.aoe-panel--bux .aoe-panel__head {
  background: linear-gradient(160deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
}

/* ---- The FPS readout, from the portal's show_fps setting ----------------- */
.aoe-fps {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 23;
  font-size: 13px;
  color: #9bf06a;
  text-shadow:
    2px 0 0 var(--aoe-ink), -2px 0 0 var(--aoe-ink),
    0 2px 0 var(--aoe-ink), 0 -2px 0 var(--aoe-ink);
  pointer-events: none;
}
.aoe-fps[hidden] { display: none; }

/* ---- Panels ------------------------------------------------------------- */
.aoe-panel {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(6, 10, 18, 0.55);
  z-index: 40;
}
.aoe-panel[hidden] { display: none; }
.aoe-panel__box {
  width: min(560px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border: 5px solid var(--aoe-ink);
  border-radius: 22px;
  background: #f2f5f8;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.aoe-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  color: #fff;
  font-size: 22px;
}
.aoe-panel--rebirth .aoe-panel__head {
  background: linear-gradient(90deg, #b23bff, #7a1fd6);
}
.aoe-panel--trail .aoe-panel__head {
  background: linear-gradient(90deg, #2aa8f5, #1670d0);
}
.aoe-panel__close {
  border: 3px solid var(--aoe-ink);
  border-radius: 12px;
  background: #f5363f;
  color: #fff;
  width: 34px;
  height: 34px;
  font-size: 17px;
  cursor: pointer;
}
.aoe-panel__body {
  padding: 14px 16px 18px;
  overflow-y: auto;
  color: #16202b;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
}
.aoe-panel__note { margin-bottom: 12px; line-height: 1.5; }
.aoe-panel__note b { font-size: 16px; }

.aoe-action {
  width: 100%;
  padding: 13px;
  border: 4px solid var(--aoe-ink);
  border-radius: 16px;
  background: linear-gradient(180deg, #58e06a, #2fae42);
  color: #fff;
  font-size: 19px;
  cursor: pointer;
}
.aoe-action:disabled {
  background: linear-gradient(180deg, #b9c2cc, #93a0ad);
  cursor: not-allowed;
}

/* ---- Shop rows ---------------------------------------------------------- */
.aoe-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 11px;
  margin-bottom: 8px;
  border: 3px solid var(--aoe-ink);
  border-radius: 14px;
  background: #fff;
}
.aoe-row--owned { background: #eafbe9; }
.aoe-row--equipped { background: #dff3ff; box-shadow: inset 0 0 0 3px #2aa8f5; }
.aoe-row__swatch {
  width: 30px;
  height: 30px;
  border: 3px solid var(--aoe-ink);
  border-radius: 9px;
  flex: none;
}
.aoe-row__text { flex: 1; min-width: 0; }
.aoe-row__name { font-weight: 800; }
.aoe-row__meta { opacity: 0.72; font-size: 12px; }
.aoe-row__buy {
  border: 3px solid var(--aoe-ink);
  border-radius: 12px;
  padding: 8px 13px;
  background: linear-gradient(180deg, #ffd54a, #f0a91f);
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.aoe-row__buy:disabled {
  background: linear-gradient(180deg, #cfd6dd, #aab4bf);
  cursor: not-allowed;
}

/* ---- Speed-gain popups -------------------------------------------------- */
/*
 * Deliberately BELOW the HUD in the stacking order (the bar is 20, the rail 21,
 * the Wins counter 22). Popups are spawned inside a band that already misses
 * all three, and sitting under them means even a mis-tuned band can never
 * cover a figure the player needs to read.
 */
.aoe-pops {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 19;
}
.aoe-pop {
  --aoe-pop-tilt: 0deg;
  --aoe-pop-scale: 1;
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  opacity: 0;
  will-change: transform, opacity;
}
.aoe-pop[hidden] { display: none; }
.aoe-pop__icon {
  /* Supplied art. Driving the HEIGHT and leaving the width automatic is what
   * keeps the real aspect ratio exact at every clamp step; setting both is how
   * a supplied icon gets squashed. */
  height: clamp(36px, 4.2vw, 60px);
  width: auto;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}
.aoe-pop__value {
  font-size: clamp(16px, 2vw, 29px);
  line-height: 1;
  color: #fff;
  text-shadow:
    3px 0 0 var(--aoe-ink), -3px 0 0 var(--aoe-ink),
    0 3px 0 var(--aoe-ink), 0 -3px 0 var(--aoe-ink),
    2px 2px 0 var(--aoe-ink), -2px 2px 0 var(--aoe-ink),
    2px -2px 0 var(--aoe-ink), -2px -2px 0 var(--aoe-ink),
    0 4px 8px rgba(0, 0, 0, 0.5);
}
.aoe-pop--run { animation: aoe-pop-float 1150ms ease-out forwards; }
@keyframes aoe-pop-float {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(var(--aoe-pop-tilt))
      scale(calc(var(--aoe-pop-scale) * 0.6));
  }
  16% {
    opacity: 1;
    transform: translate(-50%, -54%) rotate(var(--aoe-pop-tilt))
      scale(calc(var(--aoe-pop-scale) * 1.1));
  }
  30% {
    opacity: 1;
    transform: translate(-50%, -62%) rotate(var(--aoe-pop-tilt))
      scale(var(--aoe-pop-scale));
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -125%) rotate(var(--aoe-pop-tilt))
      scale(var(--aoe-pop-scale));
  }
}

/* Touch controls own the bottom corners; the rail lifts clear of them. */
body.aoe-touch-mode .aoe-rail { --aoe-rail: 62px; }

@media (prefers-reduced-motion: reduce) {
  .aoe-tile, .aoe-wins--pop .aoe-wins__value { transition: none; animation: none; }
  /* The popup still has to appear and go away, so it fades in place rather
   * than not animating at all. */
  .aoe-pop--run { animation: aoe-pop-fade 1150ms ease-out forwards; }
  @keyframes aoe-pop-fade {
    0% { opacity: 0; transform: translate(-50%, -50%); }
    15%, 65% { opacity: 1; transform: translate(-50%, -50%); }
    100% { opacity: 0; transform: translate(-50%, -50%); }
  }
}

/* A narrow window has less room either side, so the band tightens with it. */
@media (max-width: 760px) {
  .aoe-pop__icon { height: clamp(30px, 6vw, 44px); }
  .aoe-pop__value { font-size: clamp(14px, 3vw, 22px); }
}
`;
  document.head.appendChild(style);
};

/**
 * The HUD icons, as supplied in `assets/ui/`.
 *
 * Served straight from the repo-level assets folder through Vite's publicDir,
 * exactly as the player model is - so there is no duplicate copy inside the
 * client workspace. They are the artwork from the reference screenshots, which
 * is why they are images rather than the hand-drawn SVGs they replaced: a
 * traced approximation of a piece of art you already have is a worse version
 * of it.
 *
 * `alt` is deliberately empty - each one sits inside a control that already
 * carries its own accessible name.
 */
const icon = (file: string): string =>
  `<img class="aoe-icon" src="/ui/${file}" alt="" draggable="false">`;

/*
 * The speaker is drawn rather than loaded.
 *
 * The other three are SUPPLIED ART and are used as they are; there is no
 * supplied speaker, and adding an image for a shape that is four straight
 * lines would be the one place in this project where a file bought nothing.
 */
const SPEAKER =
  '<svg class="aoe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="M4 9h3.2L12 4.6v14.8L7.2 15H4z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'd="M15.6 8.6a4.6 4.6 0 0 1 0 6.8M18.4 5.8a8.4 8.4 0 0 1 0 12.4"/>' +
  '</svg>';

export const ICONS = {
  trophy: icon('trophy.png'),
  rebirth: icon('rebirth.png'),
  trail: icon('trail.png'),
  audio: SPEAKER,
} as const;
