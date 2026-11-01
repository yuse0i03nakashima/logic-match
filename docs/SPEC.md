# THE LOGIC — 共有仕様（Haskell 生成器と JavaScript ゲームの契約）

命題論理のタイルを消す・合成するパズル。2 つのモードがある。

- **REFUTE**: 2 つのタイルを選び、合わせて矛盾する（同時に真にできない）なら消える。Board を空にすれば Clear。
- **DERIVE**: 2 つのタイルを選び、推論規則が当てはまれば結論のタイルに合体する。Goal の式を作れば Clear。

Haskell（`generator/`）が面データと検査用ベクタを JSON で書き出し、JavaScript（`web/`）がそれを読んで遊ぶ。
論理式の意味（充足可能性、推論規則）の正本は Haskell。JavaScript は移植で、ベクタとの一致を `node --test` で確かめる。

## 1. 論理式

変数は `p` `q` `r` の 3 つまで。結合子は ¬ ∧ ∨ →。定数 ⊥。

### 1.1 交換用の文字列（prefix 記法）

JSON とテストベクタでは、次の前置記法の ASCII 文字列で表す。曖昧さがなく、再帰下降で 1 文字ずつ読める。

| 記号 | 意味 | 例 |
|---|---|---|
| `p` `q` `r` | 変数 | `p` |
| `F` | ⊥ | `F` |
| `!X` | ¬X | `!p` |
| `&XY` | X∧Y | `&pq` |
| `\|XY` | X∨Y | `\|p!q` |
| `>XY` | X→Y | `>p!q` = p→¬q |

例: `!&pq` = ¬(p∧q)、`>&pqr` = (p∧q)→r、`|!pq` = ¬p∨q。

### 1.2 表示用の文字列（infix）

画面に出す形。両言語とも同じ関数 `pretty` を持ち、ベクタで一致を確かめる。

- 変数はそのまま。⊥ は `⊥`。
- `¬X`: X が変数か ⊥ か ¬ なら括弧なし（`¬p`、`¬¬p`）。X が 2 項なら括弧（`¬(p∧q)`）。
- 2 項 `X op Y`（op は `∧` `∨` `→`、前後に空白なし）: X, Y が 2 項なら括弧で囲む。変数・⊥・¬ は囲まない。
  - `>p!q` → `p→¬q`、`>&pqr` → `(p∧q)→r`、`&p|qr` → `p∧(q∨r)`、`!>pq` → `¬(p→q)`。
- 結合の省略（p→q→r のような括弧省略）はしない。すべて明示。

### 1.3 意味

真理値割り当ては、式に現れる変数すべてへの真偽の割り当て。`sat(S)` は式の集合 S を同時に真にする割り当てがあるか。
`unsat2(A, B)` = `not (sat {A, B})`。A と B に共通の変数がなくても定義どおりに判定する（例: `p` と `!p` は unsat、`p` と `q` は sat、`F` と何かは常に unsat、`&p!p` と何かも常に unsat）。

## 2. 位置の条件（両モード共通）

Board は幅 `width` の格子で、タイルは読み順（左→右、上→下）の配列。空マスは `""`。配列の長さは `width × height`（REFUTE は行が消えると短くなる）。

添字 i と j（i ≠ j）が **つながっている** とは、同じ行、同じ列、または正確な斜め（行の差の絶対値 = 列の差の絶対値）にあり、その直線上で 2 つの間にあるマスがすべて空であること。**行の右端と次の行の左端はつながらない**（Number Match の行またぎは採用しない）。隣どうしはつながっている。

```
connected(board, width, i, j):
  (ri, ci) = divmod(i, width); (rj, cj) = divmod(j, width)
  dr = rj - ri, dc = cj - ci
  if dr == 0 and dc == 0: false
  if not (dr == 0 or dc == 0 or |dr| == |dc|): false
  step = (sign(dr), sign(dc)); 1 歩ずつ進み、j の手前までのマスが全部 "" なら true
```

## 3. REFUTE モード

