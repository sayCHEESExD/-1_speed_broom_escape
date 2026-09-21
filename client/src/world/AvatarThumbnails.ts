/**
 * Bloxity profile pictures, loaded once each and drawable onto a canvas.
 *
 * Loaded with `crossOrigin = 'anonymous'`: a picture drawn onto a canvas that
 * is then uploaded as a WebGL texture MUST have been served with CORS, or the
 * upload throws and the whole board goes blank. Bloxity's thumbnail CDN
 * (static.bloxity.io) answers `Access-Control-Allow-Origin: *`; a picture from
 * anywhere that does not simply fails to load here, and is drawn as a
 * silhouette instead - it can never taint a canvas, because a CORS-less image
 * never reaches `onload` in anonymous mode.
 *
 * One cache for the page, keyed by URL, so nine rows on three boards showing
 * the same player decode the picture once.
 */

type Entry =
  | { readonly state: 'loading'; readonly image: HTMLImageElement }
  | { readonly state: 'ready'; readonly image: HTMLImageElement }
  | { readonly state: 'failed' };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** The loaded picture for a URL, or null while loading, failed, or ''. */
export const thumbnail = (url: string): HTMLImageElement | null => {
  if (!url) return null;
  const entry = cache.get(url);
  if (entry) return entry.state === 'ready' ? entry.image : null;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  cache.set(url, { state: 'loading', image });
  image.onload = () => {
    cache.set(url, { state: 'ready', image });
    for (const listener of listeners) listener();
  };
  image.onerror = () => {
    cache.set(url, { state: 'failed' });
  };
  image.src = url;
  return null;
};

/** Be told whenever a picture finishes loading. Returns the unsubscribe. */
export const onThumbnailLoaded = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Draw a player's picture into a circle - or, with no picture, a plain
 * head-and-shoulders silhouette in `ink`, so a row without one still lines up
 * with the rows that have one.
 */
export const drawThumbnail = (
  ctx: CanvasRenderingContext2D,
  url: string,
  cx: number,
  cy: number,
  radius: number,
  backing: string,
  ink: string,
  rim: string,
): void => {
  const image = thumbnail(url);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = backing;
  ctx.fill();
  ctx.clip();
  if (image) {
    // The picture is square; cover the circle, centred.
    ctx.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.22, radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + radius * 0.78, radius * 0.72, radius * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.strokeStyle = rim;
  ctx.stroke();
};
