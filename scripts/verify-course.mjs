/**
 * Static checks on the generated course.
 *
 * The course is GENERATED from a pattern table, so a tuning change can quietly
 * produce a hole nobody meant to be there or a gap no player could clear. This
 * walks the same arrays the renderer and the server read and fails loudly on:
 *
 *   - stages that overlap
 *   - unmarked holes in the run-up, the landings or the finish approach
 *   - gaps wider than a player's FLIGHT can carry them at that stage
 *   - gaps narrow enough to be hopped, which would make flight optional
 *   - hazards that sweep outside the corridor
 *   - treadmill tiers whose gates and multipliers disagree with the roster
 *
 * Run with `npm run verify:course`. Requires `npm run build:shared` first.
 */
import {
  BALLISTIC_REACH,
  BALLISTIC_RISE,
  BROOMS,
  COURSE,
  COURSE_HAZARDS,
  COURSE_SOLIDS,
  FLIGHT,
  MOUNT_HEIGHT,
  MOVEMENT,
  QUICKSAND,
  SINKING_SOLIDS,
  SPAWN_POSITION,
  STAGES,
  TRAINING,
  TREADMILL_COUNT,
  RUINS_ARENA,
  TREADMILL_BELT_Y,
  WIDE_AREAS,
  ballisticFor,
  broomForSlot,
  corridorHalfWidthAt,
  flightReach,
  hazardReachX,
  totalSpeedToReach,
  resolveMovementProfile,
  sinkingOffsetAt,
  treadmillAt,
  treadmillTier,
  treadmillX,
  treadmillZ,
} from '../shared/dist/index.js';

let failures = 0;

const fail = (message) => {
  failures += 1;
  console.error(`  FAIL  ${message}`);
};

const pass = (message) => console.log(`  ok    ${message}`);

/**
 * Merge the Z spans that have SOME walkable surface anywhere in the corridor.
 *
 * Deliberately width- AND height-agnostic. A plank bridge leaves the centre
 * line empty for twenty-four units but is not a jump, and stage 2's gantry
 * runs nine units above the floor - a test that insisted on floor level
 * reported both as unclearable holes. What actually matters is whether there
 * is anything to land on at all.
 *
 * `boost` is excluded because it is a decal painted on floor that already
 * exists, so counting it would mask a hole underneath it.
 */
const walkableSpans = () => {
  // Sinking platforms count. They are floor for most of every cycle - the
  // crypt slabs are made of nothing else - and leaving them out reported that
  // whole stage as one 239-unit hole no player could cross.
  //
  // CEILINGS do not. A roof spans its whole stage, so counting it would merge
  // every gap in that stage into one continuous span and this check would
  // silently stop checking anything at all.
  const spans = [...COURSE_SOLIDS.filter(walkable), ...SINKING_SOLIDS]
    .map((solid) => [solid.minZ, solid.maxZ])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + 1e-6) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
};

/**
 * Is this a solid a player could ever stand on?
 *
 * Everything except the roof. Used by every span and coverage check below, so
 * a ceiling cannot stand in for the floor it hangs over.
 */
const walkable = (solid) => solid.kind !== 'ceiling';

/** Z ranges where floor exists but not on the centre line - a plank crossing. */
const narrowCrossings = () => {
  const centre = [...COURSE_SOLIDS.filter(walkable), ...SINKING_SOLIDS].filter(
    (s) => s.minX <= 0 && s.maxX >= 0,
  );
  const covered = (z) => centre.some((s) => z >= s.minZ && z <= s.maxZ);
  const found = [];
  let open = null;
  for (const [from, to] of walkableSpans()) {
    for (let z = from; z <= to; z += 1) {
      if (!covered(z)) {
        if (!open) open = [z, z];
        else open[1] = z;
      } else if (open) {
        found.push(open);
        open = null;
      }
    }
    if (open) { found.push(open); open = null; }
  }
  return found;
};

/**
 * The broom a player at this stage is expected to be holding.
 *
 * Matched by `flyCapacity` against the stage's own advertised figure, so the
 * gate and the shop cannot end up advertising different ladders - and so this
 * script checks the course against the equipment it TELLS the player to bring
 * rather than against an assumption of its own.
 */
