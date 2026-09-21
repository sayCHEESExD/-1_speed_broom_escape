# +1 Speed Broom Escape

A browser multiplayer obby where you ride a magical broom through a dark
dungeon. **Hold Space to fly** — the broom has a finite flight meter, the
course is built out of gaps and climbs no hop can clear, and the whole game is
deciding when to spend it and when to land and let it refill.

Flying farms **Speed**, Speed raises your **Level**, Level makes you
permanently faster, and finishing a stage banks **Wins** you spend on a better
broom or a trail. A better broom farms faster *and flies longer*. Hit the level
cap and **Rebirth** for a permanent multiplier. Thirty stages, and dying on any
of them puts you straight back at the vault.

Three.js + Colyseus + TypeScript. No game engine, no audio files, almost no
image assets, and a browser build of about **1.2 MB** against a 12 MB budget.

---

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5175>.

`npm run dev` starts both halves: the authoritative Colyseus server on **2569**
and the Vite client on **5175**.

> These are deliberately not the default ports. The two previous games in this
> series use 2567/5173 and 2568/5174, so all three projects can run side by
> side on one machine.

### Controls

| Input              | Action                                        |
| ------------------ | --------------------------------------------- |
| **W A S D**        | Move, relative to the camera                  |
| **Space** *(hold)* | **FLY.** Launches, then climbs while you hold it — and drains the meter the whole time |
| **Shift**          | Cruise                                        |
| **Mouse**          | Aim the camera                                |
| **R** / **T**      | Rebirth / Trails                              |
| **M**              | Mute                                          |
| **Esc**            | Free the cursor; click to play on             |
| Touch stick / FLY  | The same, on a phone or tablet                |

There is no jump key. A broom does not hop: Space is thrust, it is held, and it
costs meter for as long as you hold it.

---

## The loop

1. **Fly.** Distance travelled and every takeoff earn Speed. The server
   measures it from the movement it simulates; the client cannot ask for any.
2. **Manage the meter.** Holding Space burns one second of meter per second.
   It only comes back while you are **on the ground with the key released**,
   and slower than it drains — so every gap is a decision, and every platform
   is somewhere to rest.
3. **Train.** Six treadmills in three tiers of two, on the right of the vault.
   Tier 1 pays x1 from level 0, tier 2 x1.5 from level 20, tier 3 x2 from
   level 75. Ride on to start, ride off to stop — no button, and it keeps
   paying while you are away from the keyboard. A tier you have not levelled
   into pays nothing, and its frame is visibly dark.
4. **Level up.** Speed drives the level curve, and level drives actual movement
   speed.
5. **Finish a stage.** Land on the glowing gold pad at the **left-hand** side
   of a stage end, under the trophy. It banks that stage's Wins and returns you
   to the vault.
6. **Spend.** Ride onto a stand on the left of the vault for a better broom, or
   open **Trails** for a movement-speed multiplier.
7. **Rebirth.** At level 25 (then 50, then every 25) trade your level curve for
   a permanent Speed multiplier. Wins, brooms and trails are kept.

**There are no checkpoints.** Dying anywhere — stage 1 or stage 30 — returns
you to the starting vault, which is where the brooms, the treadmills and the
leaderboards are. Coming back is how you spend what you just earned.

### The brooms

Ten ship, and each carries **two** numbers: what it farms, and how long it
flies.

| Wins to unlock |  Speed | Flight | Broom        |
| -------------: | -----: | -----: | ------------ |
|              0 |     +1 |    10s | Twig Bundle  |
|              3 |     +2 |    12s | Oak Sweeper  |
|             15 |     +5 |    15s | Cinder Straw |
|             50 |    +20 |    18s | Nightthorn   |
|            100 |    +50 |    20s | Silver Gale  |
|            500 |   +100 |    25s | Emberbolt    |
|          2,000 |   +250 |    25s | Stormlash    |
|          5,000 |   +500 |    25s | Grimheart    |
|         50,000 | +1,000 |    30s | Sunspire     |
|        100,000 | +2,000 |    35s | Void Comet   |

