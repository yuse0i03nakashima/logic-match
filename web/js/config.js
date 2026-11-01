// 調整値をここに集約する。
export const CONFIG = {
  // ---------- REFUTE(矛盾する Pair を消す) ----------
  refute: {
    score: {
      pairBase: 10,          // 1 Pair の基礎点。得点 = 基礎点 × 難しさ倍率 × Chain 倍率 × Speed 倍率(× FEVER)
      rowClear: 100,         // 行が消えたとき: rowClear × 行数^2 × Chain 倍率
      stageClear: 200,
      perfect: 500,          // SHUFFLE なしで Clear
      shuffleSaved: 150,     // 残した SHUFFLE 1 回ごと
      hintSaved: 50,         // 残した Hint 1 回ごと
      hintedPairRatio: 0.5,  // HINT で示された Pair を消したときの得点の割合
      hintWhenStuck: 100,    // Pair が無いのに Hint
      blindHintPenalty: 300, // SHUFFLE も無いのに Hint
      giveUpKeepRatio: 0.5,
    },
    // 難しい消し方の倍率(Pair の得点に掛ける)
    difficulty: {
      vertical: 1.2,
      diagonal: 1.5,
      gapPerCell: 0.25,      // 2 つの間の空マス 1 つごと
      diagonalGapPerCell: 0.5,
      perConnective: 0.1,    // 式の結合子 1 つごと(複雑な式ほど加点)
      complexFrom: 3,        // 2 式の結合子の合計がこれ以上なら COMPLEX 表示
    },
    chain: { step: 1.0, max: 10.0, decayGraceMs: 8000, decayStepMs: 3000 },   // 論理式は読む時間が要るので THE TEN より長め
    fever: { durationMs: 12000, pointMult: 2, endChainRatio: 0.5, hintTimeCostMs: 3000 },
    hint: {
      perStage: 3,
      flashFrom: 4.0,
      scopeFrom: 8.0,
      flashMs: 2000,         // 式を読む時間を見て THE TEN より長め
      flashGaugeRatio: 0.5,
      scopeMissChain: 3,
      scopeBreakRatio: 0.5,
      stuckKeepRatio: 0.5,
    },
    speed: { fastMs: 1500, quickMs: 3500, fastMult: 1.5, quickMult: 1.2 },
    stuck: { shuffleKeepRatio: 0.5 },
    rank: { perCell: 100, S: 2.0, A: 1.4, B: 0.9 },
    lives: { start: 3, max: 3, perfectRecover: 1 },
    worldSize: 5,
  },
  // ---------- DERIVE(推論して Goal を作る) ----------
  derive: {
    worldSize: 5,
    stars: { perfectExtra: 0, goodExtra: 2 },   // 手数が par 以内で ★★★、par+2 以内で ★★、それ以外 ★
    score: { base: 1000, perMoveOver: 100, hintCost: 150 },
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
