# THE LOGIC(命題論理のタイルパズル)

Number Match 自作版「THE TEN」の骨格を使い、タイルを数字から命題論理の式に置き換えたパズルです。2 つのモードがあります。

- **REFUTE**: 2 つの式を選び、合わせて矛盾する(どんな真偽の割り当てでも同時には成り立たない)なら消えます。Board を空にすれば Clear。Chain・FEVER・Heart は THE TEN と同じ骨格です。
- **DERIVE**: 2 つの式を選ぶと、当てはまる推論規則(MP・MT・DS・∧I・∧E・⊥)で結論の式に合体します。Goal の式を作れば Clear。手数で Star が決まります。

位置の条件は両モード共通で、「同じ行・列・斜めの一直線上にあり、間がすべて空マス」です。Number Match の行またぎ(行の右端と次の行の左端がつながる)は採用していません。

## 構成

| フォルダ | 役割 |
|---|---|
| `generator/` | Haskell。式の型、充足判定、推論規則、面の生成(REFUTE は探索で全消し可能を確認、DERIVE は導出を前向きに作って幅優先探索で最短手数を求める)、JSON の書き出し。式の意味の基準はここです |
| `web/` | ブラウザで動くゲーム本体。HTML、CSS、JavaScript だけで、ビルド工程も外部ライブラリもありません。`js/logic.js` は Haskell の移植です |
| `docs/` | 仕様(`SPEC.md`)と学習用の解説 |

## コマンド

Haskell 側は `generator/` で実行します。

```powershell
cabal build
cabal test
cabal run gen      # web/levels/refute.json, derive.json と web/test/vectors-logic.json を書き出す
```

ブラウザ側はリポジトリのルートで実行します。

```powershell
node --test web/test/*.test.js
python -m http.server 8766 --bind 127.0.0.1 --directory web
```

## 式の書き方

ファイルの中では前置記法の ASCII 文字列で持ち回ります(`>p!q` = p→¬q、`!&pq` = ¬(p∧q))。画面には `pretty` が infix に直して表示します。詳しくは `docs/SPEC.md`。

## 調整

得点・Chain・FEVER・Rank・Star の基準は `web/js/config.js` にまとめてあります。Stage の語彙や枚数は Haskell 側(`generator/src/Logic/Refute.hs`、`Derive.hs`)で決め、変えたら `cabal run gen` を実行します。