The two ladders are deliberately different shapes. Speed runs away, because
income is what a long game is made of. Flight barely moves — 10 to 35 across
the whole roster, with three brooms sharing 25 — because the course is designed
around it: a late broom has to open routes an early one cannot reach *without*
making the course trivial to fly end to end.

Ten trails, and a rebirth ladder with no end.

### Stages

Thirty, in a dark magical dungeon: lava, spikes, stone vaults, conjured rune
platforms suspended over nothing, and gaps no launch can cross.

| # | Stage           | Mechanic                                              | Level | Fly |    Wins |
|---|-----------------|-------------------------------------------------------|------:|----:|--------:|
| 1 | Escape          | A lava moat and five slabs. Teaches flight by refusing the first hop | 1 | 10s | 1 |
| 2 | Spike Vault     | Floor all the way, and none of it safe                |     4 | 10s |       3 |
| 3 | Crypt Slabs     | Sinking slabs over lava, each row a step higher       |     8 | 12s |       8 |
| 4 | Chain Gallery   | Censers swinging between islands over a void          |    13 | 12s |      20 |
| 5 | Guardian Vault  | A wide hall, a guardian that chases, and a high route |    19 | 15s |      50 |
| 6 | The Chasm       | One enormous gap; one slab in it, or a longer cheaper way | 26 | 15s |    120 |
| 7 | Pillar Climb    | Column tops rising faster than any launch can reach   |    33 | 15s |     200 |
| 8 | Crusher Span    | A narrow suspended walkway with masonry falling on it |    41 | 18s |     400 |
| 9 | Lava Steppers   | Diagonal crossings, so aiming costs meter             |    49 | 18s |     700 |
|10 | Frost Ledges    | Low grip; a landing slides toward the far edge        |    58 | 18s |   1,200 |
|11 | Gale Gallery    | A crosswind that acts in the air as well as on the ground | 66 | 20s | 2,000 |
|12 | Spire Ascent    | A vertical shaft. Speed does not help; only thrust does |  74 | 20s |   3,200 |
|13 | Rune Maze       | A guarded short way and a cheap long way              |    82 | 20s |   5,000 |
|14 | Bone Bridge     | The island chain, over a void, with masonry falling   |    89 | 25s |   8,000 |
|15 | Catacombs       | Spike bays and perches                                |    96 | 25s |  12,000 |
|16 | Drowned Halls   | Column tops over water                                |   103 | 25s |  18,000 |
|17 | Hex Storm       | Sinking slabs, climbing                               |   108 | 25s |  27,000 |
|18 | Black Temple    | A shaft, and the long way down                        |   112 | 25s |  40,000 |
|19 | Ember Run       | Rune bridges and blade wheels                         |   116 | 25s |  60,000 |
|20 | Warden Hall     | The chain again, on frost                             |   120 | 25s |  90,000 |
|21-30| Shadow Span → Dark Summit | The same six patterns, wider, higher and faster | 124-160 | 30-35s | 135,000 - 5,000,000 |

**Level** and **Fly** are the recommended figures printed on each stage gate —
one row per stage in `STAGE_TUNING`. The Speed figure beside the level on the
gate is derived from the same curve the player actually levels on, and the
flight figure is read off the broom roster, so a gate can never advertise
something a player cannot go and buy.

#### Why you cannot outrun the course

A launch off the ground has a **reach** and a **rise**, and they behave
completely differently as you level. Reach runs away — a level-160 rider covers
eight hundred units in one hop — so no gap could ever be authored wide enough
to keep flight necessary. Rise barely moves: launch velocity scales far more
gently than travel speed and height goes as its square, so it is about three
units at the start of the game and eleven at the end.

