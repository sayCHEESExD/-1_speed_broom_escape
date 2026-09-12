import { COURSE, STAGES, formatSpeed } from '@broom/shared';
import { Group } from 'three';
import { CanvasSign } from './CanvasSign.js';

/**
 * The LARGE sign at the head of each stage.
 *
 * "STAGE 1 ESCAPE" over the mouth of the first stage, "STAGE 2 SPIKE VAULT"
 * over the second, and so on - the stage number and its name on ONE line,
 * which is what makes it a name rather than a heading with a subtitle. Under
 * it sit the three advisory figures: the difficulty word, the level the stage
 * was built around, and the FLIGHT the stage was built around.
 *
 * That last line is the one this game needed and the previous one did not. A
 * player standing at the gate of stage twelve wants to know two things before
 * they commit to it, and "level 74" only answers one of them: the other is
 * whether the broom they are on holds enough seconds to cross what is in
 * there. Advertising both means the shop and the gate are talking about the
 * same ladder.
 *
 * Everything here is ADVISORY and always has been - nothing gates a stage,
 * because a player who wants to try a run they are under-equipped for should
 * be allowed to fail at it.
 */
export class StageSigns {
  readonly root = new Group();

  private readonly signs: CanvasSign[] = [];

  constructor() {
    for (const stage of STAGES) {
      const sign = new CanvasSign(50, 17, [
        {
          // ONE line, and a big one. This is the sign the stage is known by.
          text: `STAGE ${stage.index} ${stage.name.toUpperCase()}`,
          size: 1.5,
          fill: '#ffffff',
          stroke: '#3a2a6a',
          strokeWidth: 0.2,
        },
        {
          text: stage.difficulty,
          size: 0.8,
          fill: '#d46bff',
          stroke: '#2a1240',
        },
        {
          // BOTH figures, because a level means nothing to a player looking at
          // a Speed counter. The Speed is derived from the level through the
          // curve the player actually levels on, so the two lines here can
          // never advertise different things.
          text: `Recommended Level ${stage.recommendedLevel} · ${formatSpeed(stage.recommendedSpeed)} Speed`,
          size: 0.5,
          fill: '#ffffff',
          stroke: '#22243f',
        },
        {
          text: `Recommended Flight ${stage.recommendedFly}s`,
          size: 0.5,
          fill: '#b48bff',
          stroke: '#1c1030',
        },
      ]);

      // Hung over the run-up, facing back down the course at the approaching
      // player rather than flat against the far wall.
      sign.mesh.position.set(0, COURSE.floorY + 16, stage.startZ + 12);
      sign.mesh.rotation.y = Math.PI;
      this.root.add(sign.mesh);
      this.signs.push(sign);
    }
  }

  dispose(): void {
    for (const sign of this.signs) sign.dispose();
    this.signs.length = 0;
    this.root.removeFromParent();
  }
}