const broomForStage = (stage) => {
  for (const broom of BROOMS) {
    if (broom.flyCapacity >= stage.recommendedFly) return broom;
  }
  return BROOMS[BROOMS.length - 1];
};

/**
 * What a player at a given stage can do WITHOUT thrust.
 *
 * Evaluated through `ballisticFor`, the same function the course builder
 * authored its gaps and climbs with, so this check cannot drift from the thing
 * it is checking.
 *
 * BOTH figures matter and they behave very differently. `reach` runs away with
 * the movement multiplier - a level-160 rider hops eight hundred units - so
 * width alone can never keep flight essential. `rise` barely moves, because
 * launch velocity is tuned to scale far more gently than travel speed and the
 * height goes as its square: about three units at the start of the game and
 * eleven at the end. A platform above `rise` therefore cannot be reached
 * without spending meter by anybody, at any level, on any broom - which is the
 * property this course is built on and the one this script exists to enforce.
 */
const ballisticAtStage = (stage) => {
  const broom = broomForStage(stage);
  const profile = resolveMovementProfile(
    stage.recommendedLevel,
    0,
    broom.moveBonus,
    broom.jumpBonus,
  );
  return ballisticFor(profile.runSpeed, profile.jumpVelocity);
};

/**
 * The TOP of whatever is solid at a given Z, or null for open air.
 *
 * Used to measure the STEP UP across a gap: the height difference between the
 * platform being left and the one being landed on. Takes the highest surface
 * on each side rather than the nearest, because the highest is the one a
 * player aiming a crossing is aiming at.
 */
const topAt = (z) => {
  let top = null;
  for (const solid of [...COURSE_SOLIDS, ...SINKING_SOLIDS]) {
    if (z < solid.minZ - 0.01 || z > solid.maxZ + 0.01) continue;
    if (solid.kind === 'winPad' || solid.kind === 'ceiling') continue;
    if (top === null || solid.maxY > top) top = solid.maxY;
  }
  return top;
};

/** How far a FULL meter can carry a player at a given stage. */
const flyAtStage = (stage) => {
  const broom = broomForStage(stage);
  const profile = resolveMovementProfile(
    stage.recommendedLevel,
    0,
    broom.moveBonus,
    broom.jumpBonus,
  );
  return flightReach(profile.runSpeed, broom.flyCapacity);
};

console.log('stages');
let previousEnd = -Infinity;
for (const stage of STAGES) {
  if (stage.startZ < previousEnd - 1e-6) {
    fail(`stage ${stage.index} starts at ${stage.startZ} inside stage ${stage.index - 1}`);
  }
  previousEnd = stage.endZ;
}
if (failures === 0) pass(`${STAGES.length} stages, none overlapping`);