So the course is gated on **elevation**, not width. Every platform sits above
what a launch can climb at the level its stage is built for, and the only way
onto it is to spend meter. Every stage also has a **roof** at its own tallest
platform plus headroom, so ten seconds of thrust cannot put you above the whole
stage and glide it. `npm run verify` fails the build if more than 35% of
crossings could be made without thrust; it currently runs at 151 of 169.

---

## Layout

```
assets/player/       the supplied rider FBX and its texture (never modified)
shared/              everything the client and server must agree on exactly
  config/brooms.ts     the broom roster - shape, palette, price, Speed and FLY
  config/flight.ts     the flight meter: drain, refill, thrust, launch
  config/course.ts     the generated obby: every solid and every hazard
  config/movement.ts   the ONE movement-speed formula
  config/speed.ts      Speed farming and the level curve
  sim/PlayerSim.ts     the authoritative physics step, run by BOTH sides
  sim/WorldCollision.ts the gameplay shape of the course
server/              Colyseus room and the services that own every reward
client/              Three.js renderer, prediction, animation and the HUD
scripts/             static verification of the course and the server rules
```

The rule that holds it together: **the server owns every number that matters**.
The client predicts movement by running the identical `stepPlayer` from
`shared/`, keeps its unacknowledged inputs, and replays them whenever the
server corrects it. It never asserts a position, and it never grants itself a
Win, a level or a broom.

**The flight meter is part of that.** It is billed inside `stepPlayer`, in the
same step that produced the climb it paid for, so there is no moment at which a
client could have flown without being charged — and no message anywhere carries
a meter reading. The bar on screen is drawn from the client's prediction so it
responds on the frame the key goes down, and the server corrects it twenty
times a second.

---

## Verifying it

```bash
npm run typecheck   # shared, server and client
npm run verify      # course layout + server reward/purchase authority
npm run build       # production build of all three workspaces
```

`npm run verify` is three static suites:

- **course** — no overlapping stages, no unmarked holes, every crossing both
  reachable on a full meter **and** impossible without thrust (both computed
  from the same movement formulas the physics uses), a roof over every stage
  that nothing pokes through, win pads on the player's **left** and reachable,
  the reward table intact, the ten-broom roster checked row by row against the
  specification, the flight constants, hazards inside the corridor, every
  sinking row keeping a platform up, and all six treadmills detecting with
  their three tiers' gates and multipliers.
- **barrier** — the hard end of the world, charged at over 2,000 units/second
  from every level and rebirth the game can produce.
- **progression** — the reward, rebirth, trail, treadmill and **flight** rules,
  including the paths a cheating client would want: claiming a stage from
  across the map, rebirthing under-level, buying a trail with no Wins,
  equipping one you do not own, claiming a broom from the wrong place, farming
  a belt tier you have not levelled into, holding thrust for ever on a ten
  second tank, and launching on an empty one. All are refused.

And one that needs a running server:

```bash
npm start &          # the Colyseus server
npm run verify:capacity
```

- **capacity** — connects eighteen clients and asserts all three limits: no
  room over **15**, the overflow **routed** to another room rather than turned
  away, and every room **closed once empty**.


---

## Deploying

Two pieces, two hosts, and that split is deliberate: **Netlify serves static
files and cannot run a WebSocket server**, so the client and the game server do
not live in the same place.

```
Netlify  ──  client/dist          the WebGL build (static)
   │
   │  wss://
   ▼
Node host ──  @broom/server      Colyseus, one long-lived process
```

### 1. The game server

Any host that runs a Node process and keeps a WebSocket open - Fly.io, Railway,
Render, a VPS. It needs no database.

```bash
npm ci
npm run build:server     # builds shared, then the server
npm start --workspace @broom/server
```

