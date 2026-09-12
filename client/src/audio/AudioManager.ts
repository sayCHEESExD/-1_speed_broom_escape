import { logger } from '../util/logger.js';

const SCOPE = 'audio';

/** Master volumes per category. Music sits well under the gameplay sounds. */
const MUSIC_GAIN = 0.55;
const SFX_GAIN = 0.34;

/*
 * THERE IS NO MUSIC IN THIS GAME, and that is a deliberate decision rather
 * than an unfinished one.
 *
 * The previous game streamed a supplied track through `musicBus`. This one
 * ships no audio files at all: no track, and no sampled one-shots either. Every
 * sound below is synthesised from oscillators, which costs bytes measured in
 * hundreds against a 12 MB budget.
 *
 * `musicBus` itself is KEPT. It is what the portal's `music_volume` slider is
 * wired to, and a slider that silently controlled nothing would be worse than
 * one that controls a bus with no voice on it - the day a track is added, it
 * is one `startMusic` away and every volume control already works on it.
 */

/**
 * Most one-shot voices allowed to sound at once.
 *
 * A ceiling rather than a hope. Web Audio nodes are one-shot by design - a
 * source cannot be replayed, so every sound is a new node - and the thing that
 * has to be bounded is therefore how many are alive at any moment, not how
 * many are ever made. Beyond this, a request is dropped rather than queued:
 * the twelfth simultaneous thrust beat is inaudible anyway.
 */
const MAX_VOICES = 12;

/** Keep a slider inside 0..1 whatever the portal sent. */
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;

/** Seconds a given sound refuses to retrigger, so nothing can machine-gun. */
const COOLDOWNS: Readonly<Record<SoundName, number>> = {
  jump: 0.12,
  land: 0.14,
  step: 0.05,
  // Long, because running dry is a once-per-crossing event and hearing it
  // twice would suggest it had happened twice.
  drained: 0.8,
  death: 0.6,
  win: 0.4,
  level: 0.4,
  rebirth: 0.8,
  claim: 0.3,
};

export type SoundName =
  /** Takeoff: the frame thrust lifts the broom off the ground. */
  | 'jump'
  /** Touchdown. */
  | 'land'
  /** The thrust loop, while the meter is being spent. */
  | 'step'
  /** The meter reaching zero under a held key. */
  | 'drained'
  | 'death'
  | 'win'
  | 'level'
  | 'rebirth'
  | 'claim';

