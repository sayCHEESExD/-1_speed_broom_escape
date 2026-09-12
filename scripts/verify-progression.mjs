/**
 * Authority tests for the server's progression rules.
 *
 * These are the rules a cheating client would most like to break: awarding
 * itself a stage, banking the same stage twice, claiming a broom it has not
 * paid for, farming a treadmill tier it has not levelled into, or flying
 * further than its broom's meter allows. Each is exercised here against the
 * real services and the real simulation, including the REJECTION paths - a
 * test that only checks the happy path proves nothing about authority.
 *
 * Run with `npm run verify:progression` (builds the server first).
 */
import {
  BROOMS,
  FLIGHT,
  STAGES,
  STAND_ROW,
  TRAINING,
  TRAIL_TIERS,
  broomForSlot,
  createMotion,
  createMovementInput,
  createSimEvents,
  nextRebirthTier,
  resolveLevel,
  totalSpeedToReach,
  resolveMovementProfile,
  standZ,
  stepPlayer,
  WorldCollision,
} from '../shared/dist/index.js';
import { StageService } from '../server/dist/progression/StageService.js';
import { BroomService } from '../server/dist/progression/BroomService.js';
import { RebirthService } from '../server/dist/progression/RebirthService.js';
import { SpeedService } from '../server/dist/progression/SpeedService.js';
import { TrailService } from '../server/dist/progression/TrailService.js';
import { PlayerState } from '../server/dist/rooms/state/PlayerState.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures += 1;
    console.error(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  } else {
    console.log(`  ok    ${label}`);
  }
};

/** A fresh player, initialised exactly as the room does on join. */
const newPlayer = (speeds, brooms) => {
  const player = new PlayerState();
  player.sessionId = 'test';
  brooms.initialise(player);
  speeds.initialise(player);
  return player;
};

console.log('stage rewards');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const stages = new StageService();
  const player = newPlayer(speeds, brooms);
  stages.initialise('test');

  const stage = STAGES[0];

  // Nowhere near the pad. The server checks the position IT simulated.
  player.x = 0;
  player.y = 0;
  player.z = stage.winPadZ - 400;
  check('claim from far away is refused', stages.claim('test', player, stage.index).reason, 'not-on-pad');
  check('  wins unchanged', player.wins, 0);

  // Standing on the pad. It is a small rectangle at the LEFT of the stage
  // end, so X matters as much as Z.
  player.x = stage.winPadX;
  player.z = stage.winPadZ;
  const first = stages.claim('test', player, stage.index);
  check('claim on the pad is granted', first.granted, true);
  check('  wins credited', player.wins, stage.winReward);
  check('  best stage recorded', player.bestStage, stage.index);

  // Immediately again, from the same spot.
  const second = stages.claim('test', player, stage.index);
  check('immediate re-claim is refused', second.granted, false);

  // A stage that does not exist.
  check('unknown stage is refused', stages.claim('test', player, 999).reason, 'unknown-stage');

  // Banking a stage RETURNS the player to the arena, and running it again
  // pays again - that is how a player grinds for a better broom.
  await sleep(500);
  const third = stages.claim('test', player, stage.index);
  check('a second run of the same stage pays again', third.granted, true);
  check('  wins credited twice', player.wins, stage.winReward * 2);

  // Every configured reward, checked against the specification.
  const expected = [1, 3, 8, 20, 50, 120, 200, 400];
  let rewardsOk = true;
  for (let i = 0; i < expected.length; i += 1) {
    if (STAGES[i].winReward !== expected[i]) rewardsOk = false;
  }
  check('stage rewards are 1/3/8/20/50/120/200/400', rewardsOk, true);
}

console.log('rebirth');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const rebirths = new RebirthService();
  const player = newPlayer(speeds, brooms);
  rebirths.sync(player);

  check('rebirth 1 needs level 25', nextRebirthTier(0).requiredLevel, 25);
  check('rebirth 2 needs level 50', nextRebirthTier(1).requiredLevel, 50);
  check('level cap is the next rebirth requirement', player.maxLevel, 25);
  check('a level-1 player may not rebirth', rebirths.isEligible(player), false);
  check('  and the request is refused', rebirths.rebirth(player, speeds).ok, false);

  // Earn the cap. Wins and brooms must survive what follows.
  player.wins = 137;
  player.ownedBrooms = 0b111;
  player.totalSpeed = 1e9;
  speeds.syncDerived(player);
  check('capped at level 25', player.level, 25);
  check('now eligible', rebirths.isEligible(player), true);

  const done = rebirths.rebirth(player, speeds);
  check('rebirth is granted', done.ok, true);
  check('  level reset to 1', player.level, 1);
  check('  Speed reset to 0', player.totalSpeed, 0);
  check('  rebirth count is 1', player.rebirths, 1);
  check('  cap raised to 50', player.maxLevel, 50);
  check('  Speed multiplier is x2', player.moveMultiplier, 2);
  check('  Wins survived', player.wins, 137);
  check('  brooms survived', player.ownedBrooms, 0b111);
}

