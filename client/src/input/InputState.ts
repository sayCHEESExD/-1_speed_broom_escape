/** Normalised, device-agnostic input snapshot consumed by the player controller. */
export interface InputState {
  /** -1 (left) .. 1 (right), camera-relative. */
  moveX: number;
  /** -1 (back) .. 1 (forward), camera-relative. */
  moveZ: number;
  /**
   * The thrust control (Space, or the on-screen FLY button), HELD.
   *
   * Still called `jump` because it is the same wire field and the same key,
   * but a broom does not hop: held it launches and then flies, released it
   * does nothing at all. It is a LEVEL rather than an edge for that reason -
   * an edge would let go of the thrust the frame after it began.
   */
  jump: boolean;
  sprint: boolean;
}

export const createInputState = (): InputState => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  sprint: false,
});