/**
 * Every sound in the game, synthesised.
 *
 * EVERY sound is synthesised - oscillators and envelopes cost bytes measured
 * in the hundreds, and a pack of wavs is the easiest way to spend the 12 MB
 * budget. There is no music and there are no samples: this build ships not one
 * audio file.
 *
 * THREE rules hold the whole thing together:
 *
 *  - ONE context, ONE music voice. There is no track yet, and the structure
 *    that would hold one - the `started` flag, `musicBus`, the single
 *    `startMusic` call - is kept so that adding one can never start two.
 *  - ONE-SHOTS ARE BOUNDED, twice: a per-sound cooldown stops the same effect
 *    retriggering every frame, and a hard voice ceiling stops the mix from
 *    ever containing more than a dozen of them.
 *  - ONLY THE LOCAL PLAYER makes noise. A busy server would otherwise put the
 *    thrust, the takeoff and the death of every other rider into a mix the
 *    player is trying to hear their own broom in.
 *
 * Nothing here starts until the player's first gesture: browsers refuse to run
 * an AudioContext before one, and a context created earlier merely sits
 * suspended and confuses everything downstream.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  /** Live one-shot voices, so the ceiling can be enforced. */
  private voices = 0;
  /** Wall-clock of the last play, per sound. */
  private readonly lastPlayed = new Map<SoundName, number>();

  /**
   * The music, as a streaming element rather than a decoded buffer.
   *
   * `decodeAudioData` would hold the whole track in memory uncompressed - a
   * three-minute stereo file is over thirty megabytes once decoded, for
   * something that is only ever played start to finish. An element streams it,
   * loops it natively, and still routes through Web Audio, which is what keeps
   * the portal's music slider and the mute working.
   */
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;

  /**
   * Decoded one-shot samples, by name.
   *
   * A sound is only in here once it has actually decoded, which is what makes
   * the fallback in `play` a simple lookup: until then - and for ever, if the
   * file is missing or the fetch is blocked - the synthesised voice is used
   * instead, so a blocked asset is a different sound rather than silence.
   */
  private readonly samples = new Map<SoundName, AudioBuffer>();
  /** Set once the fetches have been kicked off, so they happen exactly once. */
  private samplesRequested = false;

  /**
   * The sampled sound currently playing, per name. At most ONE each.
   *
   * The cooldowns were tuned against the synthesised voices, every one of which
   * was SHORTER than its own cooldown - the death lasted 0.5s behind a 0.6s
   * cooldown - so a one-shot could never catch its own tail. The recorded files
   * are far longer (both about 1.8s), which quietly breaks that: two deaths
   * 0.7s apart would clear the cooldown and sound on top of each other, and
   * jumps would stack until they hit the voice ceiling.
   *
   * So a sampled sound REPLACES itself rather than layering. The trigger and
   * the gain are untouched - every jump still plays the jump - it simply
   * restarts instead of doubling, which is what keeps "no overlapping deaths"
   * true now that the sound outlasts its cooldown.
   */
  private readonly activeSamples = new Map<SoundName, AudioBufferSourceNode>();

  private muted = false;
  private started = false;

  /** The portal's master and music sliders, 0..1. Both default to full. */
  private masterLevel = 1;
  private musicLevel = 1;

  /**
   * Bring the audio up, on a real user gesture.
   *
   * Safe to call repeatedly - it is wired to every gesture precisely because
   * no single one of them is guaranteed to be the one the browser accepts.
   */
  resume(): void {
    if (this.muted) return;
    if (!this.context) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
      } catch (error) {
        logger.warn(SCOPE, `no audio context: ${String(error)}`);
        return;
      }

      this.master = this.context.createGain();
      // Built at the level the portal has ALREADY set: settings arrive before
      // the first user gesture, so a context created at full volume would be
      // loud for exactly as long as it took the next slider change to arrive.
      this.master.gain.value = this.muted ? 0 : this.masterLevel;
      this.master.connect(this.context.destination);

      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = MUSIC_GAIN * this.musicLevel;
      this.musicBus.connect(this.master);

      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = SFX_GAIN;
      this.sfxBus.connect(this.master);
    }

    void this.context.resume().catch(() => undefined);

    if (!this.started) {
      this.started = true;
      this.startMusic();
      this.loadSamples();
      logger.info(SCOPE, 'audio started');
    }

    // A tab that was backgrounded pauses the element; resuming has to restart
    // it, and `play()` on an already-playing element is a no-op.
    if (this.musicElement && !this.muted) {
      void this.musicElement.play().catch(() => undefined);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Silence everything, or bring it back. The music keeps its own time. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /**
   * The portal's master volume, 0..1.
   *
   * Kept SEPARATE from mute rather than folded into it: they are two different
   * statements - "I set this to 30%" and "silence, now" - and a mute that
   * overwrote the level would hand back the wrong one when it lifted. The
   * master gain is the product of the two, so unmuting restores whatever the
   * slider said.
   */
  setMasterVolume(level: number): void {
    this.masterLevel = clamp01(level);
    this.applyMaster();
  }

  /** The portal's music volume, 0..1, against the game's own tuned mix. */
  setMusicVolume(level: number): void {
    this.musicLevel = clamp01(level);
    if (this.musicBus && this.context) {
      this.musicBus.gain.setTargetAtTime(
        MUSIC_GAIN * this.musicLevel,
        this.context.currentTime,
        0.05,
      );
    }
  }

  private applyMaster(): void {
    if (this.master && this.context) {
      const target = this.muted ? 0 : this.masterLevel;
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
    }

    // A muted stream is PAUSED, not merely silenced. Leaving it running would
    // keep decoding a file nobody can hear, and on a phone that is battery
    // spent on nothing.
    const element = this.musicElement;
    if (!element) return;
    if (this.muted) element.pause();
    else void element.play().catch(() => undefined);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Play a one-shot.
   *
   * Refused if the same sound played within its cooldown, or if the voice
   * ceiling is already reached. Both refusals are silent: a sound that cannot
   * be heard is not an error.
   */
  play(name: SoundName, intensity = 1): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < COOLDOWNS[name]) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    const level = Math.min(Math.max(intensity, 0), 1);
    switch (name) {
      case 'jump':
        // TAKEOFF. A rising sweep, pitch going up being the most direct way a
        // sound can say "up" - and this one has to, because it is the audible
        // half of the confirmation that a held key bought a launch.
        if (this.playSample('jump', now, 0.5 * level)) break;
        this.blip(now, 'square', 300, 720, 0.18, 0.5 * level);
        break;
      case 'land':
        this.thud(now, 0.35 + level * 0.3);
        break;
      case 'step':
        /*
         * THE THRUST LOOP, retriggered while the meter is being spent.
         *
         * The previous game's hoofbeat, repurposed rather than replaced: a
         * soft short thud several times a second is exactly what a broom
         * pushing against the air wants to be, and it is already bounded by
         * the same cadence clamp the hooves needed. Its rate says how hard the
         * broom is working, which is the same thing the bar says and the same
         * thing the nose-up pose says.
         */
        this.thud(now, 0.09 + level * 0.13, 130);
        break;
      case 'drained':
        // The meter hitting zero. A short FALLING sweep - the exact inverse of
        // the takeoff, because it is the exact inverse of the event, and the
        // player needs to hear it without looking down at the bar.
        this.blip(now, 'sawtooth', 520, 180, 0.26, 0.4);
        break;
      case 'death':
        // The recorded death, falling back to the descending sawtooth.
        if (this.playSample('death', now, 0.6)) break;
        this.blip(now, 'sawtooth', 300, 70, 0.5, 0.6);
        break;
      case 'win':
        this.arpeggio(now, [0, 4, 7, 12], 0.09, 'triangle', 0.5);
        break;
      case 'level':
        this.arpeggio(now, [0, 7, 12], 0.07, 'triangle', 0.4);
        break;
      case 'rebirth':
        this.arpeggio(now, [0, 4, 7, 12, 16, 19], 0.08, 'sawtooth', 0.45);
        break;
      case 'claim':
        this.arpeggio(now, [0, 5, 9], 0.06, 'square', 0.35);
        break;
    }
  }

  dispose(): void {
    if (this.musicElement) {
      this.musicElement.pause();
      // Dropping the src releases the network request and the decoder; an
      // element left holding a stream keeps both alive after the game is gone.
      this.musicElement.removeAttribute('src');
      this.musicElement.load();
    }
    this.musicSource?.disconnect();
    this.musicSource = null;
    this.musicElement = null;
    this.samples.clear();
    this.activeSamples.clear();
    this.samplesRequested = false;
    this.started = false;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
  }

  // -------------------------------------------------------------- the music

  /**
   * Start the background track - which this game does not have.
   *
   * Deliberately empty, and deliberately still called. `musicBus` exists and
   * carries the portal's music slider; there is simply no voice on it yet. The
   * call site, the flag that makes a second copy impossible and the whole
   * routing stay in place, so adding a track later is filling this in and
   * nothing else.
   */
  private startMusic(): void {
    // No track. See the note at the top of this file.
  }

  // --------------------------------------------------------- the one-shots

  /**
   * Fetch and decode the sampled one-shots - of which there are none.
   *
   * Every effect in this game is synthesised, so there is nothing to fetch.
   * The method stays because `playSample` and its fallback stay: the shape
   * "use the sample if one decoded, otherwise synthesise" is what makes adding
   * a recorded sound a one-line change rather than a rewrite of `play`.
   */
  private loadSamples(): void {
    // No samples. See the note at the top of this file.
    this.samplesRequested = true;
  }

  /**
   * Play a decoded sample, if one is available.
   *
   * @returns false when nothing was decoded, so the caller synthesises
   *          instead. That fallback is the whole shape of this method: today
   *          nothing is ever decoded and every call returns false, and the day
   *          a recorded sound is added it starts returning true with no change
   *          to `play` at all.
   *
   * A sampled sound REPLACES itself rather than layering. The cooldowns are
   * tuned against the synthesised voices, every one of which is shorter than
   * its own cooldown; a recorded file need not be, so without this two of them
   * could overlap.
   */
  private playSample(name: SoundName, when: number, gain: number): boolean {
    const ctx = this.context;
    const bus = this.sfxBus;
    const buffer = this.samples.get(name);
    if (!ctx || !bus || !buffer) return false;

    this.activeSamples.get(name)?.stop();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const envelope = ctx.createGain();
    envelope.gain.value = gain;
    source.connect(envelope);
    envelope.connect(bus);

    this.voices += 1;
    this.activeSamples.set(name, source);
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      if (this.activeSamples.get(name) === source) this.activeSamples.delete(name);
    };
    source.start(when);
    return true;
  }

  private blip(
    at: number,
    shape: OscillatorType,
    from: number,
    to: number,
    length: number,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, length);
  }

  /** A push against the air: a short filtered noise burst with a low thump. */
  private thud(at: number, gain: number, frequency = 150): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.45, at + 0.09);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, 0.12);
  }

  private arpeggio(
    at: number,
    semitones: readonly number[],
    step: number,
    shape: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    for (let i = 0; i < semitones.length; i += 1) {
      if (this.voices >= MAX_VOICES) return;
      const osc = ctx.createOscillator();
      osc.type = shape;
      osc.frequency.value = 440 * 2 ** ((semitones[i] as number) / 12);

      const start = at + i * step;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(gain, start + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + step * 2.2);

      osc.connect(envelope);
      envelope.connect(bus);
      this.hold(osc, envelope, start, step * 2.2);
    }
  }

  /**
   * Start a voice, count it, and make sure it is uncounted exactly once.
   *
   * The counting is the whole reason `MAX_VOICES` means anything: a node that
   * started without being counted, or one that ended without being uncounted,
   * would leave the ceiling either useless or permanently closed.
   */
  private hold(
    osc: AudioScheduledSourceNode,
    envelope: GainNode,
    at: number,
    length: number,
    onDone?: () => void,
  ): void {
    this.voices += 1;
    osc.start(at);
    osc.stop(at + length + 0.02);
    osc.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      osc.disconnect();
      envelope.disconnect();
      onDone?.();
    };
  }
}
