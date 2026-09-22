/**
 * PERSISTENT, CROSS-DEVICE PROGRESS - end to end.
 *
 * Spawns the BUILT server (`npm run build:server` first), joins it with real
 * colyseus.js clients, and reads storage directly to check what actually
 * landed. The only thing faked is Bloxity's token-verify endpoint, via
 * `scripts/persistence-stub.mjs` preloaded into the server with
 * `node --import` - nothing in the server knows it is being tested.
 *
 * BACKENDS
 *   - The JSON dev store: ALWAYS, in a throwaway temp directory.
 *   - MongoDB with a mongod this script starts, stops and restarts itself
 *     (needed for the outage tests): set MONGOD_BIN to a mongod executable.
 *     mongodb-memory-server can supply one - install it OUTSIDE this repo and
 *     read `MongoBinary.getPath()`.
 *   - MongoDB at MONGODB_URI (no outage tests): set MONGODB_URI.
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !!  WARNING: the database named by MONGODB_URI is WIPED (dropDatabase) at  !!
 * !!  the start of the run. NEVER point this at a real game's database.       !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * WINDOWS: signals do not reach Node handlers there, so servers are stopped
 * with SIGKILL - a HARD kill. Every restart test therefore waits for the
 * writes it depends on to be visible in storage before killing.
 *
 * Not part of `npm run verify`: it needs the built server, real sockets and
 * (for Mongo) a database binary, and takes a few minutes.
 *
 *   npm run verify:persistence
 *   MONGOD_BIN=/path/to/mongod npm run verify:persistence
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'colyseus.js';
import { MongoClient } from 'mongodb';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = joinPath(ROOT, 'server', 'dist', 'index.js');
const STUB = pathToFileURL(joinPath(ROOT, 'scripts', 'persistence-stub.mjs')).href;
const ROOM = 'broomobby';
const SECRET = 'verify-persistence-secret';
const GAME_PORT = 2591;
const MONGO_PORT = 27391;

if (!existsSync(SERVER_ENTRY)) {
  console.error('server/dist is missing - run `npm run build:server` first.');
  process.exit(1);
}

// ------------------------------------------------------------------ report
let failures = 0;
let passes = 0;
const check = (label, actual, expected) => {
  const ok = typeof expected === 'function' ? expected(actual) : Object.is(actual, expected);
  if (ok) {
    passes += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}: got ${JSON.stringify(actual)}${typeof expected === 'function' ? '' : `, expected ${JSON.stringify(expected)}`}`);
  }
};
const section = (name) => console.log(`\n${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, timeoutMs = 15000, stepMs = 200) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* not yet */
    }
    await sleep(stepMs);
  }
  return last;
};

// ------------------------------------------------------------ the server
const allLogs = [];

class TestServer {
  constructor(env) {
    this.env = env;
    this.child = null;
    this.log = '';
  }

  async start() {
    this.log = '';
    this.child = spawn(
      process.execPath,
      ['--import', STUB, SERVER_ENTRY, '--port', String(GAME_PORT)],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          MONGODB_URI: '',
          ...this.env,
          BLOXITY_WEBHOOK_SECRET: SECRET,
          BLOXITY_GAME_ID: 'speed-broom-escape',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const capture = (chunk) => {
      const text = chunk.toString();
      this.log += text;
      allLogs.push(text);
    };
    this.child.stdout.on('data', capture);
    this.child.stderr.on('data', capture);
    const healthy = await waitFor(async () => (await fetch(`http://127.0.0.1:${GAME_PORT}/health`)).ok, 20000);
    if (!healthy) throw new Error(`server did not come up:\n${this.log}`);
  }

  /** HARD kill. Callers wait for the writes they need to land first. */
  async kill() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await gone;
    await sleep(300);
  }

  async restart() {
    await this.kill();
    await this.start();
  }
}

// ------------------------------------------------------------ the database
class Mongod {
  constructor(bin, dir) {
    this.bin = bin;
    this.dir = dir;
    this.child = null;
    this.uri = `mongodb://127.0.0.1:${MONGO_PORT}/verify_persistence`;
  }