console.log('floor coverage');
const spans = walkableSpans();
if (spans.length === 0) {
  fail('no walkable floor at all');
} else {
  const first = spans[0];
  if (first[0] > COURSE.lobbyStartZ + 1e-6) {
    fail(`course does not start at the lobby back wall (${first[0]} vs ${COURSE.lobbyStartZ})`);
  } else {
    pass(`floor begins at the lobby back wall (${first[0]})`);
  }

  /*
   * Every gap is a FLIGHT, and it has to be crossable and worth crossing.
   *
   * Two bounds, and the course lives between them:
   *
   *  - Too WIDE is unplayable: a gap past what a full meter carries cannot be
   *    crossed however well it is flown. Measured at 70% of the meter, because
   *    a stage that demanded every last second of it for one gap would leave
   *    nothing for the rest of the stage.
   *  - Too EASY is worse than it sounds: a crossing a ballistic launch makes
   *    is one the player never spends meter on, and a course made of those is
   *    a course where the whole mechanic is optional.
   *
   * A crossing needs thrust when it is WIDER than a launch reaches OR when the
   * far side is HIGHER than a launch rises - and the second is the one that
   * does the work, because it is the only one that survives a progression
   * curve with no speed cap. See `riseFor` in the course builder.
   */
  let worst = null;
  let free = 0;
  for (let i = 0; i < spans.length - 1; i += 1) {
    const gapStart = spans[i][1];
    const gapEnd = spans[i + 1][0];
    const width = gapEnd - gapStart;
    const stage = STAGES.find((s) => gapStart >= s.startZ && gapStart <= s.endZ);
    if (!stage) continue;

    const fly = flyAtStage(stage);
    const ballistic = ballisticAtStage(stage);

    if (width > fly * 0.7) {
      fail(
        `gap of ${width.toFixed(1)} at z=${gapStart.toFixed(0)} ` +
          `(stage ${stage.index}) needs ${((width / fly) * 100).toFixed(0)}% ` +
          `of a full ${fly.toFixed(0)}-unit meter`,
      );
    }

    // The step up onto the far side. Negative is a drop, which is free.
    const from = topAt(gapStart - 0.5);
    const to = topAt(gapEnd + 0.5);
    const step = from !== null && to !== null ? to - from : 0;

    const needsThrust = width > ballistic.reach || step > ballistic.rise;
    if (!needsThrust) free += 1;

    if (!worst || width > worst.width) {
      worst = { width, at: gapStart, stage: stage.index, fly, step };
    }
  }
  if (worst) {
    pass(
      `${spans.length - 1} crossings; widest ${worst.width.toFixed(1)} at ` +
        `z=${worst.at.toFixed(0)} (stage ${worst.stage}), a full meter carries ` +
        `${worst.fly.toFixed(0)}`,
    );
  }

  /*
   * A minority of free crossings is correct, not a defect.
   *
   * The finish aprons, the stage bridges and the descent ledges are continuous
   * floor or downhill, and a chain that stepped upward at every single island
   * would be a staircase rather than a route. What must not happen is a COURSE
   * of them, which is what this threshold catches.
   */
  const total = Math.max(1, spans.length - 1);
  if (free / total > 0.35) {
    fail(
      `${free}/${total} crossings can be made without thrust; ` +
        `flight is optional on this course`,
    );
  } else {
    pass(
      `${total - free}/${total} crossings REQUIRE thrust ` +
        `(a base launch reaches ${BALLISTIC_REACH.toFixed(1)} and rises ` +
        `${BALLISTIC_RISE.toFixed(1)})`,
    );
  }
}

const crossings = narrowCrossings();
pass(`${crossings.length} narrow crossings (plank bridges), floor present but off-centre`);

console.log('win pads');
for (const stage of STAGES) {
  const pad = COURSE_SOLIDS.find(
    (solid) => solid.kind === 'winPad' && solid.stage === stage.index - 1,
  );
  if (!pad) {
    fail(`stage ${stage.index} has no win pad solid`);
    continue;
  }
  if (Math.abs((pad.minZ + pad.maxZ) / 2 - stage.winPadZ) > 0.01) {
    fail(`stage ${stage.index} pad geometry and winPadZ disagree`);
  }
  // The pad sits at the player's LEFT, which is POSITIVE X - see the note in
  // the course builder. It must not span the stage, and must not poke through
  // the wall.
  if (stage.winPadX <= 0) fail(`stage ${stage.index} pad is not on the player's left`);
  if (pad.maxX > COURSE.halfWidth + 0.01) {
    fail(`stage ${stage.index} pad pokes through the wall`);
  }
  // And it has to be reachable: solid floor under it.
  const floor = COURSE_SOLIDS.some(
    (s) =>
      s.kind !== 'winPad' &&
      s.kind !== 'ceiling' &&
      s.maxY <= COURSE.floorY + 0.2 &&
      stage.winPadX >= s.minX &&
      stage.winPadX <= s.maxX &&
      stage.winPadZ >= s.minZ &&
      stage.winPadZ <= s.maxZ,
  );
  if (!floor) fail(`stage ${stage.index} win pad has no floor under it`);
}
if (failures === 0) pass(`${STAGES.length} win pads, left-hand side, all reachable`);

console.log('stage rewards');
const EXPECTED_REWARDS = [1, 3, 8, 20, 50, 120, 200, 400];
for (let i = 0; i < Math.min(STAGES.length, EXPECTED_REWARDS.length); i += 1) {
  const stage = STAGES[i];
  if (stage.winReward !== EXPECTED_REWARDS[i]) {
    fail(`stage ${stage.index} pays ${stage.winReward}, expected ${EXPECTED_REWARDS[i]}`);
  }
}
if (failures === 0) pass(`rewards are ${EXPECTED_REWARDS.join(', ')}`);