console.log('trails');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const trails = new TrailService();
  const player = newPlayer(speeds, brooms);
  trails.initialise(player);

  const first = TRAIL_TIERS[0];
  check('starts with no trail', player.trailSlot, 0);
  check('  and owns none', player.ownedTrails, 0);

  check('buying with no Wins is refused', trails.buy(player, first.slot, speeds).reason, 'too-poor');
  check('equipping an unowned trail is refused', trails.equip(player, first.slot, speeds).reason, 'not-owned');
  check('an unknown slot is refused', trails.buy(player, 999, speeds).reason, 'unknown-slot');

  player.wins = 1000;
  const bought = trails.buy(player, first.slot, speeds);
  check('buying with Wins is granted', bought.ok, true);
  check('  price deducted', player.wins, 1000 - first.cost);
  check('  equipped on purchase', player.trailSlot, first.slot);
  check('  movement multiplier rose', player.moveMultiplier > 1, true);

  await sleep(400);
  check('re-buying is refused', trails.buy(player, first.slot, speeds).reason, 'already-owned');

  check('taking it off is allowed', trails.equip(player, 0, speeds).ok, true);
  check('  multiplier back to base', player.moveMultiplier, 1);
}

console.log('treadmills');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const player = newPlayer(speeds, brooms);
  speeds.reset('test', player);

  /** Speed farmed by standing still on `belt` for one second. */
  const farm = (belt) => {
    player.treadmill = belt;
    const before = player.totalSpeed;
    for (let i = 0; i < 60; i += 1) speeds.credit('test', player, 1 / 60);
    return player.totalSpeed - before;
  };

  // Standing perfectly still ON a belt still farms: the belt supplies the
  // distance, which is the whole point of an AFK trainer.
  check('a still player on a belt farms Speed', farm(1) > 0, true);

  // Stepping off stops it dead.
  check('a still player off a belt farms nothing', farm(0), 0);

  /*
   * THE TIER GATE, and it is the rejection path that matters.
   *
   * A level-1 player standing on a tier-2 or tier-3 belt earns NOTHING. The
   * simulation still says they are on it - a belt is a place, and where a
   * player is standing is not a thing the level changes - so the whole gate
   * lives with the payment, where the authoritative level already is.
   */
  /*
   * Level is DERIVED, so it is set by giving the player the Speed that reaches
   * it rather than by writing the field: `credit` re-derives level from
   * `totalSpeed` on every call, and a level written directly would be gone
   * before the belt was billed.
   */
  const atLevel = (level) => {
    /*
     * REBIRTHS too, because the level cap is not a constant.
     *
     * It is whatever the next rebirth requires - 25 per rebirth - so tier 3's
     * level 75 is unreachable without two of them, and a player who merely
     * banked the Speed would sit capped at 25 for ever. That is a real fact
     * about the ladder rather than a quirk of this test: the top training tier
     * is gated behind the prestige system as well as behind the level.
     */
    player.rebirths = Math.max(0, Math.ceil(level / 25) - 1);
    player.totalSpeed = totalSpeedToReach(level);
    speeds.syncDerived(player);
  };

  atLevel(1);
  const tier1 = farm(1);
  check('tier 1 pays at level 1', tier1 > 0, true);
  check('tier 2 pays NOTHING at level 1', farm(3), 0);
  check('tier 3 pays NOTHING at level 1', farm(5), 0);

  // The second machine of a tier is the same tier, which is the whole reason
  // there are two of them.
  check('the paired belt of tier 1 also pays', farm(2) > 0, true);
  check('  and the pair of tier 2 is still shut', farm(4), 0);

  // Level into tier 2 and it opens, at exactly the multiplier it advertises.
  atLevel(TRAINING.tiers[1].minLevel);
  const tier2 = farm(3);
  check('tier 2 opens at its own level', tier2 > 0, true);
  check(
    `  and pays x${TRAINING.tiers[1].multiplier} of tier 1`,
    Math.abs(tier2 / tier1 - TRAINING.tiers[1].multiplier) < 1e-6,
    true,
  );
  check('  tier 3 is still shut', farm(5), 0);

  atLevel(TRAINING.tiers[2].minLevel);
  const tier3 = farm(5);
  check(
    `tier 3 opens and pays x${TRAINING.tiers[2].multiplier} of tier 1`,
    Math.abs(tier3 / tier1 - TRAINING.tiers[2].multiplier) < 1e-6,
    true,
  );
  player.treadmill = 0;
}

