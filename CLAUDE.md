# CLAUDE.md — +1 Speed Broom Escape

Permanent project rules and design constraints. Read this before changing anything.

## What this is

A **production** browser multiplayer obby game, and the next game in the same
series as `+1 Backflip Obby Escape` and `+1 Speed Animal Escape`. Not a demo,
not a prototype. "Roblox-inspired" describes the **visual and gameplay style
only**.

The one gameplay difference from the previous game: the player does not ride an
animal, they **ride a magical broom**, and the broom **flies**. The broom
replaces the animal as the movement vehicle, the progression ladder and the
thing on screen — and it adds the mechanic the whole course is authored
around, a **finite flight meter**.

## Technology (fixed)

| Layer  | Stack                                   |
| ------ | --------------------------------------- |
| Client | Three.js + TypeScript + Vite            |
| Server | Colyseus + Node.js + TypeScript         |
| Shared | TypeScript, framework-free              |
| Target | Browser / WebGL, desktop **and** mobile |
| Repo   | npm workspaces monorepo                 |

**Not used, ever:** Unity. Roblox Studio or the Roblox engine. Any other game
engine. Do not add a framework or a build tool without a concrete need.

## Hard constraints

- Final browser build must stay **under 12 MB**. It is currently ~2.9 MB, of which the
  background music track is 1.8 MB.
- **Progression and rewards are server-authoritative.** The client may predict
  for UI feel but never decides, computes or claims a reward. That includes the
  flight meter.
- Desktop and mobile browsers are both first-class. No desktop-only input
  assumptions.
- **Ports are not the defaults.** The two previous games in this series run on
  2567/5173 and 2568/5174 on the same machine. This game uses **2569** and
  **5175** so all three can run side by side; sharing a port means whichever
  server starts first silently serves both clients. The dev script passes
  `--port 2569` explicitly, because a dev harness that hosts the client often
  exports `PORT` for its own web server and the game server would otherwise
  bind to it.
- **ONE audio file: the background music, `assets/audio/background.mp3`.**
  Every sound EFFECT is still synthesised from oscillators - no sampled
  one-shots. The track is STREAMED (an `<audio>` element, never decoded into
  a buffer), looped, started once from the first user gesture by
  `startMusic`, and routed through `musicBus`, so the portal's music and
  master sliders and the in-game mute all apply to it. Mute PAUSES it.

## Flight — the mechanic this game is

Everything else in this file follows from this section.

- **Space is the ONLY action key, and it is THRUST, held.** A broom does not
  hop. There is no jump. Holding the key launches off the ground and then
  flies; releasing it does nothing at all. It is a LEVEL on the wire, not an
  edge — an edge would let go of the thrust the frame after it began.
- Every number lives in `shared/src/config/flight.ts`. `FLIGHT.drainPerSecond`
  is **1 and must stay 1**: `flyCapacity` is authored as SECONDS OF FLIGHT on
  the shop sign, and any other rate makes the number the player is sold differ
  from the number they get. `verify:course` asserts this.
- **The meter is billed inside `stepPlayer`**, in the same step that produced
  the climb it paid for. That is the whole anti-cheat story: there is no moment
  at which a client could have climbed without being billed, and no message
  anywhere carries a meter reading.
- The meter **refills only on the ground, only after `regenDelay`, and only
  with the key RELEASED**, at well under the drain rate. The released-key
  condition is not pedantry: without it a broom on an empty tank refills just
  past `launchCost`, spends it on a launch, falls back and refills again, and
  the player stutters half a unit into the air several times a second instead
  of resting. Recovering the meter is a deliberate act — land AND let go.
- Thrust does not cancel gravity, it **fights** it (`gravityScale`). A rider
  who stops pressing sinks on the same frame. Cancelling gravity would make a
  hover free and the whole meter cosmetic.
- The climb is **capped** (`maxRise`) and the dungeon has a **roof**, so
  holding thrust is not an altitude cheat. See "The roof" below.
- `flying` is **replicated**, and it is the one animation signal that could not
  be derived from the transform: a broom thrown up by a launch and a broom
  climbing under power have the same vertical velocity, and only the server
  knows which is spending meter.
- Reconciliation restores `flyRemaining` and `flying` along with the transform.
  Replay re-runs `stepPlayer`, which READS the meter to decide whether a held
  key buys anything; restoring position but not the meter makes replay spend
  flight the server already refused.

## Why the course cannot be trivialised

This is the single most important design fact in the repo.

- A ballistic launch has a **reach** and a **rise**, and they scale completely
  differently. Reach runs away with the movement multiplier — a level-160 rider
  hops eight hundred units — so **width alone can never keep flight essential**.
  Rise barely moves: launch velocity is deliberately tuned to scale far more
  gently than travel speed, and the height goes as its SQUARE over a fixed
  gravity, which works out at about 3 units at the start of the game and 11 at
  the end.
- Therefore **ELEVATION is the gate and width is the texture**. `riseFor` puts
  every platform above what a launch can reach at the level its stage is built
  for; `gapFor` decides how committing the crossing feels. A chain that stepped
  DOWN every fourth island — which is how the first version got its rhythm —
  made every fourth gap free, and that is the bug this rule exists to prevent.
- `verify:course` enforces it: a crossing counts as requiring thrust when it is
  wider than a launch reaches **or** the far side is higher than a launch
  rises, and more than 35% free crossings fails the build. It currently runs at
  151 of 169.
- Do not "fix" a hard stage by narrowing gaps, and never by lowering a climb.

## The roof

- **Every stage has a ceiling**, laid at that stage's own tallest platform plus
  `CEILING_CLEARANCE`. Per stage rather than one flat slab: a corridor stage
  tops out at seven units and the spire at a hundred and ninety, and a roof
  high enough for the spire is no roof at all over the corridor.
