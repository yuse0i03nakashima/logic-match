# LogicMatch — THE LOGIC（命題論理のタイルパズル。REFUTE / DERIVE）

Number Match 自作版（`C:\Users\ynaka\NumberMatch`）を土台にした、より頭を使うゲーム。仕様の正本は `docs/SPEC.md`。

## 構成と担当

- `generator/` — Haskell（cabal、依存は base・containers のみ）。論理式の意味（充足可能性・推論規則）の正本。面データとテストベクタを出力。
  - `cabal run gen` で `web/levels/refute.json`、`web/levels/derive.json`、`web/test/vectors-logic.json` を書き出す。手で編集しない。
- `web/` — 静的サイト（ES modules、ビルドなし、外部ライブラリなし）。`js/logic.js` は Haskell の移植で、ベクタとの一致を `node --test web/test/*.test.js` で確かめる。
- `docs/` — 仕様と学習用の解説。

## 規則

- UTF-8。個人情報を入れない。UI の用語は英語（Pair / Board / Chain / Heart / Star / Rank / Stage / World / Score / Bonus / Goal / Rule）、説明文は日本語。Chain には「途切れる」。
- 人が読む日本語文書（docs/、README）は explain-before-shorten → yomiyasu で推敲する。
- Haskell は授業（Hutton 本）で既習の道具を優先する。
- コミットは変更ファイルをパス指定で行う。
- 検証: `cabal build && cabal test`（generator）、`node --test web/test/*.test.js`、ブラウザで実プレイ。