  async start() {
    mkdirSync(this.dir, { recursive: true });
    // A FIXED port and dbPath, driven directly: a restart must come back on
    // the same address with the same data, which is the point of the test.
    this.child = spawn(this.bin, ['--port', String(MONGO_PORT), '--dbpath', this.dir, '--bind_ip', '127.0.0.1'], {
      stdio: 'ignore',
    });
    const up = await waitFor(async () => {
      const probe = new MongoClient(this.uri, { serverSelectionTimeoutMS: 500 });
      try {
        await probe.connect();
        await probe.db().command({ ping: 1 });
        return true;
      } finally {
        await probe.close();
      }
    }, 30000, 300);
    if (!up) throw new Error('mongod did not start');
  }

  async kill() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await gone;
    await sleep(500);
  }
}

// ---------------------------------------------------------- the backends
const profile = (overrides = {}) => ({
  totalSpeed: 0,
  wins: 0,
  ownedBrooms: 1,
  rebirths: 0,
  ownedTrails: 0,
  trailSlot: 0,
  bestStage: 0,
  updatedAt: Date.now() - 60_000,
  ...overrides,
});

const jsonBackend = (dir) => ({
  name: 'JSON store',
  kind: 'json',
  dir,
  env: { BROOM_DATA_DIR: dir, MONGODB_URI: '' },
  async seed(profiles) {
    writeFileSync(joinPath(dir, 'profiles.json'), JSON.stringify(profiles));
  },
  async read(key) {
    const file = joinPath(dir, 'profiles.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'))[key] ?? null;
  },
  async grant(txn) {
    const file = joinPath(dir, 'grants.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'))[txn] ?? null;
  },
  async close() {},
});

const mongoBackend = async (uri, dir, label) => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  await client.connect();
  const db = client.db();
  console.log(`\n  !!! dropping database "${db.databaseName}" at ${uri.replace(/\/\/[^@]*@/, '//***@')} !!!`);
  await db.dropDatabase();
  return {
    name: label,
    kind: 'mongo',
    dir,
    env: { BROOM_DATA_DIR: dir, MONGODB_URI: uri },
    async seed(profiles) {
      const docs = Object.entries(profiles).map(([key, value]) => ({ _id: key, ...value }));
      if (docs.length) await db.collection('profiles').insertMany(docs);
    },
    async read(key) {
      const doc = await db.collection('profiles').findOne({ _id: key });
      if (!doc) return null;
      const { _id, ...rest } = doc;
      return rest;
    },
    async grant(txn) {
      return db.collection('bux_grants').findOne({ _id: txn });
    },
    async close() {
      await client.close();
    },
  };
};

// ------------------------------------------------------------- a player
/**
 * One browser tab. `playerId` is what that browser keeps in localStorage and
 * `token` is its Bloxity login, or undefined for a guest.
 */
const enter = async ({ playerId, token, extra = {} }) => {
  const client = new Client(`ws://127.0.0.1:${GAME_PORT}`);
  let room;
  try {
    room = await client.joinOrCreate(ROOM, { playerId, bloxityToken: token, ...extra });
  } catch (error) {
    return { refused: true, error: String(error?.message ?? error) };
  }
  const guestIds = [];
  room.onMessage('*', (type, message) => {
    if (type === 'guestId') guestIds.push(message.playerId);
  });
  await waitFor(() => room.state?.players?.get(room.sessionId), 10000, 50);
  const me = () => room.state.players.get(room.sessionId);
  let seq = 1;
  return {
    refused: false,
    room,
    guestIds,
    wins: () => me()?.wins,
    speed: () => me()?.totalSpeed,
    identity: (value) => room.send('setIdentity', { token: value }),
    /** Ride forward for a while, at real time, earning Speed on the server. */
    async ride(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        room.send('move', { seq: seq++, dt: 1 / 60, moveX: 0, moveZ: 1, jump: false, sprint: true, cameraYaw: 0 });
        await sleep(16);
      }
      await sleep(300);
    },
    async leave() {
      await room.leave(true).catch(() => undefined);
      await sleep(200);
    },
  };
};

const webhook = async (transactionId, userId, sku = 'wins_small') =>
  (
    await fetch(`http://127.0.0.1:${GAME_PORT}/bloxity/bux`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-legion-webhook-secret': SECRET },
      body: JSON.stringify({ transactionId, userId, username: userId, gameSlug: 'speed-broom-escape', sku }),
    })
  ).status;