- It exists for gameplay first and theme second. Without it, ten seconds of
  thrust puts a rider two hundred units up with the whole stage below them and
  nothing in between — which no amount of gap tuning can answer.
- It is measured from what the stage **actually built**, read back out of the
  arrays after the builder ran, for the same reason a stage's LENGTH comes from
  the build cursor: a figure every builder had to remember to report is one
  that eventually goes unreported.
- It is never stood on and never bumped into sideways — `resolveAxis` skips any
  solid whose underside is above the rider's head and `surfaceYAt` only offers
  surfaces within a step of the feet. Its only role is to be what
  `resolveCeiling` stops a climb against. Ceilings are excluded from every
  floor-coverage check in `verify:course`, because a roof spans its whole stage
  and counting it would merge every gap in that stage into one span.

## Rebirth, trails and training

- The prestige ladder is called **REBIRTH**, everywhere. Do not reintroduce the
  name "Reboot".
- `REBIRTH_TIERS` is the authored head (level 25 -> x2, level 50 -> x3) and
  `EXTENSION` continues the same pattern for ever.
- The level CAP is not a constant: it is whatever the next rebirth requires, so
  reaching the cap and unlocking a rebirth are the same moment.
- A rebirth resets the level curve — which means clearing `totalSpeed`, because
  level FOLLOWS from it — and deliberately keeps Wins, brooms and trails. It
  also returns the player to the vault.
- **Trails** multiply ACTUAL MOVEMENT SPEED through the shared formula's
  `extraMultiplier` and never a calculation of their own.
- **Treadmills are a LADDER in this game, unlike the previous one's identical
  belts.** Three tiers of two machines: level 0+ at x1, level 20+ at x1.5,
  level 75+ at x2. Two per tier is deliberate — a tier a player has unlocked
  should never be something to queue for, and one belt per tier in a
  fifteen-player room would be exactly that.
- The tier gate is checked in **`SpeedService`, with the payment**, and nowhere
  else. A belt is a PLACE — `treadmillAt` derives it from position on both
  sides every step and says nothing about whether the player earned it — so
  folding the gate into that would mean a locked machine the animator also
  refused to run and a player standing on a moving belt that claimed they were
  not on one. Below the requirement a belt pays **nothing**, not a reduced rate.
- Tier 3's level 75 needs **two rebirths**, because the cap is 25 a rebirth.
  That is a real fact about the ladder, not a quirk.
- A runner earns from the BELT: distance is `beltSpeed x step` instead of a
  position delta, fed through the same per-stride formula.

## Core game design

**The mount**

- The player rides a broom. The BROOM is the movement character: the
  simulation's transform, the collision body and the physics all belong to it.
  The rider is carried and has no transform of their own on the wire.
- **`BROOM_RIDE_HEIGHT` is why the broom hovers.** `motion.y` is the GROUND
  CONTACT LINE — what a platform's top is compared against — and a broom does
  not touch the ground with it. The model is lifted by this once, at build
  time, on the `scaled` node; `MOUNT_HEIGHT` is derived from it. Without it the
  broom sits in the floor and the rider's legs are under it.
- The rider is parented to the broom's **body node**, so it inherits the bob,
  the bank and — the one that matters here — the **nose-up climb**. A rider
  parented anywhere else stays level while the broom under them tilts, which is
  exactly how a flying character comes out looking pasted on.
- **The rider's walking animation never plays.** The locomotion cycle does not
  exist on the rider's side at all.
- Swapping brooms rebuilds only the broom half.

**Movement**

- **The MOUSE aims the camera; the camera defines forward.** WASD moves
  relative to it and never rotates it.
- The camera's RIGHT is `(-cos yaw, sin yaw)`. At yaw 0 that is world **-X**.
- **The player's LEFT is +X and their RIGHT is -X.** Every "left" and "right"
  in the world layout means the PLAYER's. The broom shop is at +44 and the win
  pads are at +21 — both on the player's LEFT, as specified.
- **`LANDING_TOLERANCE` and `MOVEMENT.stepHeight` are the same number, and must
  stay that way.**
- **There is no speed cap, and there must not be one.** `stepPlayer`
  SUBDIVIDES its own step until no substep travels further than
  `MOVEMENT.maxSubstepDistance`.
- Horizontal collision is **axis-separated**: move X, resolve, move Z, resolve,
  then move Y.
- A solid only blocks when its top is more than `MOVEMENT.stepHeight` above the
  feet AND its underside is below the rider's head.
- Steering authority has **three** states, not two: grounded, falling, and
  FLYING. A broom under thrust steers nearly as well as on the floor
  (`FLIGHT.airControl`) — that is what makes flight a route rather than a
  longer fall — while a rider who has run dry is left with ordinary air control
  and has to live with the line they committed to.

**Progression**

- **Speed** is the currency, farmed by riding: distance the SERVER observes,
  plus a bonus each time the broom leaves the ground.
- Level follows from lifetime Speed through `resolveLevel`, and drives actual
  movement speed.
- **Brooms** set Speed gained per stride AND flight capacity, and are bought
  with stage Wins by riding onto the stand while holding enough. Wins are SPENT
  and the highest tier OWNED is always equipped.
- The roster is exactly as specified and `verify:course` checks every row
  against literals:

  | Wins | Speed | Fly |
  | ---: | ----: | --: |
  | 0 | +1 | 10s |
  | 3 | +2 | 12s |
  | 15 | +5 | 15s |
  | 50 | +20 | 18s |
  | 100 | +50 | 20s |
  | 500 | +100 | 25s |
  | 2,000 | +250 | 25s |
  | 5,000 | +500 | 25s |
  | 50,000 | +1,000 | 30s |
  | 100,000 | +2,000 | 35s |