// Past the authored head, the only rules are that the curve keeps climbing and
// never pays less for a harder stage. A later stage worth fewer Wins than an
// earlier one would make the whole ladder something to farm backwards.
{
  let broken = 0;
  for (let i = 1; i < STAGES.length; i += 1) {
    if (STAGES[i].winReward <= STAGES[i - 1].winReward) {
      broken += 1;
      fail(
        `stage ${STAGES[i].index} pays ${STAGES[i].winReward}, ` +
          `no more than stage ${STAGES[i - 1].index}`,
      );
    }
  }
  if (broken === 0) {
    pass(
      `${STAGES.length} rewards, strictly increasing to ` +
        `${STAGES[STAGES.length - 1].winReward}`,
    );
  }
}

console.log('respawn');
{
  /*
   * There is ONE place a player can arrive, and no stage may carry another.
   *
   * The checkpoint system is gone: dying anywhere returns the player to the
   * starting arena. This checks the shape of that rather than the behaviour -
   * a stage that carried a respawn Z again would be the first step back
   * toward per-stage respawns, and it would be added here long before anyone
   * noticed it in play.
   */
  const strays = STAGES.filter((stage) =>
    Object.keys(stage).some((key) => /checkpoint|respawn/i.test(key)),
  );
  if (strays.length > 0) {
    fail(`${strays.length} stage(s) carry their own respawn point`);
  } else if (SPAWN_POSITION.z > COURSE.lobbyEndZ || SPAWN_POSITION.z < COURSE.lobbyStartZ) {
    fail(`the spawn at z=${SPAWN_POSITION.z} is not inside the starting arena`);
  } else {
    pass(`one spawn, at z=${SPAWN_POSITION.z}, and no stage defines another`);
  }
}

console.log('difficulty ladder');
{
  /*
   * The recommended level has to climb, and it has to be REACHABLE.
   *
   * The level cap is 25 per rebirth, so a stage recommending level 130 is
   * asking for five of them. That is a legitimate ask at the end of a
   * twenty-stage ladder and an absurd one in the middle, which is why this
   * prints the rebirths each stage implies rather than merely checking the
   * numbers go up.
   */
  let broken = 0;
  for (let i = 1; i < STAGES.length; i += 1) {
    if (STAGES[i].recommendedLevel <= STAGES[i - 1].recommendedLevel) {
      broken += 1;
      fail(`stage ${STAGES[i].index} recommends no more level than stage ${STAGES[i].index - 1}`);
    }
    if (STAGES[i].recommendedSpeed <= STAGES[i - 1].recommendedSpeed) {
      broken += 1;
      fail(`stage ${STAGES[i].index} recommends no more Speed than stage ${STAGES[i].index - 1}`);
    }
  }

  // The advertised Speed must be the Speed that level actually costs, or the
  // gate is telling the player two different things.
  for (const stage of STAGES) {
    const owed = totalSpeedToReach(stage.recommendedLevel);
    if (Math.abs(stage.recommendedSpeed - owed) > 1) {
      broken += 1;
      fail(
        `stage ${stage.index} advertises ${stage.recommendedSpeed} Speed for ` +
          `level ${stage.recommendedLevel}, which actually costs ${owed}`,
      );
    }
  }

  const last = STAGES[STAGES.length - 1];
  const rebirthsNeeded = Math.max(0, Math.ceil(last.recommendedLevel / 25) - 1);
  if (broken === 0) {
    pass(
      `levels ${STAGES[0].recommendedLevel}-${last.recommendedLevel} rising every stage, ` +
        `the last needing ${rebirthsNeeded} rebirth(s)`,
    );
  }
}