| Variable          | Needed | Meaning                                              |
| ----------------- | ------ | ---------------------------------------------------- |
| `PORT`            | no     | Port to bind. Managed hosts set this themselves; defaults to 2569. |
| `HOST`            | no     | Interface to bind. Defaults to `0.0.0.0`, which is what a container needs. |
| `BROOM_DATA_DIR`  | no     | Where profiles are written. Defaults to `data/` beside the server. |
| `BLOXITY_WEBHOOK_SECRET` | **yes, in production** | Checked against the `x-legion-webhook-secret` header on `POST /bloxity/bux`. Without it, anyone who finds the endpoint can grant Wins. |
| `BLOXITY_GAME_ID` | no     | The slug player tokens are verified against. Defaults to `speed-broom-escape`. On Bloxity Legion it is injected automatically, and must match the client's `VITE_BLOXITY_GAME_ID`. |
| `BLOXITY_API_BASE`| no     | Where tokens are verified. Defaults to `https://api.bloxity.io`. |

`GET /health` returns `{"ok":true,"room":"broomobby","rooms":N,"players":N}`
for the host's health check. The room and player counts come from the
matchmaker's own tally, which is what makes the 15-player limit and the
close-when-empty rule observable from outside the process.

> **Profiles are a JSON file on disk.** On a host with an ephemeral filesystem
> - which is most of them - every redeploy wipes every player's progression.
> Point `BROOM_DATA_DIR` at a mounted volume, or accept that the ladder resets
> on each deploy.

### 2. The client

Netlify builds from the REPOSITORY ROOT - this is an npm workspaces monorepo
and the client imports `@broom/shared`, so building from inside `client/`
would install only that workspace. `netlify.toml` already sets this up.

Set ONE environment variable in the Netlify site (Site configuration →
Environment variables), then trigger a deploy:

```
VITE_SERVER_URL = wss://your-server-host
```

That is the only server configuration the client has. It is baked in at BUILD
time, so **changing it requires a rebuild** - Vite has no later step in which
to inject it. An `https://` URL is accepted and converted; a build with the
variable unset boots, plays offline, and says exactly that on screen rather
than failing with a socket error.

Because the page is served over https, the endpoint must be `wss://` - a
browser will not open an insecure socket from a secure page.

### Bloxity Hosting (GitHub Actions)

`.github/workflows/deploy.yml` deploys both halves on a push:

| Branch | Channel |
| ------ | ------- |
| `dev`  | `dev`   |
| `main` | `prod`  |

The channel follows the branch and nothing else. A manual "Run workflow"
redeploys the branch it is started from; there is no channel picker, so no
button can ship `dev` to production, and any other branch is refused.

The server is built from the repo-root `Dockerfile` - the build context has to
be the root, because the server imports `@broom/shared` as a workspace
dependency - pushed to `ghcr.io/<owner>/speed-broom-escape-server` under an
immutable `<channel>-<sha>` tag, and rolled by that tag rather than by the
moving `<channel>` one, so a re-run cannot ship an image a later push replaced.
The client is built with `VITE_BLOXITY_GAME_ID` and the channel's
`VITE_SERVER_URL` (the job fails if that URL is not in the bundle), checked
against the 12 MB budget, zipped with `index.html` at the archive root, and
uploaded. Both halves carry the commit SHA as their `version`.

Nothing is published on either half until a shared `verify` job passes:
`typecheck`, `verify` and `verify:assets`.

Two different hosts, which is not a typo:

| Call            | Route                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| Roll the server | `POST https://legion.bloxity.io/v1/apps/{gameId}/deploy`                  |
| Publish the client | `POST https://api.bloxity.io/v1/hosting/games/{gameId}/frontend?channel=&version=` |

Both come from <https://hosting.bloxity.io/docs>. `seatCap` must equal
`MAX_PLAYERS_PER_ROOM` (15): Legion fills a pod to `seatCap` and then spawns
the next one, so a larger figure would route a sixteenth player to a room that
refuses them. `maxReplicas` 5 puts total capacity at 75.

The addresses the game answers on:

| Channel | Backend                                          | Frontend                                         |
| ------- | ------------------------------------------------ | ------------------------------------------------ |
| `dev`   | `https://speed-broom-escape.dev.host.bloxity.io` | `https://speed-broom-escape.dev.play.bloxity.io` |
| `prod`  | `https://speed-broom-escape.host.bloxity.io`     | `https://speed-broom-escape.play.bloxity.io`     |