- 消せる組: `connected` かつ `unsat2(A, B)`。
- 消すと 2 マスが空になる。全部空の行は Board から消える（行の縮約。空マスが残る途中までの行はそのまま）。
- Board が空になれば Clear。
- SHUFFLE（Number Match の Add に相当）: 残っているタイルを並べ替えて詰め直す（JS 側で乱数。Haskell は関与しない）。使える回数は Stage ごと。
- 面は「SHUFFLE なしで全消しできる」ことを探索で確認してから採用する（深さ優先探索、訪問済みの記憶、ノード予算。Number Match の Solver と同じ構造）。タイル数は偶数。

### 3.1 Stage の設計（width = 6）

| Stage | 行数 | 語彙 | shuffles |
|---|---|---|---|
| 1–5 | 3（18 枚） | リテラルのみ: `p` `!p` `q` `!q` `r` `!r` | 2 |
| 6–10 | 3 | ∧ ∨ を含む 2 変数の式（深さ 1）: `&pq` `\|pq` `&p!q` `!&pq` … | 2 |
| 11–15 | 4（24 枚） | → を含む（`>pq` `>p!q` `!>pq` `&p!q`）、2 変数 | 2 |
| 16–20 | 4 | 3 変数、深さ 2 まで（`>&pqr` `\|!p!q` …） | 1 |
| 21–25 | 5（30 枚） | 全部 | 1 |

タイルの語彙は Stage ごとの候補集合から乱数で選ぶ。各タイルが少なくとも 1 枚の相手と unsat になるように選ぶ（孤立タイルは面にしない）。「初手で消せる組の数」は 4 以上。

### 3.2 JSON: `web/levels/refute.json`

```json
[
  { "stage": 1, "width": 6, "shuffles": 2,
    "boards": [ { "seed": 123, "cells": ["p","!q",...], "initialMoves": 7, "solutionLength": 9 }, ... 3 枚 ] },
  ...
]
```

## 4. DERIVE モード

Board は width 4 × height 4（16 マス）。Goal の式が 1 つ与えられる。タイルは 5〜9 枚、残りは空。

### 4.1 規則

2 枚の規則は、先にタップしたタイル X（位置 i）と、あとにタップしたタイル Y（位置 j）が `connected` であるときに使える。結果は **j に置き、i は空になる**。X と Y の順序は問わない（どちらが A でも同じ結論）。

| 規則 | 組 | 結論 |
|---|---|---|
| MP（前件肯定） | `A` と `>AB` | `B` |
| MT（後件否定） | `!B` と `>AB` | `!A` |
| DS（選言三段論法） | `!A` と `\|AB` → `B`、`!B` と `\|AB` → `A` | |
| ∧I（連言導入） | `A` と `B` | `&AB`。ただし `&AB` または `&BA` が **Goal の部分式**であるときだけ。結論は Goal に現れる側の順序 |
| ⊥（矛盾） | `A` と `!A` | `F`。Goal が `F` のときだけ |

一致は文字列の完全一致（`!!p` と `p` は別物）。複数の規則が当てはまる組はないように語彙を選ぶ（当てはまるなら表の上の規則を優先）。

1 枚の規則:

| 規則 | 操作 | 結果 |
|---|---|---|
| ∧E（連言除去） | `&AB` のタイルを 2 回タップ | 位置はそのまま `A`、`B` は **読み順で最初の空マス**に置く。空マスが無ければ使えない |

Clear: いずれかのタイルが Goal と一致した時点。

### 4.2 生成

1. Stage の語彙と規則の範囲から、前提（リテラルや含意）をランダムに選び、規則を前向きに適用して導出を作る。導出の最後の式を Goal とする。Goal は前提そのものではないこと。
2. 導出に使った前提（葉）と、邪魔タイル（0〜3 枚。Goal と一致せず、Goal を 1 手で作れないもの）を 4×4 に乱数で配置する。
3. 幅優先探索（状態 = Board の 16 要素）で Goal に到達する最短手数 `par` を求める。到達できなければ配置をやり直す。`par` は 2 以上。探索の上限は 8 手。
4. Stage 1〜10 は **行き止まりの無い面**だけを採用する（初期 Board から到達できるどの状態からも Goal に届く。到達集合を求め、Goal の状態から逆向きに「生きている状態」を広げて全状態が生きていることを確かめる）。Stage 11 以降は行き止まりを許すが、初手の半分以上が行き止まりになる面は採らない。ゲーム側は手を打つたびに Goal に届くかを幅優先探索で調べ、届かなくなったら知らせる。