- The two ladders are deliberately **different shapes**. Speed runs away
  because income is what a long game is made of; flight barely moves — 10 to 35
  over the whole roster, with three brooms sharing 25 — because the course is
  designed around it, and a late broom must open routes an early one cannot
  reach WITHOUT making the course trivial to fly end to end.
- Swapping brooms raises the ceiling and leaves the reading where it is; a swap
  to a smaller one clamps it down. Filling the meter on a swap would make
  walking past a stand a free refuel.
- **THERE ARE NO CHECKPOINTS, and there must not be any.** Every placement puts
  the player at `SPAWN_POSITION`. `CourseRoom.placeAt` takes no position for
  exactly that reason.
- Every placement hands back a **FULL meter**, on both sides. The client's
  `teleport` and the server's `MovementService.teleport` must agree here, or
  the bar reads full and the server refuses the first thrust.
- **Wins** come from the win pad at the player's LEFT at each stage end.
  Crossing it awards that stage's Wins and RETURNS the player to the vault —
  which is what makes a second payment impossible, since the pad is hundreds of
  units behind them before another request could arrive. The cooldown is spam
  protection only.
- Stage rewards are 1, 3, 8, 20, 50, 120, 200, 400 and keep accelerating to
  5,000,000 at stage 30, in ONE table.
- **There are thirty stages.** Name, difficulty word, recommended level and
  recommended FLIGHT live in `STAGE_TUNING`, one row per stage.
- Recommended SPEED is DERIVED from the recommended level through
  `totalSpeedToReach`. Recommended FLIGHT is read off the broom roster. The
  gate advertises figures a player can go and buy.

**Multiplayer**

- Other players are **ghosted**: they do not collide. They render normally.
- Remote animation is DERIVED from authoritative state, never an event stream —
  except `flying`, which cannot be derived and is therefore replicated.
- **Never transmit bone transforms or broom part transforms.**

## Assets

- `assets/player/player.fbx` is the **canonical** player asset;
  `assets/player/base_rig.fbx` is byte-identical. Never modify either.
- The FBX embeds dead absolute texture paths; every request is remapped in
  `client/src/config/assets.ts` before it hits the network.
- The FBX has **no animation clips** — 12 bones, all animation procedural.
- The FBX declares two skin deformers, so `PlayerRig` binds the **first** bone
  of each name.
- **Not one image file is used for the WORLD.** Every world texture — the
  flagstones, the masonry, the timber, the rune slabs, the gold pads, the belts
  and the void — is drawn on a canvas at runtime by `WorldTextures`.
- **Every static file lives in the repo-level `assets/`**, which Vite publishes
  as the web ROOT, so `assets/ui/trophy.png` is served at `/ui/trophy.png`.
- The only images in the build are the rider FBX, its texture, and the **three**
  supplied HUD icons: `trophy`, `rebirth`, `trail`. There is no `run.png` in
  this game's asset set — the Speed popup borrows `trail.png`, and the favicon
  and boot logo use `trophy.png`. Never set both CSS dimensions on a supplied
  icon: drive one and leave the other automatic.
- `ImageBillboard` is how a supplied PNG is hung in the WORLD (the trophy over
  each win pad). It caches by URL — thirty pads share one decode — and drives
  HEIGHT while the width follows from the image.

## Brooms

- The roster is **pure data** in `shared/src/config/brooms.ts`. An eleventh
  broom is a new entry and nothing more: no movement code, no renderer branch,
  no server case statement. It gets a stand automatically.
- There is ONE generic broom builder. A school besom and a racing comet are the
  same dozen boxes at different sizes with different `features` bolted on.
- Geometry is **merged per moving part and cached per broom**, and colour lives
  in the VERTICES — so the roster renders with a single `MeshLambertMaterial`.
- The **glow** is a second geometry with its own emissive material. An
  enchantment drawn as a merely bright vertex colour reads as paint, and
  emissive on the whole model flattens the shaft into a slab of light.
  `setGlow` clones the material per instance — mutating the shared one would
  flare every broom in the room whenever anybody took off.

## Animation

Procedural, and required for the finished game — not a placeholder.

- `BroomAnimator` and `RiderAnimator` are the only animation state machines.
- They consume a read-only `AnimationInput` and write **only** to the broom's
  animated nodes and the rider's bones.
- **THERE ARE TWO FLIGHT ANIMATIONS and they are ONE POSE BLENDED, never two
  clips.** Riding is level with the nose a few degrees down at speed and the
  bundle streaming flat; ascending is the nose pitched well up, the bundle
  flared down and back, and the enchantment lit. `climb` is the blend, and it
  rises fast and falls slower on purpose — thrust should look like it took
  effect on the frame it was pressed, and letting go should look like settling.
- `climb` is the **only** thing that produces a nose-up attitude, so a nose-up
  broom always means "the meter is being spent" and never anything else.
- The broom hands the rider **its own climb blend** rather than the rider
  re-deriving one from `flying`: two eases off one boolean drift by a frame,
  and the frame they drift on is the takeoff everybody is looking at.
- The rider **leans FORWARD against** the broom's nose-up pitch. Going with it
  would read as being tipped backward off the seat; leaning in turns the same
  rotation into someone driving a climb.
- There is deliberately **no grounded/airborne branch** in the rider's pose. A
  rider astride a broom does not change what they are doing when the floor
  disappears, and a branch is somewhere for the pose to pop on the frame the
  broom left a ledge — which in this game is most frames.
- Sway phase advances with **distance**, not wall-clock time, and the cadence
  is CLAMPED (`GAIT.maxFrequency`).