// -------------------------------------------------------------- the suite
const runSuite = async (backend, mongod) => {
  console.log(`\n==================== ${backend.name} ====================`);
  const control = joinPath(backend.dir, 'stub-control.json');
  const setBloxity = (unavailable) => writeFileSync(control, JSON.stringify({ unavailable }));
  setBloxity(false);

  // The world as it was before this build: guests, one account, and (for
  // Mongo) a legacy profiles.json waiting to be imported.
  await backend.seed({
    p_existing: profile({ totalSpeed: 5000, wins: 40, bestStage: 3, keepMe: 'unknown-field' }),
    'bloxity:acct_victim': profile({ totalSpeed: 1234, wins: 999 }),
    p_mig: profile({ totalSpeed: 3000, wins: 25, bestStage: 2, keepMe: 'guest-extra' }),
    'bloxity:acct_exist': profile({ wins: 777 }),
    p_browser: profile({ wins: 11 }),
    'bloxity:acct_down': profile({ wins: 60 }),
    'bloxity:acct_sign': profile({ wins: 50 }),
  });
  if (backend.kind === 'mongo') {
    writeFileSync(
      joinPath(backend.dir, 'profiles.json'),
      JSON.stringify({
        p_legacy: profile({ wins: 9 }),
        // Already in the database with 777. The import must NOT touch it.
        'bloxity:acct_exist': profile({ wins: 1 }),
      }),
    );
  }

  const server = new TestServer({ ...backend.env, STUB_CONTROL: control });
  await server.start();

  // ---------------------------------------------------------------- 1
  section('an existing guest restores');
  {
    const tab = await enter({ playerId: 'p_existing' });
    check('restored wins', tab.wins(), 40);
    check('restored Speed', tab.speed(), 5000);
    await tab.leave();
    const stored = await waitFor(async () => {
      const p = await backend.read('p_existing');
      return p && p.updatedAt > Date.now() - 30_000 ? p : null;
    });
    check('a field this build does not know survives a save', stored?.keepMe, 'unknown-field');
  }

  // ---------------------------------------------------------------- 2
  section('nobody gets an account without Bloxity saying so');
  {
    const reserved = await enter({ playerId: 'bloxity:acct_victim' });
    check('a guest id with the account prefix is refused outright', reserved.refused, true);

    const rawId = await enter({ playerId: 'acct_victim' });
    check('a raw account id as a guest id gets nothing', rawId.wins(), 0);
    await rawId.leave();

    const forged = await enter({ playerId: 'p_attacker1', token: 'forged-token' });
    check('a forged token gets nothing', forged.wins(), 0);
    await forged.leave();

    const oldOption = await enter({ playerId: 'p_attacker2', extra: { bloxityId: 'acct_victim' } });
    check('the old "bloxityId" join option gets nothing', oldOption.wins(), 0);
    await oldOption.leave();

    check("the victim's stored profile is untouched", (await backend.read('bloxity:acct_victim'))?.wins, 999);
  }

  // ---------------------------------------------------------------- 3
  section('first login migrates the guest progress');
  let migrated;
  {
    migrated = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
    check('the session keeps its progress', migrated.wins(), 25);
    const account = await waitFor(() => backend.read('bloxity:acct_new'));
    check('the account now holds the guest progress', account?.wins, 25);
    check('  Speed carried over', account?.totalSpeed, 3000);
    check('  unknown fields carried over', account?.keepMe, 'guest-extra');
    check('  stamped migratedFrom', account?.migratedFrom, 'p_mig');
    const guest = await waitFor(async () => {
      const g = await backend.read('p_mig');
      return g?.migratedTo ? g : null;
    });
    check('the guest copy is marked migratedTo', guest?.migratedTo, 'bloxity:acct_new');
    check('  and keeps its data as a recovery copy', guest?.wins, 25);
  }

  // ---------------------------------------------------------------- 4
  section('logout, then signing back in');
  {
    migrated.identity('');
    const out = await waitFor(() => (migrated.wins() === 0 && migrated.guestIds.length > 0 ? true : null), 15000);
    check('logout -> a FRESH guest (the old guest copy was migrated)', migrated.wins(), 0);
    check('  and the browser is handed a new guest id', Boolean(out) && /^p_/.test(migrated.guestIds[0] ?? ''), true);
    migrated.identity('ok.acct_new');
    await waitFor(() => migrated.wins() === 25, 15000);
    check('signing back in restores the account', migrated.wins(), 25);
    await migrated.leave();
    check('the recovery copy was never written over', (await backend.read('p_mig'))?.wins, 25);
  }

  // ---------------------------------------------------------------- 5
  section('a mid-session sign-in migrates the LIVE state');
  {
    const tab = await enter({ playerId: 'p_live' });
    await tab.ride(2500);
    const live = tab.speed();
    check('the guest earned Speed in this session', live > 0, true);
    tab.identity('ok.acct_live');
    const account = await waitFor(() => backend.read('bloxity:acct_live'), 15000);
    check('the new account starts from the live state, not the last autosave', account?.totalSpeed, (v) => v >= live);
    check('  stamped migratedFrom', account?.migratedFrom, 'p_live');
    check('the session kept its progress through the switch', tab.speed(), (v) => v >= live);
    await tab.leave();
  }

  // ---------------------------------------------------------------- 6
  section('the same account again, and elsewhere');
  {
    const again = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
    check('reconnecting as the same account restores it', again.wins(), 25);
    await again.leave();
    const other = await enter({ playerId: 'p_other_browser', token: 'ok.acct_new' });
    check('the same account on another browser restores it', other.wins(), 25);
    await other.leave();
    const reseed = await enter({ playerId: 'p_mig', token: 'ok.acct_second' });
    check('a migrated guest copy never seeds a second account', reseed.wins(), 0);
    await reseed.leave();
  }

  // ---------------------------------------------------------------- 7
  section('an existing account is never overwritten by a browser profile');
  {
    const tab = await enter({ playerId: 'p_browser', token: 'ok.acct_exist' });
    check('the account wins', tab.wins(), 777);
    tab.identity('');
    await waitFor(() => tab.wins() === 11, 15000);
    check("logout returns this browser's own progress", tab.wins(), 11);
    await tab.leave();
    check('the account still has its own progress', (await backend.read('bloxity:acct_exist'))?.wins, 777);
    check('the browser profile was not marked migrated', (await backend.read('p_browser'))?.migratedTo, undefined);
  }

  // ---------------------------------------------------------------- 8
  section('purchases go only to the verified account, and survive a restart');
  {
    const txn = `txn_${backend.kind}_${Date.now()}`;
    check('the webhook records the purchase (2xx only once durable)', await webhook(txn, 'acct_buyer'), 200);
    const thief = await enter({ playerId: 'acct_buyer', token: 'forged-token' });
    await sleep(6500); // longer than one grant poll
    check('a guest naming the buyer, with a forged token, gets nothing', thief.wins(), 0);
    await thief.leave();

    await server.restart(); // between the webhook and the buyer's join
    const buyer = await enter({ playerId: 'p_buyer', token: 'ok.acct_buyer' });
    await waitFor(() => buyer.wins() === 250, 15000);
    check('the verified buyer receives it after a restart', buyer.wins(), 250);
    const grant = await waitFor(async () => {
      const g = await backend.grant(txn);
      return g?.status === 'applied' ? g : null;
    });
    check('  the grant is closed', grant?.status, 'applied');
    const stored = await waitFor(async () => {
      const p = await backend.read('bloxity:acct_buyer');
      return p?.appliedGrants?.includes(txn) ? p : null;
    });
    check('  the profile records it as paid', stored?.wins, 250);
    await buyer.leave();
    await server.restart();
    const again = await enter({ playerId: 'p_buyer', token: 'ok.acct_buyer' });
    await sleep(6500);
    check('it is paid exactly once', again.wins(), 250);
    await again.leave();
  }

  // ---------------------------------------------------------------- 9
  section('Bloxity unavailable -> guest for now, account once it is back');
  {
    setBloxity(true);
    const tab = await enter({ playerId: 'p_down', token: 'ok.acct_down' });
    check('admitted as a guest while Bloxity is down', tab.wins(), 0);
    setBloxity(false);
    await waitFor(() => tab.wins() === 60, 20000);
    check('re-verified on a backoff and moved onto the account', tab.wins(), 60);
    await tab.leave();
  }

  // --------------------------------------------------------------- 10
  section('a server restart loses nothing');
  let expectedSpeed;
  {
    const tab = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
    await tab.ride(2000);
    expectedSpeed = tab.speed();
    await tab.leave();
    await waitFor(async () => (await backend.read('bloxity:acct_new'))?.totalSpeed === expectedSpeed);
    await server.restart();
    const back = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
    check('everything came back after a hard kill', back.speed(), expectedSpeed);
    check('  wins too', back.wins(), 25);
    await back.leave();
  }

  // --------------------------------------------------------------- 10b
  section('every player is shown by their Bloxity name and picture - never an id');
  {
    const accountPfp = 'https://static.bloxity.io/img/pfps/s1_h9.png?width=128&quality=85&v=2';
    const guestPfp = 'https://static.bloxity.io/img/pfps/s4_h2.png?width=128&quality=85&v=2';
    const account = await enter({ playerId: 'p_disp_a', token: 'ok.acct_disp' });
    const guest = await enter({ playerId: 'p_disp_b', extra: { guestName: 'Comet42', guestPfp } });
    const faker = await enter({
      playerId: 'p_disp_c',
      extra: { guestName: 'Chicken acct_disp', guestPfp: 'https://evil.example/pfp.png' },
    });
    const seen = (tab, other) => tab.room.state.players.get(other.room.sessionId);

    check('a signed-in player is named by their Bloxity DISPLAY name', seen(account, account)?.displayName, 'Chicken acct_disp');
    check('  with their Bloxity profile picture', seen(account, account)?.pfp, accountPfp);
    await waitFor(
      () => seen(guest, account)?.displayName && seen(account, guest)?.displayName && seen(account, faker)?.displayName,
    );
    check('OTHER players see that name too', seen(guest, account)?.displayName, 'Chicken acct_disp');
    check('  and that picture', seen(guest, account)?.pfp, accountPfp);
    check('a guest is named by their Bloxity guest name', seen(account, guest)?.displayName, 'Comet42');
    check('  with their Bloxity guest picture', seen(account, guest)?.pfp, guestPfp);
    check("a guest cannot take an account's name", seen(account, faker)?.displayName, 'Guest');
    check('  nor show a picture from outside Bloxity', seen(account, faker)?.pfp, '');

    guest.room.send('setGuestProfile', { name: 'Tiger7', pfp: guestPfp });
    await waitFor(() => seen(account, guest)?.displayName === 'Tiger7');
    check('a guest identity sent mid-session reaches everyone', seen(account, guest)?.displayName, 'Tiger7');
    account.room.send('setGuestProfile', { name: 'Wolf9', pfp: '' });
    await sleep(600);
    check('a SIGNED-IN player cannot rename themselves', seen(guest, account)?.displayName, 'Chicken acct_disp');

    const internal = [account, guest, faker].flatMap((tab) => [tab.room.sessionId]).concat([
      'p_disp_a', 'p_disp_b', 'p_disp_c', 'acct_disp', 'bloxity:acct_disp',
    ]);
    const shown = [account, guest, faker].map((tab) => seen(account, tab)?.displayName ?? '');
    check(
      'no shown name is an id, a key or an @handle',
      shown.every((name) => name && !name.startsWith('@') && !internal.includes(name) && !name.includes('bloxity:')),
      true,
    );

    // The NAME THE PORTAL SHOWS: the SDK's user record, sent by the client,
    // used once the session is verified as that same account. The stub's
    // verify reply says "Chicken <id>" - standing in for the generated name
    // the verify endpoint can carry - so these prove which source wins.
    const sdkPfp = 'https://static.bloxity.io/img/pfps/s7_h1.png?width=128&quality=85&v=2';
    const named = await enter({
      playerId: 'p_disp_d',
      token: 'ok.acct_sdk',
      extra: { accountId: 'acct_sdk', accountName: 'Kavin Real', accountPfp: sdkPfp },
    });
    await waitFor(() => seen(guest, named)?.displayName);
    check("a signed-in player shows the SDK's account name (what the portal shows)", seen(guest, named)?.displayName, 'Kavin Real');
    check('  with the SDK account picture', seen(guest, named)?.pfp, sdkPfp);
    named.room.send('setAccountProfile', { accountId: 'acct_sdk', name: 'Kavin Renamed', pfp: sdkPfp });
    await waitFor(() => seen(guest, named)?.displayName === 'Kavin Renamed');
    check('a rename reported by the SDK reaches everyone', seen(guest, named)?.displayName, 'Kavin Renamed');
    named.room.send('setAccountProfile', { accountId: 'acct_someone_else', name: 'Not Me', pfp: '' });
    await sleep(600);
    check("an SDK name for a DIFFERENT account is not shown", seen(guest, named)?.displayName, 'Chicken acct_sdk');
    const posing = await enter({
      playerId: 'p_disp_e',
      extra: { accountId: 'acct_sdk', accountName: 'Kavin Real', guestName: 'Lynx5' },
    });
    await waitFor(() => seen(guest, posing)?.displayName);
    check('a GUEST cannot use an account name, even claiming an account id', seen(guest, posing)?.displayName, 'Lynx5');
    await named.leave();
    await posing.leave();

    // The boards: name + picture per row, from the server.
    await account.ride(1500);
    const row = await waitFor(
      () => [...account.room.state.leaderboard.speed].find((entry) => entry.name === 'Chicken acct_disp'),
      8000,
    );
    check('the Speed board ranks the player by display name', row?.name, 'Chicken acct_disp');
    check('  with their picture beside it', row?.pfp, accountPfp);
    const names = [
      ...account.room.state.leaderboard.wins,
      ...account.room.state.leaderboard.speed,
      ...account.room.state.leaderboard.rebirths,
    ].map((entry) => entry.name).filter(Boolean);
    check(
      'no board row shows an @handle, an id or a profile key',
      names.every((name) => !name.startsWith('@') && !name.includes('bloxity:') && !/^p_/.test(name)),
      true,
    );

    // Signing out switches to the browser's Bloxity GUEST identity - the one
    // it sent while signed in ("Wolf9"), kept but not shown until now.
    account.identity('');
    await waitFor(() => seen(guest, account)?.displayName === 'Wolf9', 10000);
    check("signing out shows the browser's Bloxity guest name instead", seen(guest, account)?.displayName, 'Wolf9');
    account.identity('ok.acct_disp');
    await waitFor(() => seen(guest, account)?.displayName === 'Chicken acct_disp', 10000);
    check('signing back in shows the account name again', seen(guest, account)?.displayName, 'Chicken acct_disp');

    await account.leave();
    const stored = await waitFor(async () => {
      const p = await backend.read('bloxity:acct_disp');
      return p?.displayName ? p : null;
    });
    check('the display name is saved with the profile', stored?.displayName, 'Chicken acct_disp');
    check('  and the picture', stored?.pfp, accountPfp);
    const migratedName = (await backend.read('bloxity:acct_new'))?.displayName;
    check("a migrated account never inherits the guest's name", migratedName, 'Chicken acct_new');

    // Offline: still ranked, still by name and picture.
    const offlineRow = await waitFor(
      () => [...guest.room.state.leaderboard.speed].find((entry) => entry.name === 'Chicken acct_disp'),
      8000,
    );
    check('an OFFLINE player is still named on the board', offlineRow?.name, 'Chicken acct_disp');
    check('  with their picture', offlineRow?.pfp, accountPfp);
    await guest.leave();
    await faker.leave();
  }

  if (backend.kind === 'mongo' && mongod) {
    // ------------------------------------------------------------- 11
    section('database down -> joins refused, never fresh; back -> intact');
    {
      await mongod.kill();
      const health = await fetch(`http://127.0.0.1:${GAME_PORT}/health`);
      check('/health still answers with the database down', health.status, 200);
      const refused = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
      check('a join is refused rather than let in on an empty profile', refused.refused, true);
      const guestRefused = await enter({ playerId: 'p_existing' });
      check('  guests too', guestRefused.refused, true);
      await mongod.start();
      const back = await waitFor(async () => {
        const tab = await enter({ playerId: 'p_mig', token: 'ok.acct_new' });
        return tab.refused ? null : tab;
      }, 30000, 1000);
      check('once the database is back, the join succeeds', Boolean(back), true);
      check('  with everything intact', back?.speed?.(), expectedSpeed);
      await back?.leave();
    }

    // ------------------------------------------------------------- 12
    section('a sign-out that cannot reach storage stays put');
    let signTab;
    {
      signTab = await enter({ playerId: 'p_signer', token: 'ok.acct_sign' });
      check('signed in on the account', signTab.wins(), 50);
      await mongod.kill();
      signTab.identity('');
      await sleep(8000);
      check('still on the account after a failed sign-out', signTab.wins(), 50);
    }

    // ------------------------------------------------------------- 13
    section('a save made during an outage lands once the database is back');
    {
      await signTab.ride(2000);
      const earned = signTab.speed();
      await signTab.leave(); // queued; retried with backoff
      await mongod.start();
      const landed = await waitFor(async () => (await backend.read('bloxity:acct_sign'))?.totalSpeed === earned, 45000, 500);
      check('the outage-time save landed', Boolean(landed), true);
    }

    // ------------------------------------------------------------- 14
    section('legacy import adds, never overwrites');
    {
      check('a legacy profile was imported', (await backend.read('p_legacy'))?.wins, 9);
      check('an existing profile was NOT overwritten by the legacy file', (await backend.read('bloxity:acct_exist'))?.wins, 777);
      await server.restart();
      check('importing again on the next boot changes nothing', (await backend.read('bloxity:acct_exist'))?.wins, 777);
    }
  }

  if (backend.kind === 'json') {
    // ------------------------------------------------------------- 15
    section('a corrupt JSON file is moved aside, not overwritten');
    {
      await server.kill();
      const garbage = '{"p_existing": {"wins": 40, THIS IS NOT JSON';
      writeFileSync(joinPath(backend.dir, 'profiles.json'), garbage);
      await server.start();
      const aside = readdirSync(backend.dir).filter((f) => f.startsWith('profiles.json.corrupt-'));
      check('the bad file was moved aside', aside.length, 1);
      check('  with its bytes intact', aside[0] && readFileSync(joinPath(backend.dir, aside[0]), 'utf8'), garbage);
      const tab = await enter({ playerId: 'p_new_after_corrupt' });
      check('the server still runs and admits players', tab.refused, false);
      await tab.leave();
    }
  }

  await server.kill();
};

