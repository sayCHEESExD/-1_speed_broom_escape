import {
  GUEST_FALLBACK_NAME,
  LEADERBOARD_SIZE,
  PLAYER_FALLBACK_NAME,
  cleanDisplayName,
} from '@broom/shared';
import { ACCOUNT_PREFIX } from './Profiles.js';
import type { LeaderEntry, LeaderboardState } from '../rooms/state/CourseState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { profileStore } from './ProfileStore.js';

/** Seconds between rebuilds. A board is not a thing that needs 20 Hz. */
const REFRESH_SECONDS = 2;

/** One candidate, before it is ranked. */
interface Candidate {
  /** The player's Bloxity display name - what the row SHOWS. */
  readonly name: string;
  /** Their Bloxity profile picture URL, '' for none. */
  readonly pfp: string;
  readonly wins: number;
  readonly speed: number;
  readonly rebirths: number;
}

/**
 * The three boards on the spawn wall.
 *
 * Every figure is the SERVER's. Clients are never asked what their totals are
 * and could not usefully lie if they were: the numbers come from the same
 * `PlayerState` the rewards are paid into, and from the profile store for
 * everyone who is not currently connected.
 *
 * Merging those two is the whole job. A live player's state is fresher than
 * their saved profile - Speed accrues continuously and is only written out
 * every few seconds - so the live figure wins wherever both exist, or a player
 * would watch the board show a total they passed a minute ago.
 *
 * Rebuilt on a timer rather than per tick. Sorting every profile on the server
 * twenty times a second to feed a sign on a wall would be the most expensive
 * thing in the room, and nobody can read it that fast.
 */
export class LeaderboardService {
  private timer = 0;

  /** Rebuild if it is time. Returns true when the state was rewritten. */
  update(
    delta: number,
    board: LeaderboardState,
    live: Iterable<[string, PlayerState]>,
    playerIds: ReadonlyMap<string, string>,
  ): boolean {
    this.timer -= delta;
    if (this.timer > 0) return false;
    this.timer = REFRESH_SECONDS;
    this.rebuild(board, live, playerIds);
    return true;
  }

  /** Force a rebuild now, e.g. the moment someone banks a stage. */
  rebuild(
    board: LeaderboardState,
    live: Iterable<[string, PlayerState]>,
    playerIds: ReadonlyMap<string, string>,
  ): void {
    /*
     * Keyed by PROFILE KEY - the internal id a player's progress is saved
     * under - so a live player and their stored copy are one row, and two
     * players who happen to share a display name are two. The key itself is
     * never shown: every row shows the Bloxity display name and picture.
     */
    const byKey = new Map<string, Candidate>();

    for (const [key, profile] of profileStore.entries()) {
      byKey.set(key, {
        // A profile saved before names were stored has none; it is still a
        // real player, shown generically until they next play.
        name:
          cleanDisplayName(profile.displayName) ||
          (key.startsWith(ACCOUNT_PREFIX) ? PLAYER_FALLBACK_NAME : GUEST_FALLBACK_NAME),
        pfp: typeof profile.pfp === 'string' ? profile.pfp : '',
        wins: profile.wins,
        speed: profile.totalSpeed,
        rebirths: profile.rebirths,
      });
    }

    // Live state last, so it overwrites the stored copy of the same player -
    // including their name and picture, which the server refreshes from
    // Bloxity while they are online.
    for (const [sessionId, player] of live) {
      const key = playerIds.get(sessionId);
      if (!key) continue;
      byKey.set(key, {
        name: player.displayName || GUEST_FALLBACK_NAME,
        pfp: player.pfp,
        wins: player.wins,
        speed: player.totalSpeed,
        rebirths: player.rebirths,
      });
    }

    const all = [...byKey.values()];
    fill(board.wins, all, (c) => c.wins);
    fill(board.speed, all, (c) => c.speed);
    fill(board.rebirths, all, (c) => c.rebirths);
  }
}

/**
 * Rank by one field and write the top N into a replicated array.
 *
 * The array is REUSED rather than rebuilt: Colyseus sends a patch per changed
 * field, and clearing an array of nine and pushing nine fresh entries every two
 * seconds would send the whole board to every client whether or not anything
 * about it had moved.
 */
const fill = (
  into: LeaderEntry[] & { push(entry: LeaderEntry): unknown },
  all: readonly Candidate[],
  pick: (candidate: Candidate) => number,
): void => {
  const ranked = all
    .filter((candidate) => pick(candidate) > 0)
    .sort((a, b) => pick(b) - pick(a))
    .slice(0, LEADERBOARD_SIZE);

  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) {
    const entry = into[i];
    if (!entry) continue;
    const candidate = ranked[i];
    const name = candidate ? candidate.name : '';
    const pfp = candidate ? candidate.pfp : '';
    const value = candidate ? Math.floor(pick(candidate)) : 0;
    // Assign only on a real change, for the same reason as above: an identical
    // write still counts as a change to the schema encoder.
    if (entry.name !== name) entry.name = name;
    if (entry.pfp !== pfp) entry.pfp = pfp;
    if (entry.value !== value) entry.value = value;
  }
};

export const leaderboardService = new LeaderboardService();