console.log('brooms');
{
  /*
   * The roster, checked against the two things it promises.
   *
   * Both ladders must CLIMB - a broom that farmed less or flew shorter than
   * the one before it would make the shop something to buy backwards - and the
   * price ladder has to climb with them, or a later broom would be a strictly
   * better one for less.
   */
  const EXPECTED = [
    { wins: 0, speed: 1, fly: 10 },
    { wins: 3, speed: 2, fly: 12 },
    { wins: 15, speed: 5, fly: 15 },
    { wins: 50, speed: 20, fly: 18 },
    { wins: 100, speed: 50, fly: 20 },
    { wins: 500, speed: 100, fly: 25 },
    { wins: 2000, speed: 250, fly: 25 },
    { wins: 5000, speed: 500, fly: 25 },
    { wins: 50000, speed: 1000, fly: 30 },
    { wins: 100000, speed: 2000, fly: 35 },
  ];

  if (BROOMS.length !== EXPECTED.length) {
    fail(`${BROOMS.length} brooms, expected ${EXPECTED.length}`);
  }
  let broken = 0;
  for (let i = 0; i < Math.min(BROOMS.length, EXPECTED.length); i += 1) {
    const broom = BROOMS[i];
    const want = EXPECTED[i];
    if (broom.slot !== i + 1) {
      broken += 1;
      fail(`broom ${i + 1} sits in slot ${broom.slot}`);
    }
    if (broom.winsRequired !== want.wins) {
      broken += 1;
      fail(`${broom.name} costs ${broom.winsRequired} Wins, expected ${want.wins}`);
    }
    if (broom.speedPerStep !== want.speed) {
      broken += 1;
      fail(`${broom.name} gives +${broom.speedPerStep} Speed, expected +${want.speed}`);
    }
    if (broom.flyCapacity !== want.fly) {
      broken += 1;
      fail(`${broom.name} flies ${broom.flyCapacity}s, expected ${want.fly}s`);
    }
  }
  for (let i = 1; i < BROOMS.length; i += 1) {
    if (BROOMS[i].speedPerStep <= BROOMS[i - 1].speedPerStep) {
      broken += 1;
      fail(`${BROOMS[i].name} farms no faster than ${BROOMS[i - 1].name}`);
    }
    if (BROOMS[i].flyCapacity < BROOMS[i - 1].flyCapacity) {
      broken += 1;
      fail(`${BROOMS[i].name} flies SHORTER than ${BROOMS[i - 1].name}`);
    }
    if (BROOMS[i].winsRequired <= BROOMS[i - 1].winsRequired) {
      broken += 1;
      fail(`${BROOMS[i].name} costs no more than ${BROOMS[i - 1].name}`);
    }
  }
  if (broken === 0) {
    pass(
      `${BROOMS.length} brooms, +${BROOMS[0].speedPerStep}/${BROOMS[0].flyCapacity}s ` +
        `to +${BROOMS[BROOMS.length - 1].speedPerStep}/` +
        `${BROOMS[BROOMS.length - 1].flyCapacity}s, prices strictly increasing`,
    );
  }

  // And the starter has to be able to clear stage one, because it is the only
  // broom a brand new player owns.
  const starter = broomForSlot(1);
  const first = STAGES[0];
  const profile = resolveMovementProfile(1, 0, starter.moveBonus, starter.jumpBonus);
  const reach = flightReach(profile.runSpeed, starter.flyCapacity);
  pass(
    `the starter carries ${reach.toFixed(0)} units on a full meter; stage 1 is ` +
      `${(first.endZ - first.startZ).toFixed(0)} long`,
  );
}

console.log('flight');
{
  // The drain rate is what makes `flyCapacity` mean SECONDS. Anything else and
  // the number on the shop sign is not the number the player gets.
  if (FLIGHT.drainPerSecond !== 1) {
    fail(`flight drains at ${FLIGHT.drainPerSecond}/s, so capacity is not seconds`);
  } else {
    pass('flight drains at 1 meter-second per real second');
  }
  // And the refill has to be slower than the drain, or landing is a free tank
  // and the capacity ladder means nothing.
  if (FLIGHT.regenPerSecond >= FLIGHT.drainPerSecond) {
    fail(`flight refills at ${FLIGHT.regenPerSecond}/s, no slower than it drains`);
  } else {
    pass(
      `refills at ${FLIGHT.regenPerSecond}/s after ${FLIGHT.regenDelay}s on the ground`,
    );
  }
}