- Rider poses are authored in **character space** and resolved onto each bone's
  baked local axes by `PlayerRig`. Splaying the legs to straddle the shaft has
  to be a YAW, not a roll.

## World

- The course is **generated, not authored**, from a pattern table in
  `shared/src/config/course.ts`. `COURSE_SOLIDS` and `COURSE_HAZARDS` are read
  by BOTH the renderer and the collision model.
- A stage's LENGTH and HEIGHT are not constants: they are whatever the patterns
  it drew came to, read back from the build cursor and the arrays.
- The first stage begins exactly at `lobbyEndZ`.
- Hazards and sinking platforms are **pure functions of time**. There is no
  hazard state on the wire.
- `pushIslandChain` is the primary pattern: suspended slabs over a pool, each
  one both further and HIGHER than the last. Every island is somewhere to LAND,
  and landing is how the meter comes back — so the pattern is self-pacing.
- The hazard vocabulary is `sweeper`, `roller`, `spinner`, `faller`, `tornado`
  and `spike`. A spike is STATIC: `hazardPositionAt` returns its authored
  position unchanged, which is the whole implementation, and it is why a spike
  bed costs the hazard system nothing it was not already paying.
- **Lethal MOVING things are LAVENDER, all of them.** A colour is a promise.
  Spikes are the one deliberate exception — a static field painted in the
  colour reserved for things that chase would make every moving hazard harder
  to pick out — so they get a GLOWING GOLD TIP on a steel shaft instead, which
  is the half that has to be visible from directly above. The tip cone must
  SHEATHE the shaft's upper half; a smaller one hides inside it.
- **Violet means "a thing the magic made"**, and it is shared by the rune
  slabs, the flight meter, the broom glows, the wall runes and the guardian's
  eyes — so a player learns in stage one that violet is where they land.
- `SurfaceRegion` changes how the broom HANDLES and is read inside `stepPlayer`
  itself, so prediction and simulation cannot handle differently.
- A pool carries a `surface` — lava, void or water. They kill identically; only
  the look differs.
- The corridor is **64 units wide** (`COURSE.halfWidth` 32), and every obstacle
  offset is a FRACTION of it through `lane()`.
- Places that open out are declared in **`WIDE_AREAS`**, and there is exactly
  one list.
- The walls are **scenery**. What holds the player in is
  `WorldCollision.clampToBounds`, applied after the substep has integrated.
- Solids are bucketed by Z.
- `texturedBox` scales UVs to WORLD size.
- World signs are **single-sided**; `ImageBillboard` is double-sided, because a
  trophy is near enough symmetrical and being visible from the far side of the
  pad is worth more than the purity.
- **Sign text is sized to FIT.** `CanvasSign` measures and shrinks until the
  glyphs AND their outline sit inside the panel. The fix for clipped text is
  never "make the text smaller".