| Stage | 規則 | 変数 | par の目安 |
|---|---|---|---|
| 1–5 | MP | 2 | 2–3 |
| 6–10 | MP MT DS | 2 | 3–4 |
| 11–15 | + ∧E ∧I | 2–3 | 3–5 |
| 16–20 | 全部、⊥ を Goal にする面も | 3 | 4–6 |

### 4.3 JSON: `web/levels/derive.json`

```json
[
  { "stage": 1, "width": 4, "height": 4, "goal": "q",
    "boards": [ { "seed": 5, "cells": ["p","","" ,">pq", ...16 要素], "par": 2,
                 "solution": [ ["MP", 0, 3], ["ANDE", 5, 5], ... ] }, ... 3 枚 ] },
  ...
]
```

`solution` は BFS が見つけた最短手順。各手は `[規則名, i, j]`（1 枚の規則は i = j）。規則名は `MP` `MT` `DS` `ANDI` `BOT` `ANDE`。

## 5. テストベクタ: `web/test/vectors-logic.json`

```json
{
  "pretty":   [ { "prefix": ">p!q", "pretty": "p→¬q" }, ... 30 件以上、各結合子・括弧の有無を網羅 ],
  "unsat2":   [ { "a": "p", "b": "!p", "unsat": true }, ... 100 件以上、真偽半々程度 ],
  "connected":[ { "width": 6, "cells": [...], "i": 0, "j": 7, "connected": true }, ... 40 件以上。行またぎが false になる例を含む ],
  "derive":   [ { "goal": "q", "x": "p", "y": ">pq", "result": "q", "rule": "MP" },
                { "goal": "&pq", "x": "p", "y": "q", "result": "&pq", "rule": "ANDI" },
                { "goal": "q", "x": "p", "y": "q", "result": null, "rule": null }, ... 60 件以上 ],
  "andE":     [ { "cells": ["&pq","","r"], "i": 0, "result": ["p","q","r"] }, { "cells": ["&pq","r"], "i": 0, "result": null }, ... 10 件以上 ]
}
```

## 6. Haskell 側の決まり

- cabal プロジェクト `logicmatch-gen`。依存は `base` と `containers` のみ。`-Wall`。
- モジュール: `Logic.Prop`（型・parse・pretty・eval・sat・unsat2）、`Logic.Grid`（connected、行の縮約）、`Logic.Refute`（組の判定・ソルバ・生成）、`Logic.Derive`（規則・BFS・生成）、`Logic.Random`（線形合同法。`nextSeed s = (1103515245 * s + 12345) mod 2^31`、`pick`）、`Logic.Json`（手書き JSON）、`app/Main.hs`（`cabal run gen` で `../web/levels/*.json` と `../web/test/vectors-logic.json` を書く。引数で出力先を変えられる）。
- テスト `test/Spec.hs`（exitcode-stdio、手書き）: parse∘pretty の往復、sat の真理値表との一致、unsat2 の対称性、connected の例（行またぎが false）、REFUTE の解を再生すると空になる、DERIVE の solution を再生すると Goal に到達する。
- コメントは日本語。Hutton 本の章に対応づける（`data Prop` と再帰は第 7 章、トートロジー検査器は第 8 章、探索は Number Match の Solver と同じ）。
- 生成は `cabal run gen` で 60 秒以内に終わること。終わらなければ予算や面数を下げる。
- JSON の文字列は ASCII のみ（prefix 記法）。pretty の Unicode は vectors の中だけで使い、`\u` エスケープで書く。