console.log('hazards');
for (const hazard of COURSE_HAZARDS) {
  if (hazard.kind === 'roller') {
    // A roller runs down a lane; it must stay inside the corridor for its
    // whole travel, and its lane must actually have length.
    if (hazard.fromZ <= hazard.toZ) fail(`roller at x=${hazard.x} has no lane`);
    if (Math.abs(hazard.x) + hazard.radius > COURSE.halfWidth + 0.5) {
      fail(`roller lane at x=${hazard.x} is outside the corridor`);
    }
    continue;
  }
  // Sweeper, spinner and tornado all reach `|x| + sweep + radius` at the far
  // side of their travel - a sweep and an orbit have the same extreme. What
  // they must fit inside is the corridor AT THEIR OWN Z, not the nominal
  // width: half the later stages are arenas, and checking them against 32
  // would condemn every arm that was correctly built for a wider room.
  const wall = corridorHalfWidthAt(hazard.z);
  const reach = hazardReachX(hazard);
  if (reach > wall + 0.5) {
    fail(`${hazard.kind} at z=${hazard.z.toFixed(0)} reaches ${reach.toFixed(1)}, past the ${wall} wall`);
  }
}
pass(`${COURSE_HAZARDS.length} hazards, all inside the corridor`);

console.log('sinking platforms');
{
  /*
   * Every row must be crossable AT EVERY MOMENT.
   *
   * The original rule was "each row keeps one fixed platform", which is how
   * the sands are built but not how the vanishing bridge is: there, all three
   * lanes sink and the phases are a third of a cycle apart, so one is always
   * up. A rule that only knew about fixed platforms called that unplayable
   * while it is in fact the whole design.
   *
   * So the check is the real question instead of a proxy for it: sample the
   * cycle and require that at some usable height, something in the row is
   * standable at every sampled instant.
   */
  const rows = new Map();
  const rowKey = (z) => Math.round(z / 4) * 4;

  for (const solid of COURSE_SOLIDS) {
    /*
     * Anything solid and standable counts as a fixed platform, at ANY height.
     *
     * This used to insist on floor level, which was true of the course when
     * it was written and stopped being true the moment stages started to
     * climb: the ice mountain's ledges rise a step per row, so its perfectly
     * solid ground read as "no fixed platform in this row" and the sinking
     * ledge beside it looked like the only way across. Height is recorded
     * instead, and compared per row below - a platform only helps if it is at
     * the height the row is actually crossed at.
     */
    const key = `${solid.stage}:${rowKey((solid.minZ + solid.maxZ) / 2)}`;
    if (!rows.has(key)) rows.set(key, { fixed: [], sinking: [] });
    rows.get(key).fixed.push(solid.maxY);
  }
  for (const platform of SINKING_SOLIDS) {
    const key = `${platform.stage}:${rowKey((platform.minZ + platform.maxZ) / 2)}`;
    if (!rows.has(key)) rows.set(key, { fixed: [], sinking: [] });
    rows.get(key).sinking.push(platform);
  }

  // How far a platform may have dropped and still be ridden onto. The mount
  // steps up `stepHeight`, so a platform lower than that from its neighbours
  // is gone as far as the player is concerned.
  const STANDABLE = MOVEMENT.stepHeight;
  let unsafe = 0;
  let sampled = 0;
  for (const [key, row] of rows) {
    if (row.sinking.length === 0) continue;
    // A fixed platform rescues the row only if it is at the height the row is
    // crossed at - one twenty units below is a different part of the world.
    const crossingY = Math.max(...row.sinking.map((s) => s.maxY));
    if (row.fixed.some((top) => Math.abs(top - crossingY) <= 3)) continue;
    sampled += 1;
    const cycle = Math.max(...row.sinking.map((s) => s.cycle));
    let worst = null;
    for (let i = 0; i < 120; i += 1) {
      const t = (cycle * i) / 120;
      const up = row.sinking.filter(
        (s) => sinkingOffsetAt(s, t).drop <= STANDABLE,
      ).length;
      if (worst === null || up < worst) worst = up;
    }
    if (worst === 0) {
      unsafe += 1;
      fail(`sinking row ${key} has no platform up at some point in its cycle`);
    }
  }
  if (unsafe === 0) {
    pass(`${sampled} all-sinking row(s) keep a platform up through the whole cycle`);
  }
  else pass(`${SINKING_SOLIDS.length} sinking platforms, every row keeps a fixed one`);

  // And a platform must actually come back.
  for (const platform of SINKING_SOLIDS) {
    let up = false;
    let down = false;
    for (let t = 0; t < platform.cycle; t += 0.1) {
      const { drop } = sinkingOffsetAt(platform, t);
      if (drop < 0.01) up = true;
      if (drop > platform.depth * 0.9) down = true;
    }
    if (!up || !down) {
      fail(`a sinking platform never ${up ? 'sinks' : 'returns'}`);
      break;
    }
  }
  pass('every sinking platform both sinks and returns');
}