// ------------------------------------------------------------------- main
const work = mkdtempSync(joinPath(tmpdir(), 'verify-persistence-'));
try {
  await runSuite(jsonBackend(mkdirOk(joinPath(work, 'json'))), null);

  const bin = process.env.MONGOD_BIN;
  if (bin) {
    const mongod = new Mongod(bin, joinPath(work, 'mongod'));
    await mongod.start();
    const backend = await mongoBackend(mongod.uri, mkdirOk(joinPath(work, 'mongo')), 'MongoDB (own mongod, with outage tests)');
    try {
      await runSuite(backend, mongod);
    } finally {
      await backend.close();
      await mongod.kill();
    }
  } else if (process.env.MONGODB_URI) {
    const backend = await mongoBackend(process.env.MONGODB_URI, mkdirOk(joinPath(work, 'mongo')), 'MongoDB at MONGODB_URI (no outage tests)');
    try {
      await runSuite(backend, null);
    } finally {
      await backend.close();
    }
  } else {
    console.log('\n(MongoDB NOT tested: set MONGOD_BIN - or MONGODB_URI, which is WIPED - to include it.)');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

section('server logs');
{
  const text = allLogs.join('');
  const unhandled = text
    .split(/\r?\n/)
    .filter((line) => /Unhandled|uncaught|TypeError|ReferenceError|SyntaxError|RangeError/i.test(line));
  check('no unhandled errors in any server log', unhandled.length === 0 ? 'none' : unhandled.slice(0, 5).join(' | '), 'none');
  check(
    'joins are logged as ACCOUNT when verified',
    /as ACCOUNT bloxity:acct_new/.test(text),
    true,
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);

function mkdirOk(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}
