/**
 * What a player is CALLED on screen, and the picture shown beside it.
 *
 * Both come from BLOXITY, never from this game: a signed-in player is shown
 * by their Bloxity display name and profile picture exactly as Bloxity's own
 * token-verify reply states them, and a guest by the guest identity Bloxity's
 * SDK mints (a name like "Comet42" and a picture of their guest avatar). This
 * game has no identity system of its own and must not grow one.
 *
 * What is NEVER shown: the Bloxity `username` handle as an `@handle`, the
 * account id, the profile key, the guest's browser id, or anything derived
 * from them. Those stay internal, for networking and persistence.
 *
 * These helpers only CLEAN and VALIDATE; they decide nothing about who a
 * player is. The server runs them on everything it accepts, and the client
 * runs them again on everything it draws.
 */

/** Longest name shown. Bloxity's own names fit well inside this. */
export const DISPLAY_NAME_MAX = 32;

/** Longest profile-picture URL accepted. */
export const PFP_URL_MAX = 512;

/** Shown for a guest whose Bloxity guest identity has not arrived yet. */
export const GUEST_FALLBACK_NAME = 'Guest';

/** Shown for a signed-in player whose Bloxity profile carried no name at all. */
export const PLAYER_FALLBACK_NAME = 'Player';

/**
 * Tidy a display name for showing: trimmed, whitespace runs collapsed,
 * control and bidi-override characters removed, and length-capped.
 *
 * NOT a filter on what the name says - Bloxity owns that. This only stops a
 * name from breaking the layout it is drawn into or reordering the text
 * around it. Returns '' for anything that is not a usable string.
 */
export const cleanDisplayName = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    // C0/C1 controls, zero-width and bidi-override characters.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join('');
};

/**
 * The name Bloxity's verify reply gives a signed-in player.
 *
 * `displayName` first, as Bloxity's own UI does; the bare `username` only
 * when an account has no display name - and even then WITHOUT an `@`.
 */
export const accountDisplayName = (displayName: unknown, username: unknown): string =>
  cleanDisplayName(displayName) || cleanDisplayName(username) || PLAYER_FALLBACK_NAME;

/**
 * Whether a name has the shape Bloxity's SDK gives GUESTS: one capitalised
 * word and up to two digits, e.g. "Comet42" (`generateGuestName` in the SDK).
 *
 * A guest's name is minted in their own browser, so it is the one name the
 * server has to take on trust. Holding it to this shape is what stops a
 * signed-out player from calling themselves "Chicken 877" and passing as a
 * real account: a guest can only ever pick another guest-shaped name.
 */
export const isBloxityGuestName = (name: string): boolean => /^[A-Z][a-z]{1,11}\d{1,2}$/.test(name);

/**
 * A profile picture URL that is safe to hand to every client's image loader.
 *
 * Signed-in players: any https URL, because it came from Bloxity's own verify
 * reply, server to server.
 * Guests: only a picture on Bloxity's own avatar-thumbnail CDN, because a
 * guest's picture URL was sent by their browser - so a guest can show their
 * own guest avatar and nothing else.
 *
 * Returns '' for anything else, which every renderer draws as a plain
 * silhouette.
 */
export const cleanPfpUrl = (raw: unknown, source: 'account' | 'guest'): string => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > PFP_URL_MAX) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  if (source === 'guest') {
    if (url.hostname !== BLOXITY_PFP_HOST || !url.pathname.startsWith('/img/pfps/')) return '';
  }
  return url.toString();
};

/** Where Bloxity serves avatar thumbnails from (`PFP_STATIC_URL` in the SDK). */
export const BLOXITY_PFP_HOST = 'static.bloxity.io';

/** How many places each board shows. Matches the reference art's nine rows. */
export const LEADERBOARD_SIZE = 9;