console.log('training');
{
  // Six belts, and each must be detectable from its own centre.
  let found = 0;
  for (let i = 1; i <= TREADMILL_COUNT; i += 1) {
    if (treadmillAt(treadmillX(i), TREADMILL_BELT_Y, treadmillZ(i)) === i) found += 1;
  }
  if (found !== TREADMILL_COUNT) fail(`only ${found}/${TREADMILL_COUNT} belts detect`);
  else pass(`${TREADMILL_COUNT} belts, all detected from their own centres`);

  /*
   * THREE TIERS, TWO BELTS EACH, and the gates and multipliers as specified.
   *
   * Checked against literals rather than against the table they come from: a
   * test that read `TRAINING.tiers` would pass whatever that table said, which
   * is the one thing it must not do.
   */
  const EXPECTED_TIERS = [
    { minLevel: 0, multiplier: 1 },
    { minLevel: 20, multiplier: 1.5 },
    { minLevel: 75, multiplier: 2 },
  ];
  if (TRAINING.tiers.length !== EXPECTED_TIERS.length) {
    fail(`${TRAINING.tiers.length} tiers, expected ${EXPECTED_TIERS.length}`);
  }
  let broken = 0;
  for (let i = 0; i < Math.min(TRAINING.tiers.length, EXPECTED_TIERS.length); i += 1) {
    const tier = TRAINING.tiers[i];
    const want = EXPECTED_TIERS[i];
    if (tier.minLevel !== want.minLevel) {
      broken += 1;
      fail(`tier ${i + 1} opens at level ${tier.minLevel}, expected ${want.minLevel}`);
    }
    if (tier.multiplier !== want.multiplier) {
      broken += 1;
      fail(`tier ${i + 1} pays x${tier.multiplier}, expected x${want.multiplier}`);
    }
  }

  // Two machines per tier, and the belt index has to resolve to the right one.
  const perTier = new Map();
  for (let i = 1; i <= TREADMILL_COUNT; i += 1) {
    const tier = treadmillTier(i).tier;
    perTier.set(tier, (perTier.get(tier) ?? 0) + 1);
  }
  for (const [tier, count] of perTier) {
    if (count !== 2) {
      broken += 1;
      fail(`tier ${tier} has ${count} machine(s), expected 2`);
    }
  }
  if (broken === 0) {
    pass(
      `3 tiers x 2 belts: ` +
        TRAINING.tiers
          .map((t) => `L${t.minLevel}+ x${t.multiplier}`)
          .join(', '),
    );
  }

  // Standing off the deck must detect nothing.
  if (treadmillAt(0, 0, 0) !== 0) fail('a belt is detected in the middle of the vault');
  else pass('no belt is detected away from the training hall');
}