console.log('flight');
{
  /*
   * THE METER, exercised against the real shared simulation.
   *
   * This is the authority test the whole game hangs on: a client holding the
   * thrust key forever must not be able to fly forever, and the only thing
   * standing between it and that is `stepPlayer` billing the meter inside the
   * same step that produced the climb. So the test holds the key down and
   * watches what the SIMULATION does, rather than asking a service a question.
   */
  const collision = new WorldCollision();
  const motion = createMotion();
  const events = createSimEvents();
  const input = createMovementInput();
  const capacity = 10;
  const params = {
    moveMultiplier: 1,
    jumpVelocity: 25,
    flyCapacity: capacity,
    time: 0,
  };

  motion.fly = capacity;
  const step = (seconds, held) => {
    input.jump = held;
    const ticks = Math.round(seconds * 60);
    for (let i = 0; i < ticks; i += 1) {
      params.time += 1 / 60;
      stepPlayer(motion, input, params, 1 / 60, collision, events);
    }
  };

  check('a full tank starts at the broom capacity', motion.fly, capacity);

  // One second of held thrust costs one second of meter, less the takeoff toll.
  step(1, true);
  const spent = capacity - motion.fly;
  check(
    'one second of thrust costs about one meter-second',
    Math.abs(spent - (1 + FLIGHT.launchCost)) < 0.1,
    true,
  );
  check('  and it actually climbed', motion.y > 1, true);

  // Hold it down for far longer than the tank holds. The meter must bottom out
  // at zero and STAY there - never negative, and never buying more lift.
  step(30, true);
  check('holding thrust forever empties the meter', motion.fly, 0);
  check('  and it never goes negative', motion.fly >= 0, true);
  /*
   * And an empty meter buys NOTHING more.
   *
   * By this point the broom has run dry, fallen and settled on the floor, so
   * the assertion is that holding the key from there does not lift it at all -
   * not that it keeps falling, which it has already finished doing.
   */
  const ceiling = motion.y;
  const grounded = motion.grounded;
  step(3, true);
  check('an empty meter buys no more climb', motion.y <= ceiling + 1e-6, true);
  check('  and a held key on empty never leaves the ground', grounded && motion.grounded, true);

  /*
   * The REFILL, and the thing that makes the meter a decision.
   *
   * Only on the ground, only after the rest delay, and slower than it drains -
   * so a player cannot tap the floor mid-crossing and take off with a full
   * tank. Simulated by putting the mount back on the floor and releasing.
   */
  motion.x = 0;
  motion.y = 0;
  motion.z = -62;
  motion.vy = 0;
  motion.grounded = true;
  motion.rest = 0;
  step(4, false);
  check('resting on the ground refills the meter', motion.fly > 0, true);
  check(
    '  and slower than it drained',
    motion.fly < 4 * FLIGHT.drainPerSecond,
    true,
  );
  check(
    '  never past the broom capacity',
    motion.fly <= capacity + 1e-6,
    true,
  );

  // A capacity that SHRANK - a profile restored onto a smaller broom - must
  // clamp the reading down rather than leave a player holding flight they do
  // not own.
  motion.fly = capacity;
  params.flyCapacity = 4;
  step(0.1, false);
  check('a smaller broom clamps the meter down', motion.fly <= 4, true);

  // And an empty tank refuses the launch outright: no impulse, no lift, no
  // fractional frame of it.
  params.flyCapacity = capacity;
  motion.fly = 0;
  motion.y = 0;
  motion.vy = 0;
  motion.grounded = true;
  motion.jumpLatched = false;
  step(0.5, true);
  check('an empty tank refuses the launch', motion.grounded, true);
  check('  and the meter is still empty', motion.fly, 0);
}

