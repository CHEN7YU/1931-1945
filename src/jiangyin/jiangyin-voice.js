const WOUND_LINES = Object.freeze(['jiangyin-player-wounded-1', 'jiangyin-player-wounded-2']);
const HIT_LINES = Object.freeze(['jiangyin-player-bark-1', 'jiangyin-player-bark-2']);
const VARIANTS = 3;

function randomIndex(random, length) {
  return Math.min(length - 1, Math.floor(Math.max(0, Math.min(.999999999, random())) * length));
}

export function createJiangyinVoiceReactions(random = Math.random) {
  let lastWoundAt = -Infinity, lastHitAt = -Infinity, firstKillReported = false;
  const select = lines => ({ cue: lines[randomIndex(random, lines.length)], variant: randomIndex(random, VARIANTS) });
  const firstKill = () => {
    if (firstKillReported) return null;
    firstKillReported = true;
    return select(['jiangyin-player-first-kill']);
  };

  return Object.freeze({
    wounded(now, health) {
      if (health <= 0 || now - lastWoundAt < 30) return null;
      lastWoundAt = now;
      return select(WOUND_LINES);
    },
    firstKill,
    troopHit(now, isFirstKill = false) {
      if (isFirstKill) return firstKill();
      if (now - lastHitAt < 14) return null;
      lastHitAt = now;
      return select(HIT_LINES);
    },
  });
}