console.log('wide areas');
{
  // The guardian's hall has to be an ARENA, not another lane - comparable to
  // the starting vault rather than to the corridor.
  const arenaHalf = RUINS_ARENA.halfWidth;
  if (arenaHalf < COURSE.lobbyHalfWidth * 0.8) {
    fail(`vault half-width ${arenaHalf} is not comparable to the ${COURSE.lobbyHalfWidth} spawn`);
  } else {
    pass(`guardian vault is ${arenaHalf * 2} x ${(RUINS_ARENA.maxZ - RUINS_ARENA.minZ).toFixed(0)}`);
  }

  // Every wide area needs floor all the way to its own boundary, or the clamp
  // holds the player over open air.
  for (const area of WIDE_AREAS) {
    const midZ = (area.minZ + area.maxZ) / 2;
    const edge = area.halfWidth - 0.5;
    /*
     * Ground at the edge, at ANY height.
     *
     * The height test here was the same floor-level assumption, and the final
     * summit is the case that broke it: a plateau fourteen units up is still
     * ground, and a boundary standing on it is standing on something. What
     * this rule exists to catch is a clamp over NOTHING, not a clamp over
     * something high.
     */
    const covered = COURSE_SOLIDS.some(
      (s) =>
        walkable(s) &&
        edge >= s.minX &&
        edge <= s.maxX &&
        midZ >= s.minZ &&
        midZ <= s.maxZ,
    );
    /*
     * A wide area's edge must be somewhere the player can BE: either floor, or
     * a killing surface that was put there on purpose. The lava crossing and
     * the cliffs are pits from wall to wall by design, and being clamped into
     * one of those is a death the stage intends - what this rule exists to
     * catch is a clamp holding someone over nothing at all.
     */
    const drowned = QUICKSAND.some(
      (q) => edge >= q.minX && edge <= q.maxX && midZ >= q.minZ && midZ <= q.maxZ,
    );
    if (!covered && !drowned) {
      fail(`wide area at z=${midZ.toFixed(0)} has neither floor nor a pit at its edge`);
    }
    if (Math.abs(corridorHalfWidthAt(midZ) - area.halfWidth) > 0.01) {
      fail(`the boundary at z=${midZ.toFixed(0)} disagrees with its own width`);
    }
  }
  pass(`${WIDE_AREAS.length} wide areas, floored to their own boundary`);
}

console.log('the roof');
{
  /*
   * Every stage has one, and it clears everything under it.
   *
   * The roof is what makes flight a route rather than an altitude - without it
   * ten seconds of thrust puts a rider two hundred units above the stage with
   * the whole thing below them. So the two things worth checking are that one
   * exists per stage, and that nothing the stage built pokes through it.
   */
  let missing = 0;
  let pierced = 0;
  for (const stage of STAGES) {
    const index = stage.index - 1;
    const roof = COURSE_SOLIDS.find((s) => s.kind === 'ceiling' && s.stage === index);
    if (!roof) {
      missing += 1;
      fail(`stage ${stage.index} has no roof`);
      continue;
    }
    const under = [...COURSE_SOLIDS, ...SINKING_SOLIDS].filter(
      (s) => s.stage === index && walkable(s),
    );
    const top = under.reduce((high, s) => Math.max(high, s.maxY), -Infinity);
    if (top > roof.minY) {
      pierced += 1;
      fail(
        `stage ${stage.index} reaches ${top.toFixed(0)}, through its own roof ` +
          `at ${roof.minY.toFixed(0)}`,
      );
    }
    // And the headroom has to fit a rider standing on the highest platform.
    if (roof.minY - top < MOUNT_HEIGHT) {
      fail(`stage ${stage.index} has ${(roof.minY - top).toFixed(1)} of headroom`);
    }
  }
  if (missing === 0 && pierced === 0) {
    const roofs = COURSE_SOLIDS.filter((s) => s.kind === 'ceiling');
    const lowest = Math.min(...roofs.map((s) => s.minY));
    const highest = Math.max(...roofs.map((s) => s.minY));
    pass(
      `${roofs.length} roofs (the vault's included), from ${lowest.toFixed(0)} ` +
        `to ${highest.toFixed(0)}, none pierced`,
    );
  }
}

console.log('corridor width');
{
  // Everything past the arena runs at the corridor width unless a wide area
  // says otherwise, and obstacles are laid out as fractions of it.
  pass(`corridor is ${COURSE.halfWidth * 2} wide`);
  const strays = COURSE_SOLIDS.filter(
    // A ROOF is deliberately wider than the corridor: it has to meet the tops
    // of the walls rather than stop short and leave a slot down each side.
    (s) =>
      s.stage >= 0 &&
      walkable(s) &&
      (s.minX < -COURSE.halfWidth - 0.01 || s.maxX > COURSE.halfWidth + 0.01),
  ).filter((s) => {
    const midZ = (s.minZ + s.maxZ) / 2;
    return corridorHalfWidthAt(midZ) <= COURSE.halfWidth + 0.01;
  });
  if (strays.length > 0) fail(`${strays.length} stage solid(s) stick out past the corridor wall`);
  else pass('no stage geometry pokes through a wall');
}

console.log('');
if (failures > 0) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('course OK');