Set these in the repository (Settings -> Secrets and variables -> Actions):

| Name                  | Kind   | Purpose                             |
| --------------------- | ------ | ----------------------------------- |
| `LEGION_DEPLOY_TOKEN` | secret | Authenticates both calls. **The only thing to set.** |

That is all the Bloxity docs ask for, and the workflow has no optional
override variables: the API hosts and backend URLs are the documented ones.
One thing is NOT in the repository: after the first run, make the GHCR package
public (repo -> Packages -> Package settings -> Change visibility), or Legion
cannot pull the image.

> [!WARNING]
> Legion pods are ephemeral and the game scales to zero when idle, so the
> `BROOM_DATA_DIR` JSON file does NOT survive there - `VOLUME` in a Dockerfile
> asks Kubernetes for nothing. Legion injects `MONGODB_URI` for exactly this,
> and until a `PersistenceAdapter` reads it, progression on Bloxity resets
> whenever the last player leaves. See "Persistence" above.

### 3. Check it

```bash
ENDPOINT=wss://your-server-host npm run verify:capacity
```

Connects 18 clients and asserts that no room exceeds 15 and that the overflow
is routed to a second room.

---

## Bloxity

The game integrates the [Bloxity](https://bloxity.io) portal SDK: one account
across games, friends and invites, avatar cosmetics, settings that follow you,
and the Bux currency. It runs the same code embedded in an iframe on bloxity.io
and hosted standalone - the SDK detects which and routes accordingly.

`client/src/bloxity/Bloxity.ts` is the only file that touches the SDK. If the
script is blocked or offline the game boots and plays exactly as before and the
account chip reads "Playing offline"; nothing else changes.

**Bux never grant anything on the client.** The client asks for a SKU - never a
price - and the purchase is fulfilled server to server: Bloxity posts to
`/bloxity/bux`, the server queues the grant against the Bloxity account, and the
room hands it over through the same `wallet.add` every stage reward uses. The
webhook answers 2xx for anything it has safely recorded, including a SKU this
build does not know, because Bloxity refunds what fails and a catalogue that
moved ahead of a deploy must not cost a player their purchase.

| Variable                  | Needed | Meaning                                        |
| ------------------------- | ------ | ---------------------------------------------- |
| `BLOXITY_WEBHOOK_SECRET`  | prod   | Verifies `x-legion-webhook-secret` on the webhook. Without it the endpoint accepts anything. |

---

## Notes for the curious

**Nothing in the world is an image.** The flagstone floors, the dungeon
masonry, the timber walkways, the glowing rune slabs, the gold trophy pads, the
treadmill belts, every word of world text and the cavern dark are all drawn on
a canvas at runtime. The only pictures in the build are the supplied rider
model and three HUD icons — and one of those, the trophy, is also hung in the
world over every win pad.

**There is not one audio file either.** Every sound — the takeoff sweep, the
thrust loop, the drain, the landing, the win fanfare — is synthesised from
oscillators. There is no music yet, deliberately; the bus the portal's music
slider is wired to exists with nothing on it, so adding a track later cannot
start two copies of it.

**The brooms are built from boxes at load time.** One generic builder consumes
each broom's proportions, palette and enchantment list, merges the result into
one vertex-coloured geometry per moving part, and caches it. A school besom and
a racing comet are the same dozen boxes at different sizes. Adding an eleventh
broom is one entry in `shared/src/config/brooms.ts` — it gets a shop stand, a
three-line stat sign and a working mount with no other change.

**There is no speed cap.** Late game runs at hundreds of units per second, and
a single 1/60s step at that speed would pass straight through a plank. Instead
the physics step subdivides itself until no substep travels more than a fixed
distance, so collision is as reliable at 400 u/s as at 20.

**The rider hangs off the broom's body node**, not off a per-frame transform
copy. It inherits the bob, the bank and — the one that matters here — the
nose-up climb, so it cannot slide, clip or float however the broom moves. A
rider parented anywhere else stays level while the broom under them tilts,
which is exactly how a flying character comes out looking pasted on. The
rider's walk cycle never plays.

**There are two flight animations and they are one pose, blended.** Riding is
level with the nose a few degrees down at speed and the bristles streaming
flat; ascending is the nose pitched well up, the bundle flared down and back,
and the enchantment lit. A single `climb` value moves between them — in fast,
out slower, so pressing the key looks instant and releasing it looks like
settling. It is the *only* thing that produces a nose-up broom, so a nose-up
broom always means "the meter is being spent" and never anything else.

**Almost every moving thing is a pure function of the clock.** The swinging
censers, the falling masonry and the sinking slabs take a time and return a
position, so the server evaluates them to decide a death and the client
evaluates the identical function to draw them — nothing about them is on the
wire. A spike bed is the simplest case of all: it returns its authored position
unchanged, which is the whole implementation. The guardian is the deliberate
exception: it chases, so it depends on where the players are, and the server
simulates and replicates it.

**Every Speed gain floats up the screen.** The "+N" popups are fed by an
accumulator over the *replicated* total rather than by raw state patches, so a
slow trickle reads as "+2" and a treadmill sprint reads as "+200" without
either being a special case. Fourteen nodes are pooled once and reused for
ever; a spawn that finds none free retires the oldest rather than growing the
document. They are placed at random inside a band that misses the Wins counter,
the left rail and the level bar at any window shape, and re-rolled if they land
on one still on screen.

**World text is sized to FIT, not to a font size.** Every sign in the world -
the stage gates, TRAINING, the treadmill labels, the broom prices - is drawn
on a canvas, and `CanvasSign` measures the string and shrinks until the glyphs
*and their outline* sit inside the panel. Sizing from the height band alone is
what clipped "60.0K Wins Required" off both ends of its own texture, and
`strokeText` paints half a line width outside the glyphs, so the outline needs
budgeting too. The panels are also authored wide enough that the shrink rarely
has to do anything: the fix is never "make the text small".

**The corridor is 64 units wide, and can be wider.** `WIDE_AREAS` names the
spans that open out - the lobby and the ruins arena - and the floor, the
boundary clamp, the walls and the treeline all read the same list, so a place
the renderer draws wide and the collision keeps narrow is structurally
impossible. Obstacle offsets are written as fractions of the corridor through
`lane()`, so widening the course moved every platform with it.

**The scoreboards are part of the room.** Three boards stand against the back
wall of the arena, ranking Wins, Speed and Rebirths. Every figure is the
server's - stored profiles merged with live player state, live winning wherever
both exist - and ranked on the server, on a slow timer, because nobody reads a
leaderboard twenty times a second. Players have no names, so a handle is
derived from their id deterministically; the id itself never leaves the server.

**Every sound effect is synthesised**, with oscillators and envelopes: one
context, a per-sound cooldown and a hard voice ceiling on the one-shots, and
only the local player making any noise at all. A pack of wavs would have been
the easiest way to spend the whole 12 MB budget.

The background music is the one supplied audio file, streamed from
`assets/audio/` through the same music bus - so the portal's music slider, the
master volume and mute all work on it without knowing it is a file rather than
a tune the game made up.

**Escape gives you your cursor, and lets you keep it.** Pointer lock hides the
cursor and every menu opens from a rail tile, so a released lock used to be
treated as an accident and reversed - which left desktop players captured, with
buttons they could neither see nor click. It is now a state the game has: the
camera stops, the HUD is clickable, and one click on the world resumes play.

**The sky is real geometry.** A gradient dome plus ninety clusters of boxes,
merged into two meshes. The world also has a real bottom — a pit floor drawn
under everything, with the death plane well above it, so falling reads as
dropping into a pit rather than into an unfinished map.