console.log('broom claiming');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const player = newPlayer(speeds, brooms);

  const llama = BROOMS.find((a) => a.slot === 2);

  check('starts on the free starter', player.broomSlot, 1);
  check('  owns only the starter', player.ownedBrooms, 1);

  // At the stand, but broke. The line-up is a COLUMN down the left wall, so
  // the fixed axis is X and the per-slot axis is Z.
  player.x = STAND_ROW.x;
  player.y = 0;
  player.z = standZ(llama.slot);
  check('claim with no Wins is refused', brooms.claim(player, llama.slot, speeds).reason, 'too-poor');
  check('  still on the starter', player.broomSlot, 1);

  // Rich, but standing somewhere else entirely.
  player.wins = 500;
  player.x = 0;
  player.z = 0;
  check('claim away from the stand is refused', brooms.claim(player, llama.slot, speeds).reason, 'not-at-stand');
  check('  Wins not deducted', player.wins, 500);

  // Rich and in the right place.
  player.x = STAND_ROW.x;
  player.z = standZ(llama.slot);
  const bought = brooms.claim(player, llama.slot, speeds);
  check('claim at the stand with Wins is granted', bought.granted, true);
  check('  price deducted', player.wins, 500 - llama.winsRequired);
  check('  now equipped', player.broomSlot, llama.slot);
  check('  Speed per stride follows the broom', player.speedPerStep, llama.speedPerStep);

  // Buying it again must not charge twice.
  await sleep(300);
  const again = brooms.claim(player, llama.slot, speeds);
  check('re-claiming an owned broom is refused', again.reason, 'already-owned');

  // A cheaper broom must never downgrade the equipped one.
  const winsBefore = player.wins;
  await sleep(300);
  player.z = standZ(1);
  brooms.claim(player, 1, speeds);
  check('claiming the starter again does not downgrade', player.broomSlot, llama.slot);
  check('  and costs nothing', player.wins, winsBefore);
}

console.log('speed and levels');
{
  const speeds = new SpeedService();
  const brooms = new BroomService();
  const player = newPlayer(speeds, brooms);

  check('starts at level 1', player.level, 1);

  // Credit honest movement: sixty 1/60-second steps at a plausible gallop.
  // The per-step distance has to be one the server would actually observe -
  // anything larger is a teleport by definition and pays nothing.
  speeds.reset('test', player);
  const perStep = 24 / 60;
  let z = 0;
  for (let i = 0; i < 60; i += 1) {
    z += perStep;
    player.z = z;
    speeds.credit('test', player, 1 / 60);
  }
  check('honest movement pays', player.totalSpeed > 0, true);

  // A teleport must pay nothing at all.
  const beforeTeleport = player.totalSpeed;
  player.z = z + 5000;
  speeds.credit('test', player, 1 / 60);
  check('a teleport pays nothing', player.totalSpeed, beforeTeleport);

  // The level curve reproduces the reference art's figures.
  const at52 = resolveLevel(453600, 100);
  check('453.6K Speed resolves to level 52', at52.level, 52);

  // Movement speed rises with level through the one shared formula. The cap
  // before any rebirth is level 25, so that is where a huge Speed total lands -
  // getting past it is what the rebirth ladder is FOR.
  player.totalSpeed = 453600;
  speeds.syncDerived(player);
  check('a huge Speed total caps at the pre-rebirth level', player.level, 25);
  // The INVARIANT, not a number. The magic 2 that used to be here was a fact
  // about the linear curve and failed the moment that curve was given the
  // diminishing returns which keep a late-game mount landable. What actually
  // has to be true is that levelling makes you faster and keeps making you
  // faster - which is checkable without hard-coding how much.
  const atLevel1 = resolveMovementProfile(1, 0, 1, 1).multiplier;
  const atCap = resolveMovementProfile(25, 0, 1, 1).multiplier;
  const higher = resolveMovementProfile(60, 0, 1, 1).multiplier;
  check('level drives the replicated multiplier', player.moveMultiplier > atLevel1, true);
  check('  and it is the level cap that is driving it', player.moveMultiplier, atCap);
  check('  and a higher level is still faster', higher > atCap, true);
  check('  and the broom is still the starter', player.broomSlot, 1);
  check('  speedPerStep matches the equipped broom', player.speedPerStep, broomForSlot(1).speedPerStep);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('progression OK');
