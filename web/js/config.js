// 調整値をここに集約する。
export const CONFIG = {
  // ---------- REFUTE(矛盾する Pair を消す) ----------
  refute: {
    score: {
      pairBase: 10,          // 1 Pair の基礎点(Bonus を足してから倍率)
      rowClear: 100,         // 行が消えたとき: rowClear × 行数^2 × 倍率
      stageClear: 200,
      perfect: 500,          // SHUFFLE なしで Clear
      shuffleSaved: 150,     // 残した SHUFFLE 1 回ごと
      gapPerCell: 5,         // 2 つの間の空マス 1 つごと
      diagonal: 10,
      vertical: 5,
      complexity: 4,         // 式の結合子 1 つごと(難しい式ほど加点)
      hintWhenStuck: 100,    // Pair が無いのに Hint
      blindHintPenalty: 300, // SHUFFLE も無いのに Hint
      giveUpKeepRatio: 0.5,
    },
    chain: { step: 0.5, max: 10.0, decayGraceMs: 6000, decayStepMs: 2000 },   // 論理は読む時間が要るので Number Match より長め
    fever: { durationMs: 12000, pointMult: 2, endChainRatio: 0.5 },
    speed: { fastMs: 1500, quickMs: 3500, fastMult: 1.5, quickMult: 1.2 },
    stuck: { shuffleKeepRatio: 0.5 },
    rank: { perCell: 50, S: 2.0, A: 1.4, B: 0.9 },
    lives: { start: 3, max: 3, perfectRecover: 1 },
    worldSize: 5,
  },
  // ---------- DERIVE(推論して Goal を作る) ----------
  derive: {
    worldSize: 5,
    stars: { perfectExtra: 0, goodExtra: 2 },   // 手数が par 以内で ★★★、par+2 以内で ★★、それ以外 ★
    score: { base: 1000, perMoveOver: 100, hintCost: 150 },   // 参考スコア: base − 超過手数 × perMoveOver − Hint
  },
  fx: {
    particlesPerRemove: 22,
    particlesPerRow: 110,
    shakeBase: 2.5,
    maxParticles: 900,
    hitStopMs: 90,
  },
  audio: { masterVolume: 0.35 },
  storageKey: 'logicmatch.v1',
};
