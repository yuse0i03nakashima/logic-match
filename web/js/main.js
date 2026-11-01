// 起点。面データを読み、2 つのモード(REFUTE / DERIVE)と画面・演出・音をつなぐ。
// 入力 → game.*() → イベントの配列 → handle() で振り分ける。

import { CONFIG } from './config.js';
import { Progress, RefuteGame, DeriveGame } from './game.js';
import { Renderer } from './render.js';
import { FX, heatColor, PALETTE } from './fx.js';
import { Sound, vibrate } from './audio.js';
import { Bgm } from './bgm.js';
import { pretty, refutePairs } from './logic.js';

const fmt = (n) => n.toLocaleString('en-US');
const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RULE_JA = {
  MP: '前件肯定', MT: '後件否定', DS: '選言三段論法', ANDI: '∧ 導入', ANDE: '∧ 除去', BOT: '矛盾',
};

async function boot() {
  const [refuteStages, deriveStages] = await Promise.all([
    fetch('levels/refute.json').then((r) => r.json()),
    fetch('levels/derive.json').then((r) => r.json()),
  ]);
  const progress = new Progress(CONFIG.storageKey);
  const refute = new RefuteGame(refuteStages, CONFIG.refute, progress);
  const derive = new DeriveGame(deriveStages, CONFIG.derive, progress);
  const ui = new Renderer(document);
  const fx = new FX(document.getElementById('fx'), CONFIG.fx);
  const sound = new Sound(CONFIG.audio.masterVolume);
  const bgm = new Bgm(CONFIG.bgm);
  // 最初のタップで AudioContext ができたら BGM をつなぐ(ensure は何度呼んでもよい)
  const ensureAudio = () => { if (sound.ensure()) bgm.attach(sound.ctx); };
  // 拍に合わせて背景を脈打たせる
  (function beat() { document.documentElement.style.setProperty('--beat', bgm.level().toFixed(2)); requestAnimationFrame(beat); })();
  const app = document.getElementById('app');
  let mode = null;        // 'refute' | 'derive'
  let busy = false;
  let lineStreak = 0;
  const overlayOpen = () => document.getElementById('overlay').hidden === false;

  function punch() {
    app.classList.remove('punch'); void app.offsetWidth; app.classList.add('punch');
    document.body.classList.remove('gridflash'); void document.body.offsetWidth; document.body.classList.add('gridflash');
  }
  function soundLabel() { document.getElementById('btn-sound-state').textContent = sound.enabled ? 'sound on' : 'sound off'; }

  // ---------- 描き直し ----------
  function redraw(opts = {}) {
    if (mode === 'refute') {
      const st = refute.stage; if (!st) return;
      ui.fitCells(refute.width);
      const flashPairs = st.flashUntil !== null && Date.now() < st.flashUntil ? refutePairs(st.board, refute.width) : null;
      ui.renderBoard(st.board, { selected: st.selected, hintPair: st.hintPair, flashPairs, scopeTile: st.scope?.tile ?? null, ...opts });
      ui.hudRefute(refute);
    } else if (mode === 'derive') {
      const c = derive.cur; if (!c) return;
      ui.fitCells(derive.width);
      ui.renderBoard(c.cells, { selected: c.selected, hintMove: c.hintMove, ...opts });
      ui.hudDerive(derive);
    }
  }

  // ---------- 時間(REFUTE の Chain ゲージと FEVER) ----------
  setInterval(() => {
    // BGM: REFUTE は Chain の熱と FEVER に合わせ、DERIVE は落ち着いた音にする。Title では止める
    if (mode === 'refute' && refute.stage?.status === 'play') { bgm.setHeat(refute.heat); bgm.setFever(refute.inFever); bgm.play('normal'); }
    else if (mode === 'derive' && derive.cur?.status === 'play') { bgm.setFever(false); bgm.setHeat(0.35); bgm.play('normal'); }
    else if (mode === null) bgm.stop();
    bgm.duck(overlayOpen());
    if (mode !== 'refute' || !refute.stage || refute.stage.status !== 'play' || overlayOpen()) return;
    const events = refute.tick(Date.now());
    if (events.length) handleRefute(events); else ui.hudRefute(refute, Date.now());
  }, 200);

  // ======================================================================
  // REFUTE
  // ======================================================================
  async function handleRefute(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'select': ui.selectCell(ev.pos); sound.select(); vibrate(8); break;
        case 'deselect': ui.cellEl(ev.pos)?.classList.remove('selected'); sound.deselect(); break;
        case 'invalid': {
          ui.cellEl(ev.from)?.classList.remove('selected');
          ui.shakeCell(ev.to);
          sound.invalid(); vibrate([20, 30, 20]);
          const a = refute.stage.board[ev.from], b = refute.stage.board[ev.to];
          if (ev.reason === 'satisfiable' && a && b) ui.toast(`${pretty(a)} と ${pretty(b)} は同時に成り立つ`, 1600);
          else if (ev.reason === 'position') ui.toast('一直線上で、間が空いていないと選べない', 1600);
          break;
        }
        case 'remove': await onRemove(ev); break;
        case 'feverStart': {
          sound.feverStart(); vibrate([60, 40, 60, 40, 150]);
          fx.flash('rgba(240,98,146,0.35)'); fx.fireworks(5); punch();
          fx.floatText(innerWidth / 2, innerHeight * 0.4, 'FEVER!!', { color: PALETTE.rose, size: 44, dy: -40, life: 1.6 });
          ui.hudRefute(refute);
          break;
        }
        case 'feverEnd': sound.feverEnd(); ui.toast(`FEVER 終了 … Chain ×${ev.mult.toFixed(1)}`, 2000); ui.hudRefute(refute); break;
        case 'chainDecay': sound.chainDecay(); ui.hudRefute(refute); if (ev.chain === 0) ui.toast('Chain が途切れた … ×1.0', 1500); break;
        case 'noHints': ui.toast('Hint の使用上限に達した'); sound.invalid(); break;
        case 'noHint': {
          lineStreak = 0; redraw();
          ui.toast(ev.blind ? `Pair はもう無く、SHUFFLE も無かった… −${fmt(ev.penalty)}` : `Pair はもう無い… −${ev.penalty}、Chain ×${ev.mult.toFixed(1)}　SHUFFLE で並べ替えよう`, 2800);
          fx.flash('rgba(239,68,68,0.15)'); sound.stuck(); vibrate([30, 30, 30]);
          break;
        }
        case 'flash': {
          sound.flash();
          redraw({ flashPairs: ev.pairs });
          for (const [a, b] of ev.pairs) { const ca = ui.cellCenter(a), cb = ui.cellCenter(b); if (ca && cb) fx.flashLine(ca.x, ca.y, cb.x, cb.y, PALETTE.amber, 2); }
          ui.toast(`FLASH: 消せる Pair ${ev.pairs.length} 組`, CONFIG.refute.hint.flashMs);
          break;
        }
        case 'flashEnd': redraw(); break;
        case 'scope': {
          sound.scope(); redraw();
          const c = ui.cellCenter(ev.tile);
          if (c) { fx.ring(c.x, c.y, PALETTE.red, 70); fx.burst(c.x, c.y, { color: PALETTE.red, count: 16, power: 0.6 }); }
          ui.toast(`SCOPE: ${pretty(refute.stage.board[ev.tile])} と矛盾する相手を探せ(残り Pair ${ev.remaining})`, 2800);
          break;
        }
        case 'scopeMiss': {
          sound.scopeMiss(); vibrate([40, 30, 40]); fx.flash('rgba(239,68,68,0.2)'); ui.hudRefute(refute);
          ui.toast(ev.misses === 1 ? `外した… Chain −${CONFIG.refute.hint.scopeMissChain} (×${ev.mult.toFixed(1)})` : `2 回目… Chain 半分 (×${ev.mult.toFixed(1)})、SCOPE 終了`, 2200);
          break;
        }
        case 'scopeEnd': {
          if (ev.reason === 'ignored') ui.toast(`光ったタイルを使わなかった… Chain 半分 (×${ev.mult.toFixed(1)})`, 2400);
          redraw();
          break;
        }
        case 'shuffle': {
          lineStreak = 0; sound.add(); vibrate(25);
          redraw({ born: null });
          ui.board.querySelectorAll('.cell:not(.empty)').forEach((el, k) => { el.classList.add('added'); el.style.animationDelay = `${Math.min(0.5, k * 0.02)}s`; });
          if (ev.stuckBefore && ev.chainBefore > 0) ui.toast(`Dead End からの SHUFFLE: Chain は半分残る ×${ev.multBefore.toFixed(1)} → ×${ev.multAfter.toFixed(1)}`, 2200);
          else if (ev.chainBefore > 0) ui.toast('まだ Pair があった… Chain が途切れた ×1.0', 2200);
          break;
        }
        case 'hint': {
          sound.hint(); redraw();
          ui.toast('HINT: この Pair は得点半分、Chain は維持', 2000);
          const c = ui.cellCenter(ev.pair[0]); if (c) fx.ring(c.x, c.y, PALETTE.amber, 50);
          break;
        }
        case 'stageStart': lineStreak = 0; ui.hideOverlay(); redraw(); ui.boardWrap.scrollTo({ top: 0 }); break;
        case 'stageClear': await onRefuteClear(ev); break;
        case 'stageFailed': await onRefuteFailed(ev); break;
        case 'runOver': await onRunOver(ev); break;
        case 'complete': showRefuteComplete(ev); break;
        default: break;
      }
    }
  }

  async function onRemove(ev) {
    busy = true;
    const color = ev.fever ? PALETTE.rose : heatColor(ev.heat);
    const ci = ui.cellCenter(ev.i), cj = ui.cellCenter(ev.j);
    const speedBoost = ev.speed === 'fast' ? 1 : ev.speed === 'quick' ? 0.5 : 0;
    const feverBoost = ev.fever ? 1 : 0;
    const power = 0.8 + ev.heat * 1.4 + speedBoost * 0.5 + feverBoost * 0.6;
    const mx = ci && cj ? (ci.x + cj.x) / 2 : innerWidth / 2, my = ci && cj ? (ci.y + cj.y) / 2 : innerHeight / 2;
    if (ci && cj) {
      fx.flashLine(ci.x, ci.y, cj.x, cj.y, color, 3 + ev.heat * 3 + speedBoost * 2);
      fx.trail(ci.x, ci.y, cj.x, cj.y, color, 10 + Math.round(ev.heat * 10 + feverBoost * 12));
      const count = CONFIG.fx.particlesPerRemove + Math.round(ev.heat * 24 + speedBoost * 12 + feverBoost * 24);
      for (const c of [ci, cj]) fx.burst(c.x, c.y, { color, count, power, size: 3 + speedBoost + feverBoost });
      if (ev.heat > 0.5 || speedBoost > 0 || feverBoost) fx.ring(mx, my, color, 40 + ev.heat * 60 + speedBoost * 30);
      const t = ui.scoreCenter();
      fx.flyText(mx, my, t.x, t.y, `+${ev.pairPoints}`, { color, size: 18 + ev.heat * 10 + speedBoost * 4, dur: 0.5 });
      // 矛盾の中身を一瞬見せる: 「p→q ⊥ p∧¬q」
      fx.floatText(mx, my + 26, `${pretty(ev.a)}  ⊥  ${pretty(ev.b)}`, { color: PALETTE.white, size: 13, dy: -25, life: 1.0 });
      const labels = [...ev.labels];
      if (ev.diffMult > 1) labels.unshift(`×${ev.diffMult.toFixed(2).replace(/0$/, '')}`);
      if (ev.speed === 'fast') labels.push('FAST!!'); else if (ev.speed === 'quick') labels.push('QUICK');
      labels.forEach((text, k) => {
        const lc = text === 'FAST!!' ? PALETTE.rose : text === 'QUICK' ? PALETTE.amber : text === 'COMPLEX' || text === 'LONG SHOT' || text === 'DIAGONAL SNIPE' ? PALETTE.purple : text === 'SCOPE' || text === 'HINTED' ? PALETTE.red : text.startsWith('×') ? PALETTE.white : PALETTE.green;
        fx.floatText(mx, my - 36 - k * 22, text, { color: lc, size: 15, dy: -45, life: 1.1 });
      });
      if (ev.chain >= 5 && ev.chain % 5 === 0) fx.floatText(mx, my + 48, `${ev.chain} CHAIN  ×${ev.mult.toFixed(1)}`, { color: PALETTE.white, size: 16, dy: -30, life: 1.3 });
    }
    ui.markRemoving(ev.i, ev.j);
    sound.remove(ev.chain, ev.heat); vibrate(12 + Math.round(ev.heat * 20));
    fx.shake(ui.boardWrap, CONFIG.fx.shakeBase * (0.5 + ev.heat * 1.5 + speedBoost + feverBoost), 160);
    if (ev.clearedRows.length > 0) {
      lineStreak += 1;
      const n = ev.clearedRows.length, boost = Math.min(4, lineStreak - 1) + feverBoost;
      const streakColor = [PALETTE.amber, PALETTE.amber, PALETTE.rose, PALETTE.red, PALETTE.purple, PALETTE.purple][boost];
      fx.freeze(CONFIG.fx.hitStopMs + boost * 30);
      await sleep(CONFIG.fx.hitStopMs + boost * 40);
      ui.markRowsRemoving(ev.clearedRows); punch();
      const rows = ev.clearedRows.map((r) => ui.rowRect(r)).filter(Boolean);
      for (const r of rows) {
        fx.rowSweep(r.y, r.h, color); if (boost >= 1) fx.rowSweep(r.y, r.h, streakColor);
        for (let k = 0; k < refute.width; k++) {
          const x = innerWidth / 2 + (k - (refute.width - 1) / 2) * (r.h + 10);
          fx.burst(x, r.y + r.h / 2, { color: k % 2 ? color : PALETTE.white, count: Math.round(CONFIG.fx.particlesPerRow / refute.width) * (1 + boost * 0.5), power: 1.2 + ev.heat + boost * 0.3, size: 3.5 + boost * 0.5 });
        }
        if (boost >= 2) fx.ring(innerWidth / 2, r.y + r.h / 2, streakColor, 160 + boost * 40);
      }
      const y = rows.length ? rows[0].y : innerHeight / 2, t = ui.scoreCenter();
      fx.floatText(innerWidth / 2, y - 30, n > 1 ? `${n} LINES  +${ev.rowPoints}` : `LINE  +${ev.rowPoints}`, { color: PALETTE.amber, size: 22 + boost * 3, dy: -60, life: 1.3 });
      fx.flyText(innerWidth / 2, y - 30, t.x, t.y, `+${ev.rowPoints}`, { color: PALETTE.amber, size: 20, dur: 0.6, delay: 0.5 });
      if (lineStreak >= 2) fx.floatText(innerWidth / 2, y - 64, `${['', '', 'DOUBLE', 'TRIPLE', 'QUAD', 'RAMPAGE'][Math.min(lineStreak, 5)]} LINE  ×${lineStreak}`, { color: streakColor, size: 24 + boost * 4, dy: -50, life: 1.5 });
      if (lineStreak >= 4 || feverBoost) fx.fireworks(2 + boost);
      fx.flash(n > 1 || boost >= 1 ? `rgba(245,166,35,${0.22 + boost * 0.08})` : 'rgba(255,255,255,0.14)');
      fx.shake(ui.boardWrap, 6 + n * 3 + boost * 4, 320 + boost * 80);
      sound.rowClear(n, lineStreak - 1 + feverBoost); vibrate(boost >= 2 ? [40, 40, 80, 40, 120] : [30, 40, 60]);
      await sleep(220 + boost * 60);
    } else { lineStreak = 0; await sleep(180); }
    redraw();
    setTimeout(() => ui.bumpScore(), 250);
    busy = false;
  }

  async function onRefuteClear(ev) {
    busy = true;
    await sleep(200);
    sound.stageClear(); fx.fireworks(ev.perfect ? 9 : 6); punch();
    if (ev.perfect) { setTimeout(() => sound.perfect(), 300); fx.flash('rgba(62,207,142,0.2)'); }
    vibrate([40, 60, 40, 60, 120]);
    await sleep(700);
    const card = ui.showOverlay(`
      <div class="eyebrow">refute · stage ${pad2(ev.stage)}</div>
      <h1>${ev.perfect ? 'Perfect!' : 'Refuted!'}</h1>
      <div class="ja">${ev.perfect ? 'SHUFFLE なしで Board を空にした。Heart が回復！' : 'Board のすべてを矛盾で消した。'}</div>
      <div class="result">
        <div class="rank ${ev.rank}" id="ov-rank">${ev.rank}</div>
        <div class="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span></div>
      </div>
      <div class="rows">
        <div class="row"><span class="k">Play Score</span><span class="v">${fmt(ev.playScore)}</span></div>
        <div class="row"><span class="k">Clear Bonus</span><span class="v plus">+${fmt(ev.clearBonus)}</span></div>
        ${ev.perfect ? `<div class="row"><span class="k">Perfect Bonus</span><span class="v plus">+${fmt(ev.perfectBonus)}</span></div>` : ''}
        ${ev.savedBonus ? `<div class="row"><span class="k">SHUFFLE 温存 Bonus(${ev.shufflesLeft} 回)</span><span class="v plus">+${fmt(ev.savedBonus)}</span></div>` : ''}
        ${ev.hintBonus ? `<div class="row"><span class="k">Hint 温存 Bonus(${ev.hintsLeft} 回)</span><span class="v plus">+${fmt(ev.hintBonus)}</span></div>` : ''}
        ${ev.lifeGain ? `<div class="row"><span class="k">Heart 回復</span><span class="v plus">+${ev.lifeGain} ♥</span></div>` : ''}
        <div class="row total"><span class="k">Total Score</span><span class="v">${fmt(ev.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-next">${ev.isLast ? 'Result を見る' : 'Next Stage →'}</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    ui.animateStars(card, ev.stars);
    setTimeout(() => { card.querySelector('#ov-rank')?.classList.add('show'); if (ev.rank === 'S') { sound.perfect(); fx.fireworks(4); } }, 1100);
    if (ev.lifeGain) { ui.renderLives(refute.run.lives, CONFIG.refute.lives.max, { gained: true }); sound.lifeGain(); }
    card.querySelector('#ov-next').onclick = () => { busy = false; handleRefute(refute.nextStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  async function onRefuteFailed(ev) {
    busy = true;
    if (ev.reason === 'giveUp') sound.giveUp(); else sound.fail();
    vibrate([80, 50, 80]);
    ui.renderLives(ev.lives + 1, CONFIG.refute.lives.max, { lost: true });
    fx.flash('rgba(239,68,68,0.18)'); fx.shake(ui.boardWrap, 8, 400);
    await sleep(900);
    const text = ev.reason === 'giveUp' ? 'Stage をあきらめた。Stage 得点の半分は残る。'
      : ev.reason === 'blindHint' ? 'Pair は無く SHUFFLE も無かったのに Hint を押した… Stage 得点を全部失い、さらに減点。'
        : '消せる Pair が無く、SHUFFLE も残っていない…';
    const card = ui.showOverlay(`
      <div class="eyebrow">refute · stage ${pad2(ev.stage)}</div>
      <h1>${ev.reason === 'giveUp' ? 'Give Up' : 'Stuck'}</h1>
      <div class="ja">${text} Heart を 1 つ失った。</div>
      <div class="rows">
        <div class="row"><span class="k">失った Stage 得点</span><span class="v minus">−${fmt(ev.lost)}</span></div>
        ${ev.kept ? `<div class="row"><span class="k">残った Stage 得点</span><span class="v plus">${fmt(ev.kept)}</span></div>` : ''}
        <div class="row"><span class="k">残り Heart</span><span class="v">${'♥'.repeat(ev.lives)}${'♡'.repeat(CONFIG.refute.lives.max - ev.lives)}</span></div>
        <div class="row total"><span class="k">Score</span><span class="v">${fmt(refute.run.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-warn" id="ov-retry">新しい Board で Retry</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-retry').onclick = () => { busy = false; handleRefute(refute.retryStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  async function onRunOver(ev) {
    busy = true;
    sound.runOver(); vibrate([120, 80, 200]);
    ui.renderLives(1, CONFIG.refute.lives.max, { lost: true });
    fx.flash('rgba(239,68,68,0.25)'); fx.shake(ui.boardWrap, 10, 500);
    await sleep(1100);
    const w = refute.worldOf(ev.resumeStage) + 1;
    const card = ui.showOverlay(`
      <div class="eyebrow">run over</div>
      <h1 class="big">${fmt(ev.score)}</h1>
      <div class="ja">Heart が尽きた…${ev.score >= ev.best && ev.score > 0 ? 'Best Score 更新！！' : `Best ${fmt(ev.best)}`}</div>
      <div class="rows">
        <div class="row"><span class="k">到達 Stage</span><span class="v">${pad2(ev.stage)}</span></div>
        <div class="row"><span class="k">再開地点</span><span class="v">WORLD ${w}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-restart">World ${w} のはじめから</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-restart').onclick = () => { busy = false; handleRefute(refute.restartFromWorld()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; refute.abandonRun(); showTitle(); };
  }

  function showRefuteComplete(ev) {
    fx.fireworks(12); sound.stageClear();
    const card = ui.showOverlay(`
      <div class="eyebrow">refute · all ${refuteStages.length} stages</div>
      <h1 class="big">Complete</h1>
      <div class="ja">全 Stage を突破！！計 ${fmt(ev.score)} 点、Best ${fmt(ev.best)} 点</div>
      <div class="actions"><button class="btn btn-primary" id="ov-title">Title へ</button></div>`);
    card.querySelector('#ov-title').onclick = () => { refute.abandonRun(); showTitle(); };
  }

  // ======================================================================
  // DERIVE
  // ======================================================================
  async function handleDerive(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'select': ui.selectCell(ev.pos); sound.select(); vibrate(8); break;
        case 'deselect': ui.cellEl(ev.pos)?.classList.remove('selected'); sound.deselect(); break;
        case 'invalid': {
          ui.cellEl(ev.from)?.classList.remove('selected');
          ui.shakeCell(ev.to); sound.invalid(); vibrate([20, 30, 20]);
          const msg = {
            position: '一直線上で、間が空いていないと選べない',
            noRule: 'この 2 つに当てはまる規則はない',
            notAnd: '2 回タップで分けられるのは ∧ の式だけ',
            noEmpty: '空マスが無いので分けられない',
          }[ev.reason];
          if (msg) ui.toast(msg, 1600);
          break;
        }
        case 'move': await onMove(ev); break;
        case 'deadEnd': {
          ui.toast(ev.reason === 'noMoves' ? '使える手が無い … UNDO か RESET' : 'この先 Goal に届かない … UNDO で戻ろう', 2800);
          sound.stuck(); vibrate([30, 30, 30]);
          break;
        }
        case 'undo': sound.deselect(); redraw(); ui.toast(`UNDO (${ev.moves} 手は数えたまま)`, 1200); break;
        case 'reset': sound.add(); redraw(); break;
        case 'noUndo': ui.toast('戻せる手が無い'); sound.invalid(); break;
        case 'noHint': ui.toast('使える手が無い … UNDO か RESET'); sound.invalid(); break;
        case 'hint': {
          sound.hint(); redraw();
          const m = ev.move;
          ui.toast(m.rule === 'ANDE' ? `${RULE_JA.ANDE}: ${pretty(derive.cur.cells[m.i])} を 2 回タップ` : `${m.rule}(${RULE_JA[m.rule]})が使える`, 2200);
          break;
        }
        case 'stageStart': ui.hideOverlay(); redraw(); ui.boardWrap.scrollTo({ top: 0 }); break;
        case 'stageClear': await onDeriveClear(ev); break;
        case 'complete': showDeriveComplete(); break;
        default: break;
      }
    }
  }

  async function onMove(ev) {
    busy = true;
    const color = PALETTE.green;
    const ci = ui.cellCenter(ev.i), cj = ui.cellCenter(ev.j);
    if (ev.rule === 'ANDE') {
      if (ci) { fx.ring(ci.x, ci.y, color, 50); fx.burst(ci.x, ci.y, { color, count: 20, power: 0.8 }); }
      fx.floatText(ci ? ci.x : innerWidth / 2, (ci ? ci.y : innerHeight / 2) - 40, `∧E  ${RULE_JA.ANDE}`, { color, size: 16, dy: -40, life: 1.2 });
      sound.remove(2, 0.2); vibrate(15);
      await sleep(150);
      redraw({ born: ev.movedTo });
    } else {
      if (ci && cj) {
        fx.flashLine(ci.x, ci.y, cj.x, cj.y, color, 4);
        fx.trail(ci.x, ci.y, cj.x, cj.y, color, 14);
        fx.burst(ci.x, ci.y, { color, count: 18, power: 0.9 });
        fx.floatText((ci.x + cj.x) / 2, (ci.y + cj.y) / 2 - 40, `${ev.rule}  ${RULE_JA[ev.rule]}`, { color: PALETTE.white, size: 16, dy: -40, life: 1.3 });
        fx.floatText((ci.x + cj.x) / 2, (ci.y + cj.y) / 2 - 16, `${pretty(ev.before[ev.i])},  ${pretty(ev.before[ev.j])}  ⊢  ${pretty(ev.result)}`, { color, size: 13, dy: -30, life: 1.4 });
      }
      ui.markRemoving(ev.i);
      sound.remove(Math.min(ev.moves, 14), 0.3); vibrate(15);
      fx.shake(ui.boardWrap, 2, 120);
      await sleep(180);
      redraw({ born: ev.j });
      if (cj) { fx.ring(cj.x, cj.y, color, 60); fx.burst(cj.x, cj.y, { color, count: 24, power: 1 }); }
    }
    busy = false;
  }

  async function onDeriveClear(ev) {
    busy = true;
    const c = derive.cur;
    const pos = c.cells.indexOf(c.goal);
    redraw({ goalHit: pos });
    const gc = ui.cellCenter(pos) ?? { x: innerWidth / 2, y: innerHeight / 2 };
    const goalBox = ui.goalCenter();
    fx.flashLine(gc.x, gc.y, goalBox.x, goalBox.y, PALETTE.amber, 4);
    fx.burst(gc.x, gc.y, { color: PALETTE.amber, count: 60, power: 1.3 });
    fx.flyText(gc.x, gc.y, goalBox.x, goalBox.y, pretty(c.goal), { color: PALETTE.amber, size: 22, dur: 0.7 });
    sound.stageClear(); punch();
    await sleep(700);
    fx.fireworks(ev.stars === 3 ? 8 : 5);
    fx.floatText(innerWidth / 2, innerHeight * 0.38, 'Q.E.D.', { color: PALETTE.amber, size: 48, dy: -30, life: 1.8 });
    vibrate([40, 60, 40, 60, 120]);
    await sleep(900);
    const card = ui.showOverlay(`
      <div class="eyebrow">derive · stage ${pad2(ev.stage)}</div>
      <h1>Q.E.D.</h1>
      <div class="ja">Goal <span class="f">${pretty(derive.cur.goal)}</span> を導いた。</div>
      <div class="result"><div class="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span></div></div>
      <div class="rows">
        <div class="row"><span class="k">手数</span><span class="v">${ev.moves} 手 (par ${ev.par})</span></div>
        <div class="row"><span class="k">Hint</span><span class="v">${ev.hints} 回</span></div>
        <div class="row total"><span class="k">Score</span><span class="v">${fmt(ev.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-next">${ev.isLast ? 'Result を見る' : 'Next Stage →'}</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    ui.animateStars(card, ev.stars);
    card.querySelector('#ov-next').onclick = () => { busy = false; handleDerive(derive.nextStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  function showDeriveComplete() {
    fx.fireworks(12); sound.stageClear();
    const card = ui.showOverlay(`
      <div class="eyebrow">derive · all ${deriveStages.length} stages</div>
      <h1 class="big">Complete</h1>
      <div class="ja">全 Stage を証明した。Star ${derive.totalStars} / ${deriveStages.length * 3}</div>
      <div class="actions"><button class="btn btn-primary" id="ov-title">Title へ</button></div>`);
    card.querySelector('#ov-title').onclick = () => { derive.abandon(); showTitle(); };
  }

  // ======================================================================
  // Title・Menu・Rules
  // ======================================================================
  function worldButtons(game, stages, modeName) {
    const out = [];
    const total = Math.ceil(stages.length / game.cfg.worldSize);
    for (let w = 0; w < total; w++) {
      const unlocked = w < game.unlockedWorlds;
      const first = w * game.cfg.worldSize;
      const inWorld = stages.slice(first, first + game.cfg.worldSize);
      const starsIn = inWorld.reduce((a, s) => a + (game.p.stars[s.stage] ?? 0), 0);
      out.push(`<button class="btn btn-ghost" data-mode="${modeName}" data-world="${w}" ${unlocked ? '' : 'disabled'}>WORLD ${w + 1}<small>${unlocked ? `★ ${starsIn}/${inWorld.length * 3}` : 'locked'}</small></button>`);
    }
    return out.join('');
  }

  function showTitle() {
    busy = false; mode = null;
    document.body.classList.remove('fever');
    const rRun = refute.run && refute.stage && ['play', 'clear', 'failed'].includes(refute.stage.status);
    const dCur = derive.cur && ['play', 'clear'].includes(derive.cur.status);
    const card = ui.showOverlay(`
      <div class="eyebrow">propositional logic puzzle</div>
      <h1 class="big">THE LOGIC</h1>
      <div class="ja">式のタイルを選んで消す・つなぐ。REFUTE は「2 つ合わせて矛盾」を見抜く速さの勝負、DERIVE は推論規則で Goal を組み立てる証明のパズル。</div>
      <div class="modes">
        <button class="mode-btn refute" id="ov-refute">
          <div class="mode-name">REFUTE</div>
          <div class="mode-ja">同時に成り立たない 2 つを消して Board を空に。Chain と FEVER。</div>
          <div class="mode-stat">best ${fmt(refute.p.bestScore)} · ★ ${refute.totalStars}/${refuteStages.length * 3}</div>
        </button>
        <button class="mode-btn derive" id="ov-derive">
          <div class="mode-name">DERIVE</div>
          <div class="mode-ja">MP・MT・DS などで式を合体させ、Goal を導く。手数で Star。</div>
          <div class="mode-stat">★ ${derive.totalStars}/${deriveStages.length * 3} · ${derive.p.maxStage}/${deriveStages.length} cleared</div>
        </button>
      </div>
      <div class="actions">
        ${rRun ? `<button class="btn btn-ghost" id="ov-resume-refute">REFUTE を Continue (STAGE ${pad2(refute.stageDef.stage)})</button>` : ''}
        ${dCur ? `<button class="btn btn-ghost" id="ov-resume-derive">DERIVE を Continue (STAGE ${pad2(derive.stageDef.stage)})</button>` : ''}
        <div class="label" style="margin-top:6px">refute worlds</div>
        <div class="worlds">${worldButtons(refute, refuteStages, 'refute')}</div>
        <div class="label" style="margin-top:6px">derive worlds</div>
        <div class="worlds">${worldButtons(derive, deriveStages, 'derive')}</div>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
      </div>
      <div class="meta">semantics verified against haskell vectors</div>`);
    card.querySelector('#ov-refute').onclick = () => startRefute(0);
    card.querySelector('#ov-derive').onclick = () => startDerive(0);
    card.querySelector('#ov-resume-refute')?.addEventListener('click', () => {
      ensureAudio(); mode = 'refute';
      const st = refute.stage;
      if (st.status === 'clear') { ui.hideOverlay(); redraw(); handleRefute(refute.nextStage()); return; }
      if (st.status === 'failed') { handleRefute(refute.retryStage()); return; }
      refute.resume(Date.now()); ui.hideOverlay(); redraw();
    });
    card.querySelector('#ov-resume-derive')?.addEventListener('click', () => {
      ensureAudio(); mode = 'derive';
      if (derive.cur.status === 'clear') { ui.hideOverlay(); redraw(); handleDerive(derive.nextStage()); return; }
      ui.hideOverlay(); redraw();
    });
    card.querySelectorAll('[data-world]').forEach((b) => b.addEventListener('click', () => {
      const w = Number(b.dataset.world);
      if (b.dataset.mode === 'refute') startRefute(w * CONFIG.refute.worldSize); else startDerive(w * CONFIG.derive.worldSize);
    }));
    card.querySelector('#ov-rules').onclick = showRules;
  }
  function startRefute(stageIndex) { ensureAudio(); mode = 'refute'; handleRefute(refute.newRun(stageIndex)); }
  function startDerive(stageIndex) { ensureAudio(); mode = 'derive'; handleDerive(derive.start(stageIndex)); }

  function showRules() {
    const c = CONFIG.refute;
    const card = ui.showOverlay(`
      <div class="eyebrow">how to play</div>
      <h1>How to Play</h1>
      <div class="rules">
        <b>式</b>: 変数 p q r、否定 ¬、かつ ∧、または ∨、ならば →、矛盾 ⊥。<br>
        <b>位置</b>(両モード共通): 2 つのタイルは、同じ行・列・斜めの一直線上にあり、間がすべて空マスのときだけ選べる。行の右端と次の行の左端はつながらない。<br>
        <br>
        <b>REFUTE</b>: <span class="ex">2 つ合わせると矛盾する</span>(どんな真偽の割り当てでも同時には成り立たない)Pair が消える。例: <span class="f">p</span> と <span class="f">¬p</span>、<span class="f">p→q</span> と <span class="f">p∧¬q</span>、<span class="f">p∨q</span> と <span class="f">¬p∧¬q</span>。行がまるごと空になると行が消える。Board を空にすれば Clear。<br>
        Score: 1 Pair の得点 = ${c.score.pairBase} 点 × 難しさ倍率 × Chain 倍率 × Speed 倍率。難しさ倍率は、横の隣どうし ×1.0、縦 ×${c.difficulty.vertical}、斜め ×${c.difficulty.diagonal}、2 つの間の空マス 1 つごとに +${c.difficulty.gapPerCell}(斜めは +${c.difficulty.diagonalGapPerCell})、2 式の結合子 1 つごとに +${c.difficulty.perConnective}(複雑な式ほど高い)。Chain は消すたびに倍率 +${c.chain.step}(最大 ×${c.chain.max})、${c.chain.decayGraceMs / 1000} 秒消さないと ${c.chain.decayStepMs / 1000} 秒ごとに 1 段階減る。×${c.chain.max} で ${c.fever.durationMs / 1000} 秒の FEVER(Score ×${c.fever.pointMult})。<br>
        SHUFFLE: 残りのタイルを並べ替える(Number Match の Add に相当)。Dead End(消せる Pair が無い)になってから使えば Chain は半分残る。尽きると GIVE UP ボタンになる(Heart −1、Stage 得点の半分は獲得できる)。<br>
        Hint(使用上限 Stage ごとに ${c.hint.perStage} 回、Chain 倍率で中身が変わる): HINT(×1〜)は Pair を 1 組示し、その Pair は得点半分で Chain は維持。FLASH(×${c.hint.flashFrom} 以上)は全 Pair を ${c.hint.flashMs / 1000} 秒光らせ、ゲージが半分になる。SCOPE(×${c.hint.scopeFrom} 以上と FEVER 中)は相手のいるタイルを 1 枚光らせ、残り Pair 数を示す。光ったタイルを含む Pair を消せば全て獲得(Chain 維持、Speed なし)。相手を外すと 1 回目 Chain −${c.hint.scopeMissChain}、2 回目で半分。光ったタイルを使わず別の Pair を消しても半分。Dead End なのに押すと使用回数 1 と Chain 半分、−${c.score.hintWhenStuck} 点。SHUFFLE も無いのに押すと Heart −1 で Stage 得点を全部失い、さらに −${c.score.blindHintPenalty} 点。残した Hint は Clear 時 1 回ごと +${c.score.hintSaved}。<br>
        <br>
        <b>DERIVE</b>: 2 つのタイルを選ぶと、当てはまる推論規則で結論のタイルに合体する(結論は 2 つ目の位置)。Goal の式を作れば Clear。手数が par 以内で ★★★、par+2 以内で ★★。
        <table>
          <tr><td>MP</td><td><span class="f">A</span>, <span class="f">A→B</span> ⊢ <span class="f">B</span></td></tr>
          <tr><td>MT</td><td><span class="f">¬B</span>, <span class="f">A→B</span> ⊢ <span class="f">¬A</span></td></tr>
          <tr><td>DS</td><td><span class="f">¬A</span>, <span class="f">A∨B</span> ⊢ <span class="f">B</span></td></tr>
          <tr><td>∧I</td><td><span class="f">A</span>, <span class="f">B</span> ⊢ <span class="f">A∧B</span>(Goal の一部になるときだけ)</td></tr>
          <tr><td>∧E</td><td><span class="f">A∧B</span> を 2 回タップ ⊢ <span class="f">A</span> と <span class="f">B</span>(B は最初の空マスへ)</td></tr>
          <tr><td>⊥</td><td><span class="f">A</span>, <span class="f">¬A</span> ⊢ <span class="f">⊥</span>(Goal が ⊥ のときだけ)</td></tr>
        </table>
        UNDO は何手でも戻せるが、手数は数えたまま。RESET で最初の Board に戻る。Stage 1〜10 の Board は、どの順で進めても Goal に届くように作ってある。Stage 11 以降は行き止まりがあり、入ったときは知らせる。
      </div>
      <div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`);
    card.querySelector('#ov-back').onclick = showTitle;
  }

  function showMenu() {
    const inRefute = mode === 'refute' && refute.stage?.status === 'play';
    const card = ui.showOverlay(`
      <div class="eyebrow">menu</div>
      <h1>Pause</h1>
      <div class="actions">
        <button class="btn btn-primary" id="ov-back">Resume</button>
        <button class="btn btn-ghost" id="ov-sound">Sound: ${sound.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-bgm">BGM: ${bgm.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
        ${inRefute ? '<button class="btn btn-danger" id="ov-giveup">GIVE UP(Heart −1 · 得点は半分残る)</button>' : ''}
      </div>`);
    card.querySelector('#ov-back').onclick = () => { if (mode === 'refute') refute.resume(Date.now()); ui.hideOverlay(); };
    card.querySelector('#ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); soundLabel(); showMenu(); };
    card.querySelector('#ov-bgm').onclick = () => { bgm.setEnabled(!bgm.enabled); showMenu(); };
    card.querySelector('#ov-rules').onclick = () => { showRules(); document.getElementById('ov-back').onclick = showMenu; };
    card.querySelector('#ov-title').onclick = showTitle;
    card.querySelector('#ov-giveup')?.addEventListener('click', () => { ui.hideOverlay(); handleRefute(refute.giveUp()); });
  }

  // ---------- 入力 ----------
  ui.board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el || busy || overlayOpen()) return;
    ensureAudio();
    const pos = Number(el.dataset.pos);
    if (mode === 'refute') handleRefute(refute.tap(pos, Date.now()));
    else if (mode === 'derive') handleDerive(derive.tap(pos));
  });
  document.getElementById('btn-action').onclick = () => {
    if (busy || overlayOpen()) return;
    ensureAudio();
    if (mode === 'refute') handleRefute(refute.shuffle(Date.now()));
    else if (mode === 'derive') handleDerive(derive.undo());
  };
  document.getElementById('btn-hint').onclick = () => {
    if (busy || overlayOpen()) return;
    ensureAudio();
    if (mode === 'refute') handleRefute(refute.useHint());
    else if (mode === 'derive') handleDerive(derive.useHint());
  };
  document.getElementById('btn-reset').onclick = () => { if (!busy && !overlayOpen() && mode === 'derive') { ensureAudio(); handleDerive(derive.reset()); } };
  document.getElementById('btn-menu').onclick = showMenu;
  soundLabel();

  showTitle();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f87171;padding:16px;font:12px monospace">起動に失敗: ${err?.message ?? err}</pre>`);
  console.error(err);
});