- Each stage's gate is a LARGE sign reading `STAGE 1 ESCAPE`, `STAGE 2 SPIKE
  VAULT` and so on — the number and the name on ONE line — with difficulty,
  recommended level/Speed and recommended FLIGHT under it.
- Each win pad carries `+N WINS` over `RETURN`, with the supplied trophy above
  it and a brazier either side.
- **The guardian is the one exception, deliberately.** It CHASES, so the server
  simulates it and replicates x/z/yaw/charging. It owns the FLOOR of its vault;
  the raised rubble is out of its reach, which is what makes that stage reward
  arriving with a full meter.

## The look

**Bright Roblox game + colourful magical dungeon.** Not gothic, not horror.

- Every colour is in `client/src/config/worldVisuals.ts`. Surfaces are LIGHT —
  pale blue-violet stone, warm timber, gold trim — and dark values survive only
  as ACCENTS a player reads BY their darkness: the treadmill belts, a locked
  machine's frame, the scoreboard panels, the guardian. Do not reintroduce a
  near-black surface.
- **Six stage THEMES** (`THEMES`, `STAGE_THEMES`): enchanted stone, crystal
  cave, lava chamber, sky bridges, rune tower, floating isles, plus the vault.
  A theme is a PLACE and is reused, not one per stage. It colours ONLY the
  surfaces a stage is mostly made of — floor, stone, pillars, roof, walls and
  the wall cap — plus its decorative glow. Rune slabs, win pads, ice, timber,
  ruins, hazards and spikes keep ONE colour game-wide, because those colours
  are promises. A rune-tower floor leans BLUE for the same reason: a violet
  floor would hide the slabs.
- `themeAt(z)` decides the theme; walls are split at every stage start so each
  stage's walls wear their own.
- The roof is the walls' masonry, SELF-LIT: it is only ever seen from below,
  where the sun never reaches.
- **Lighting is a hemisphere, an ambient and one sun — no other real lights.**
  A light is a per-pixel cost on every material in the world. Everything that
  should look lit (lava, flames, crystals, rune slabs, win pads, wall caps,
  hazards, spike tips) is emissive or unlit instead. Shadows stay SOFT because
  the fill is strong, never because shadows are off.
- `DungeonDressing` is PURE SCENERY: banners and violet wall runes on the wall
  FACES (never more than 0.35 into the corridor), crystal clusters on the wall
  TOPS, carpets and the spawn rings flat on the vault floor, the entrance
  pilasters on the shoulder wall's face. Nothing it draws stands in the air a
  broom flies through looking like something to land on or hit, and nothing is
  in `COURSE_SOLIDS`. The drifting motes are the one thing in the air, and they
  are too small and too obviously light to be mistaken for a solid.
- Halos and motes are ONE Points draw each, additive, with a custom shader that
  FADES them with distance: an additive point tinted toward the fog colour
  would brighten the distance instead of disappearing into it.
- The vault is told apart by colour first: PURPLE and gold for the broom shop on
  the player's LEFT, CYAN for the training hall on the RIGHT, a royal-blue
  aisle from the spawn rings to the gold-and-cyan entrance. The back wall stays
  EMPTY for the boards.

## Architecture rules

- **No god files.** Logic belongs in its module: `net`, `player`, `input`,
  `rendering`, `camera`, `animation`, `broom`, `world`, `progression`, `config`.
- Gameplay tuning is **data-driven** and lives in `shared/src/config/*`.
- `shared/` must not import `three`, `colyseus`, or anything DOM.
- The client touches `colyseus.js` only inside `client/src/net/`.
- **Movement speed has exactly one EVALUATOR**: `resolveMovementProfile`.
- **Flight has exactly one EVALUATOR**: `applyFlight` inside `stepPlayer`.
- **Wins move in exactly one place**: `Wallet`.
- **Speed is granted in exactly one place**: `SpeedService`.
- **Deaths are decided on the server tick.**
- Persistence sits behind `Storage` (`server/src/persistence/`); see "Persistence".
- Only the DERIVING facts are persisted (Speed, Wins, owned brooms, rebirths,
  best stage). Level, movement speed, flight capacity and the equipped broom
  are recomputed on load through the same formulas a live session uses.

## UI

The HUD is: **Wins** upper centre, **Rebirth**, **Trails** and **Sound** down
the left rail, **Speed** and **Level** along the bottom, and the **FLIGHT
METER** beneath them at the very bottom edge.

- `hudStyles.ts` owns the one stylesheet and the icons.
- **The HUD is sized by ONE unit, `--u`**, defined in `hudStyles.ts`:
  `clamp(0.62px, min(0.1vw, 0.13dvh), 1.2px)` — 1px at the 770px-tall design
  size, following whichever viewport dimension is tighter, clamped at both
  ends. Every HUD size (tiles, borders, fonts, text-outline offsets, gaps,
  margins) is `N * var(--u)`, so the HUD scales and re-lays as ONE design on
  every resize with no script. Text gets a small `max(Npx, …)` floor for
  readability. **Never** add a per-device or `touch-mode` size override to
  one control — fix the unit. That is exactly the bug that made the rail
  fill a short landscape screen.
- **Anchors:** the rail is LEFT + VERTICAL CENTRE. The Speed/Level bar and
  the flight meter live in ONE bottom-centre flex column, `.aoe-dock-bottom`
  (built in `Game`), Speed first and the meter last — so they stack by
  layout and can never overlap, and neither positions itself. The dock is
  capped at 720u and keeps clear of the rail's footprint (`--hud-rail-reserve`)
  on BOTH sides so it stays centred.
- **The thumb controls publish what they occupy** (`TouchControls.ts`):
  `--hud-touch-clear` lifts the dock over them in portrait, and
  `--hud-touch-side` narrows it to fit between them in landscape — a hard
  limit that wins over the dock's 240px floor. The resting stick sits just
  right of the rail's footprint, so the two cannot collide on a short screen.
  The thumb controls themselves stay in `vmin` with pixel bounds: a thumb is a
  physical size.
- Everything shown is replicated server state, with **one deliberate
  exception**: the flight meter is drawn from the CLIENT's prediction. The
  server owns the meter and reconciles it twenty times a second, but this bar
  is read at the instant a key goes down, and a bar that only moved on a patch
  would lag the thrust it is reporting. The CAPACITY beside it is replicated,
  because what a broom holds is progression and progression is never predicted.
- The meter has three states, because the reading has to survive a glance:
  draining (brighter, lifted), low under a quarter (amber, pulsing — the
  warning must arrive BEFORE the commitment) and empty (says "LAND TO REFILL",
  because holding the key now does nothing and the bar is the only thing that
  explains why).
- The bottom of the screen is two stacked bars and the order is deliberate: the
  one watched during a crossing is nearest the thumb.
- `Panel` counts open modals; the input layer polls that count.
- **Speed-gain popups** are driven by an ACCUMULATOR over the replicated total.
- **Every menu must be reachable with a mouse.** `MouseLook.cursorFree` is a
  real state: Escape hands the cursor back and KEEPS it back.
- Keys: R Rebirth, T Trails, M mute, Escape to close — and **SPACE to fly**,
  which gets a key cap under the meter because it is the control the whole game
  is built on. The cap hides in touch mode, where the on-screen **FLY** button
  says the same thing.

## The scoreboard

Three world-space boards on the BACK WALL of the vault, which is what that wall
was deliberately left empty for. Every figure is the SERVER's; rebuilt on a
slow timer; the replicated arrays are FIXED-LENGTH and written in place.
Each row is `[Bloxity profile picture] Bloxity display name  value`, ranked by
PROFILE KEY (so two players sharing a name are two rows) - see "Player names".
Pictures are drawn by `AvatarThumbnails`, loaded `crossOrigin='anonymous'` so
a CORS-less picture fails to a silhouette instead of tainting the canvas.

## Audio

In `client/src/audio/`. Every sound EFFECT is synthesised; the one recorded
file is the background music (see Hard constraints).

- The **thrust loop** is the important one: a soft thud retriggered on a fixed
  CLOCK while the meter is being spent. A hoofbeat belonged to distance because
  it is a foot hitting the ground; thrust belongs to time because it is a broom
  pushing against the air, and the meter drains at the same rate either way.
- Takeoff is a rising sweep and **draining** is the exact inverse — a short
  falling sweep — because it is the exact inverse of the event, and the player
  needs to hear the tank empty without looking down at the bar.
- One-shots are bounded twice: a per-sound cooldown and a hard voice ceiling.
- **Only the LOCAL player makes noise.**
- Nothing starts before a real user gesture.
- `PlayerAudio` decides WHEN a sound is wanted; `AudioManager` knows HOW.
- Death, level and rebirth fire on the EDGE, never the level.

## Deployment

- **Two hosts, and the split is not negotiable.** Netlify serves static files;
  the Colyseus server runs as a long-lived Node process elsewhere.
- **`VITE_SERVER_URL` is the ONLY client-side server configuration**, baked in
  at build time.
- The URL fallback guesses ONLY on localhost.
- `NetworkClient` builds its Colyseus `Client` on CONNECT, not in its
  constructor.
- **A room holds `MAX_PLAYERS_PER_ROOM` (15).** The matchmaker locks a full
  room and `joinOrCreate` opens another, so the sixteenth player is ROUTED
  rather than refused. `onAuth` re-checks capacity at the door.
- **An empty room CLOSES ITSELF.** `autoDispose` is written out explicitly even
  though Colyseus defaults it to true, because it is a requirement of this game
  rather than an accident of the framework's defaults. `onDispose` writes every
  remaining player's progression out first, so disconnecting alone loses
  nothing.
- `/health` reports `{ ok, room, rooms, players }` — the matchmaker's own tally,
  not a second one kept beside it. That is what makes the room limit and the
  empty-room rule checkable from outside the process, and it is what
  `verify:capacity` asserts against.
- **Progress persists on Legion.** Legion injects `MONGODB_URI` and the
  server stores profiles and grants there; the JSON store is the dev fallback.
  Nothing may claim progress resets on redeploy or scale-to-zero.
- **This file owns shutdown**, not Colyseus: the `Server` is built with
  `gracefullyShutdown: false`, because Colyseus' own SIGTERM handler exits in
  its `finally` before the saves it just queued have landed. The order is
  `gracefullyShutdown(false)` (disposes rooms, queues saves) -> `storage.flush`
  -> `storage.close` -> exit.

## Persistence

`server/src/persistence/`. One variable picks the store: `MONGODB_URI` set ->
`MongoStorage`; unset -> `JsonStorage` in `BROOM_DATA_DIR`. There is no other
switch, and there are NO test switches in production code.

- **Per-key contract**: `get` / `put` / `insertIfAbsent` / `loadAll` /
  `flush`. `get` READS STORAGE and throws `StorageUnavailableError` when it
  cannot; it never answers "no profile" for "could not ask".
- **A profile is read at JOIN**, in `onAuth`, never from a boot cache: another
  pod may have written it since. `ProfileStore` is a LEADERBOARD cache only,
  refreshed every minute, newer `updatedAt` winning.
- **A failed read REFUSES the join** (`4503`). Admitting a blank profile would
  save a blank over the real one.
- **Writes never drop.** The latest snapshot per key is queued and written with
  an idempotent `updateOne($set, upsert)`, retried with backoff for ever.
  Nothing is ever `$unset` — this game has no field a session may clear; if
  one is added, `$unset` exactly that field and nothing else. Unknown fields
  are preserved, and the JSON store's loader keeps every field it reads.
- **The server boots with the database down**: `open` never throws, `/health`
  keeps answering, joins are refused until it is back.
- A legacy `profiles.json` in `BROOM_DATA_DIR` is imported into Mongo on EVERY
  boot with `$setOnInsert`, so it can never overwrite newer progress.
- The JSON store writes temp -> fsync -> rename, recovers a parseable leftover
  `.tmp`, and MOVES a corrupt file aside (`<file>.corrupt-<time>`) — never
  overwrites it.
- The Mongo driver is 6.x and must stay hoisted to the root `node_modules`
  (the Docker runtime copies only that tree).

**Keys** (`server/src/progression/Profiles.ts`)

- An account is `bloxity:<accountId>`, and the account id comes ONLY from
  Bloxity's verify reply. A guest is the id the browser keeps
  (`broomobby.playerId`). A browser id with the reserved `bloxity:` prefix is
  REJECTED at the door (`4003`).

**First login (`resolveAccount`)**

- The account WINS. If it already has progress, it is loaded and the guest is
  left alone.
- Otherwise the guest's progress — the LIVE state if the guest is mid-session
  — is `insertIfAbsent`-ed as the account with `migratedFrom`. Only after that
  insert succeeds is the guest marked `migratedTo`.
- A `migratedTo` guest is never restored, migrated again or ranked; the browser
  holding it is issued a fresh guest id (`GuestId` message).
- No empty migration: a guest with no progress migrates nothing.
- Losing the insert race to another pod means LOAD the winner, not retry.

**Signing in or out mid-session (`SetIdentity`)**

- Handled on the live session, one at a time; only the NEWEST request counts
  and later ones queue behind a switch in flight. The cooldown delays, it never
  drops.
- Autosave is blocked for the switch. The LEFT profile is saved from live
  state, the new one resolved and applied, `onJoin`'s initialisation re-run in
  the same order, grants re-applied, the player placed at spawn, and saved.
- A storage failure mid-switch leaves the player where they were.

**Bux grants — exactly once, across pods and restarts**

- A grant is stored with the transaction id as its unique key (`bux_grants`
  in Mongo, `grants.json` otherwise). The webhook answers 200 only once it is
  DURABLY recorded; 503 if storage cannot, so Bloxity refunds.
- A room CLAIMS a grant, skips it if the profile's `appliedGrants` already
  holds it, applies it, writes the profile durably, and only then marks the
  grant applied. A claim abandoned by a dead pod is reclaimable after
  `GRANT_CLAIM_TIMEOUT_MS`, and `appliedGrants` stops a double payment.

## Player names

**Every visible player name is the player's BLOXITY display name, and every
player picture is their Bloxity profile picture.** Name tags over riders, the
scoreboards, the portal's friend-joined toast - anywhere a player is named.
There is no identity system of this game's own, and there must not be one:
the generated `@Adjective_Noun_1234` handles (`handleFor`) are gone.

- **Never shown:** an `@username`, the account id, the profile key, the
  guest's browser id, a session id, or anything derived from them. Those stay
  internal, for networking and persistence.
- **Signed in:** the name (`displayName`, else `username` WITHOUT an `@`) and
  picture come from Bloxity's own token-verify reply - the same reply that
  proves the account id, and the same record the SDK shows the player. The
  server refreshes them whenever a token for that account is verified.
- **Guest:** the identity Bloxity's SDK mints (`auth.getGuest()`, e.g.
  "Comet42"), sent by the browser (`SetGuestProfile`, and at join). It is the
  one name the server takes on trust, so it must be GUEST-SHAPED
  (`isBloxityGuestName`) - a guest cannot call themselves "Chicken 877" - and
  its picture must be on Bloxity's thumbnail CDN. Otherwise: "Guest". It is
  kept while signed in and shown the moment the player signs out.
- `CourseRoom.applyDisplay` is the ONE place a player's shown name and
  picture are decided; they replicate as `PlayerState.displayName`/`pfp`,
  written only by the server.
- They are saved with the profile (`displayName`, `pfp`) purely so the boards
  can name OFFLINE players. Never read to identify anyone. A guest's name is
  NOT carried into an account on migration.
- `shared/src/config/playerNames.ts` holds the cleaning and validation, used by
  both halves. `NameTag` draws the tag over every rider - local and remote,
  one code path through `Mount.setName`.

## Bloxity

The cross-game portal: login, avatars, friends, synced settings and Bux.

- **`client/src/bloxity/Bloxity.ts` is the only file that touches
  `window.Legion`.** Every call is guarded; a missing SDK degrades to "no
  portal", never to a broken game.
- **ONE `onUserChanged`**, owned by `Bloxity`. The user object is never cached.
- **Bux are server-authoritative.** The client passes a SKU and NEVER a price,
  and it does NOT "grant the item locally" on a successful purchase, whatever
  the integration guide says: the Wins arrive as replicated state from the
  webhook a moment later. That is this game's one deliberate departure from
  the guide.
- **The server never believes a client about WHO it is.** A client sends its
  Bloxity JWT — in the join options (`bloxityToken`) and in `SetIdentity` on
  every mid-session login/logout — and `BloxityIdentity` verifies it with
  `POST /v1/auth/game-token/verify` scoped to the game slug, which is the same
  call the SDK uses to check its own token. Only the account id Bloxity
  answers with is bound. The room used to take `bloxityId` from the join
  options verbatim, and since `getFriends()` hands out account ids, any player
  could join as a friend and collect the Wins that friend had just paid for.
  `verify:identity` replays exactly that attack against a running server.
- The client sends the TOKEN, never an account id, and dedupes: a token
  already sent is not sent again.
- Verification is in `onAuth` and has **three outcomes**, and it FAILS CLOSED:
  only a 2xx carrying a valid string `_id` is `verified`.
  - `verified` — bound to `bloxity:<id>`. Cached by the token's SHA-256 for
    at most five minutes and never past the token's own `exp`.
  - `rejected` (any other 4xx) — a guest. Cached ~30 s.
  - `unavailable` (5xx, 429, 408, timeout, network, a 2xx without an id) — a
    guest FOR NOW, re-verified on a backoff (5 s -> 60 s) and upgraded in place
    when Bloxity answers. Never cached, and never a permanent demotion.
- **The Bloxity API host is a CONSTANT** (`VERIFY_URL` in
  `BloxityIdentity.ts`), not an env var: a configurable verifier is one an
  attacker can point at a server that says yes.
- `JWT_SECRET`, which Legion injects, is the GAME's own secret. It is NOT for
  verifying portal tokens locally — always ask Bloxity.
- `BLOXITY_GAME_SLUG` lives in `shared` because both halves must agree on it:
  the client inits the SDK with it and the server verifies tokens against it.
- The webhook is `POST /bloxity/bux`, verified against
  `BLOXITY_WEBHOOK_SECRET`. **2xx means Bloxity KEEPS the Bux; anything else
  refunds.** So it answers 200 for a purchase queued or a duplicate of one
  already fulfilled (a retry must never refund), and **422 for a SKU this
  build cannot fulfil**, so the player gets their Bux back. It used to answer
  200 there, which kept the Bux and granted nothing. An unknown SKU is refused
  before its transaction is marked seen, so a retry after a deploy that adds
  it is honoured. Fulfilment is DURABLE: see "Bux grants" under Persistence.
- **A Bux grant is bound to the account Bloxity names in the webhook**, never
  to anything a browser said.
- **Every SKU the in-game shop sells must be in `SKU_WINS`**, and
  `verify:bloxity` fails the build otherwise. The shop once listed
  `speed_boost_1h`, which nothing granted.
- **A player is drawn as their real Bloxity avatar, local and remote alike**;
  `player.glb` carries the same twelve bone names `PlayerRig` binds.
- `AvatarDresser` is the ONE thing that decides which body a rider has.
- **Bloxity's appearance is the source of truth, INCLUDING the Bloxity default
  avatar.** Nothing equipped means Bloxity's default body (`player.glb`, stock
  parts) in Bloxity's default skin (`skins/0.png`) - never this game's bundled
  `player.fbx` and its `green.png`. Every rider, local and remote, starts
  dressing as the Bloxity default at construction, so no rider depends on an
  avatar event arriving. The bundled character is a FALLBACK ONLY, shown while
  the Bloxity body loads or if it cannot be fetched; the dresser retries on a
  backoff and `BloxityRiderFactory` never caches a failed base-body load. The
  skin is applied AFTER each new body arrives (`rebind` then `apply`), and
  `BloxityAvatar.currentSkin` uses `undefined` for "nothing applied yet" so the
  DEFAULT skin (null) is still put on a freshly built body.
- The appearance is the ONE replicated field originating with a client, and it
  is safe because it decides nothing.
- `forceHeadId` is a head REPLACEMENT, not a hiding flag.
- A nested Colyseus schema does NOT bubble its changes, so `avatar` needs its
  own `onChange`.
- Proportions are written as SCALE and POSITION on bones, never rotation.

## Verification

Do not claim something works without running it.

- `npm run typecheck` must pass.
- `npm run verify` must pass — the course (holes, overlaps, the thrust
  requirement, the roof, the broom roster, the flight constants, the treadmill
  tiers), the hard-end barrier, and the server's reward/purchase/flight
  authority INCLUDING the rejection paths.
- `npm run verify:persistence` builds the server and runs it for real with
  ONLY Bloxity's verify URL stubbed (`scripts/persistence-stub.mjs`, preloaded
  with `node --import`). JSON store always; MongoDB with `MONGOD_BIN` (own
  mongod, outage tests) or `MONGODB_URI` (**wiped**). Not part of `verify`.
  On Windows it SIGKILLs servers, so it waits for writes before every kill.
- `npm run verify:capacity` needs a RUNNING server, which is why it is not part
  of `verify`. It asserts all three limits: no room over 15, the overflow
  routed rather than turned away, and every room closed once empty.
- `npm run verify:identity` also needs a running server, and the real Bloxity
  API behind it. It queues a purchase for a fake account through the webhook,
  then joins claiming that account's id, joins with a forged token, and logs
  in mid-session with one — and asserts none of them receives a single Win.
- `npm run size:client` after any asset change.
- Browser behaviour must be checked in a real browser.

**Two traps when driving the game from a console for a test.** The window
`blur` fired when the pane loses focus correctly clears every held key, so a
harness has to re-assert them each frame. And the server's `MAX_TIME_BUDGET_RATIO`
means a harness that calls `game.update` faster than real time has its inputs
REFUSED as over-budget — which is the anti-cheat working, not a bug. Drive the
simulation by hand to test physics; do not expect the server to follow.

## World layout

- A large starting vault (116 x 112): the **broom shop** down the player's LEFT
  wall (+X), open ground through the middle, the **training hall** on the RIGHT
  (-X), a deliberately EMPTY back wall for the boards, and a roof.
- The shop's display brooms HOVER and turn over their plinths. A flying vehicle
  parked on the floor would be the first thing in the shop to contradict what
  the game is about. Each stand's sign carries THREE lines — Speed, FLY and the
  price — because a player looking at the wall has to be able to see that the
  next broom does not merely farm faster, it crosses gaps the current one
  cannot.
- The training hall is six machines in three ranks of two, with one frame
  colour per tier (bronze, silver, gold) and a visibly dark frame on a tier the
  player has not unlocked. Each console prints its multiplier AND its
  requirement: "why is this one not paying me" is the worst question a farming
  area can provoke.
- Then thirty stages. 1-13 are authored by hand because each has its own idea;
  14-30 are generated from a six-pattern rotation, which is what proves the
  architecture extends.
  1. **Escape** — the tutorial, and it teaches by making the first gap
     unhoppable. A lava moat, five conjured slabs, and the first slab already
     above what a launch can climb.
  2. **Spike Vault** — floor all the way, none of it safe.
  3. **Crypt Slabs** — sinking slabs over lava, each row a step up. Every row
     keeps one up at every moment (phases a third of a cycle apart).
  4. **Chain Gallery** — censers swinging between islands over a void.
  5. **Guardian Vault** — a wide hall with the guardian, and a high route for a
     player who arrives with meter.
  6. **The Chasm** — one enormous gap with a single rune slab in the middle,
     and two cheaper side ledges. The stage is about pricing two routes.
  7. **Pillar Climb** — column tops rising faster than a launch can. The proof
     that the course does not trivialise at high level.
  8. **Crusher Span** — a narrow suspended walkway with masonry falling on it.
  9. **Lava Steppers** — diagonal crossings, so aiming costs meter.
  10. **Frost Ledges** — low grip, so a landing slides toward the far edge.
  11. **Gale Gallery** — a crosswind that acts in the AIR as well.
  12. **Spire Ascent** — a vertical shaft. Nothing here is crossed by going
      fast; the only axis that helps is the one only thrust reaches.
  13. **Rune Maze** — a guarded short way and a cheap long way.
- An orbiting hazard reaches `|centre| + radius + ball`, and that total has to
  fit the corridor AT ITS OWN Z. `verify-course` checks it.
- The world has a REAL bottom: a pit floor under everything.
- The sky is a gradient dome plus blocky clouds — real geometry. The dome
  FOLLOWS the camera and the cloud field is a TILE repeated along the run
  (`Sky.follow`, hooked on the dome's own draw). The course is ~12,000 units
  long; a dome fixed at the origin left every stage past the fifth under a flat
  background colour, because a back-faced sphere seen from outside draws
  nothing.

## Current milestone

The broom game is built: flight is server-authoritative and billed inside the
shared step, the ten-broom roster carries both ladders, the thirty-stage
dungeon is authored around elevation so flight cannot be outrun, the training
hall is three tiers of two, the win pads are on the player's left with the
supplied trophy over them, and the Bloxity integration carried over intact.

**Not built yet, and out of scope until the milestone advances:** powers, the free-reward chest, the buy-Speed buttons and the "2x Wins"
gamepass.
