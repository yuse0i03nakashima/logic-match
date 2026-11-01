-- | 論理式・位置の条件・規則・ソルバの検査。外部ライブラリなしの手書きテスト。
--   失敗が 1 つでもあれば終了コード 1 で終わる(cabal test が赤くなる)。
module Main (main) where

import Control.Monad (unless)
import System.Exit (exitFailure)
import System.IO (hSetEncoding, stdout, utf8)
import Logic.Prop
import Logic.Grid
import Logic.Random
import qualified Logic.Refute as R
import qualified Logic.Derive as D

-- | 文字列から式へ(テスト用。読めなければ Bot にして失敗が見えるようにする)。
prop :: String -> Prop
prop s = maybe Bot id (parse s)

-- | (名前, 成否) の一覧。
tests :: [(String, Bool)]
tests =
  -- 第7章: data Prop と再帰。parse と toPrefix は互いに逆
  [ ("parse: 基本",                    parse ">p!q" == Just (Imp (Var 'p') (Not (Var 'q'))))
  , ("parse: 読み残しがあれば失敗",     parse "pq" == Nothing)
  , ("parse: 足りなければ失敗",         parse "&p" == Nothing)
  , ("parse: 知らない文字は失敗",       parse "&ps" == Nothing)
  , ("parse . toPrefix = id",          all (\s -> fmap toPrefix (parse s) == Just s) prefixSamples)
  , ("toPrefix . parse で元に戻る(乱数の式)", all (\f -> parse (toPrefix f) == Just f) randomProps)

  -- SPEC 1.2 の pretty
  , ("pretty: 変数・⊥・否定",          map (pretty . prop) ["p", "F", "!p", "!!p"] == ["p", "⊥", "¬p", "¬¬p"])
  , ("pretty: 2 項の括弧",             map (pretty . prop) [">p!q", ">&pqr", "&p|qr", "!>pq", "!&pq"]
                                           == ["p→¬q", "(p∧q)→r", "p∧(q∨r)", "¬(p→q)", "¬(p∧q)"])
  , ("pretty: 両側が 2 項",            pretty (prop "|&pq>qr") == "(p∧q)∨(q→r)")

  -- 第8章: トートロジー検査器。真理値表と一致
  , ("eval: → の真理値表",             [eval [('p', a), ('q', b)] (prop ">pq") | a <- [False, True], b <- [False, True]] == [True, True, False, True])
  , ("eval: ∧ ∨ の真理値表",           [eval [('p', a), ('q', b)] (prop "&pq") | a <- [False, True], b <- [False, True]] == [False, False, False, True]
                                     && [eval [('p', a), ('q', b)] (prop "|pq") | a <- [False, True], b <- [False, True]] == [False, True, True, True])
  , ("bools 3 は 8 本",                length (bools 3) == 8)
  , ("sat: p と !p は不可",            not (sat [prop "p", prop "!p"]))
  , ("sat: 空集合は可",                sat [])
  , ("sat と総当たりの一致",           all (\fs -> sat fs == bruteSat fs) randomSets)
  , ("tautology: |p!p",                tautology (prop "|p!p") && not (tautology (prop "p")))
  , ("contradiction: &p!p",            contradiction (prop "&p!p") && not (contradiction (prop "p")))

  -- unsat2
  , ("unsat2: 例(SPEC 1.3)",           unsat2 (prop "p") (prop "!p") && not (unsat2 (prop "p") (prop "q"))
                                     && unsat2 (prop "F") (prop "q") && unsat2 (prop "&p!p") (prop ">qr"))
  , ("unsat2: >pq と &p!q",            unsat2 (prop ">pq") (prop "&p!q"))
  , ("unsat2: 対称",                   all (\(a, b) -> unsat2 a b == unsat2 b a) randomPairs)
  , ("unsat2: 同じ式どうしは sat(矛盾式以外)", not (unsat2 (prop ">pq") (prop ">pq")))

  -- SPEC 2: 位置の条件
  , ("connected: 横、間が空",          connected 6 sample 0 3)
  , ("connected: 横、間に式",          not (connected 6 sample 0 5))
  , ("connected: 隣どうし・間が 1 マス", connected 6 sample 4 5 && connected 6 sample 3 5 && not (connected 6 sample 5 6))
  , ("connected: 行またぎは false",    not (connected 6 rowEnd 5 6))
  , ("connected: 縦",                  connected 6 rowEnd 5 11)
  , ("connected: 斜め",                connected 6 diag 0 14 && connected 6 diag 14 0)
  , ("connected: 斜めの途中に式",      not (connected 6 diagBlocked 0 14))
  , ("connected: 直線上にない",        not (connected 6 sample 0 8) && not (connected 6 sample 0 0) && connected 6 sample 0 7)
  , ("connected: 4 幅の斜め",          connected 4 (fromStrings ["p", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "q"]) 0 15)
  , ("collapseRows: 空の行が消える",   collapseRows 6 (replicate 6 Empty ++ [Tile (Var 'p')]) == [Tile (Var 'p')])
  , ("collapseRows: 途中の空マスは残る", collapseRows 6 [Tile (Var 'p'), Empty, Empty] == [Tile (Var 'p'), Empty, Empty])

  -- 乱数
  , ("nextSeed: SPEC の式",            nextSeed 1 == (1103515245 + 12345) `mod` 2147483648)
  , ("shuffle は並べ替え",             let (xs, _) = shuffle 42 [1 .. 10 :: Int] in length xs == 10 && all (`elem` xs) [1 .. 10])

  -- REFUTE
  , ("refute: 語彙にトートロジー・矛盾式がない", all (\n -> all (\f -> not (tautology f) && not (contradiction f)) (R.vocabulary (R.stageSpec n))) [1, 6, 11, 16, 21])
  , ("refute: 生成したボードは偶数枚で孤立なし", all (\b -> even (tileCount b) && R.noIsolated b) refuteBoards)
  , ("refute: 解を再生すると空になる",  all (\f -> isCleared (R.replay (R.fBoard f) (R.fSolution f))) refuteFound)
  , ("refute: 初手の組が 4 以上",      all ((>= 4) . R.fMoves) refuteFound)
  , ("refute: 検査対象のボードが存在する", length refuteFound >= 3)

  -- DERIVE: 規則
  , ("derive: MP(両方の順序)",        D.derive (prop "q") (prop "p") (prop ">pq") == Just (D.MP, prop "q")
                                     && D.derive (prop "q") (prop ">pq") (prop "p") == Just (D.MP, prop "q"))
  , ("derive: MT",                     D.derive (prop "!p") (prop "!q") (prop ">pq") == Just (D.MT, prop "!p"))
  , ("derive: DS(両側)",              D.derive (prop "q") (prop "!p") (prop "|pq") == Just (D.DS, prop "q")
                                     && D.derive (prop "p") (prop "!q") (prop "|pq") == Just (D.DS, prop "p"))
  , ("derive: ∧I は Goal の部分式のときだけ", D.derive (prop "&qp") (prop "p") (prop "q") == Just (D.ANDI, prop "&qp")
                                     && D.derive (prop ">&pqr") (prop "q") (prop "p") == Just (D.ANDI, prop "&pq")
                                     && D.derive (prop "r") (prop "p") (prop "q") == Nothing)
  , ("derive: ⊥ は Goal が F のときだけ", D.derive Bot (prop "p") (prop "!p") == Just (D.BOT, Bot)
                                     && D.derive (prop "q") (prop "p") (prop "!p") == Nothing)
  , ("derive: 完全一致(!!p と p は別)", D.derive (prop "q") (prop "!!p") (prop ">pq") == Nothing)
  , ("andE: 最初の空マスに B",         D.andE (fromStrings ["&pq", "", "r"]) 0 == Just (fromStrings ["p", "q", "r"]))
  , ("andE: 空マスがなければ不可",     D.andE (fromStrings ["&pq", "r"]) 0 == Nothing)
  , ("andE: ∧ でなければ不可",         D.andE (fromStrings ["p", ""]) 0 == Nothing)

  -- DERIVE: 探索と生成
  , ("derive: BFS の例(par 2)",       fmap length (D.bfs 8 (prop "r") (fromStrings [">pq", "", "", "p", "", "", "", "", ">qr", "", "", "", "", "", "", ""])) == Just 2)
  , ("derive: solution を再生すると Goal", all stageReplays deriveStagesT)
  , ("derive: par は範囲内で solution の長さ", all parOk deriveStagesT)
  , ("derive: 初期ボードに Goal がない", all (\(d, bs) -> not (any (D.reaches (D.dGoal d) . D.bCells) bs)) deriveStagesT)
  , ("derive: タイル数は 5〜9",        all (\(_, bs) -> all (\b -> let n = tileCount (D.bCells b) in n >= 5 && n <= 9) bs) deriveStagesT)
  ]
  where
    prefixSamples = ["p", "F", "!p", "&pq", "|p!q", ">&pqr", "!>pq", "&!&pq!|pq"]

    -- 乱数の式(深さ 3 まで)
    randomProps = [randomProp s 3 | s <- [1 .. 60]]
    randomSets  = [take 3 (drop k randomProps) | k <- [0, 3 .. 57]]
    randomPairs = [(a, b) | (a, b) <- zip randomProps (drop 1 randomProps)]

    -- 総当たり(Data.List なしの素朴版): 変数 p q r の 8 通りを全部試す
    bruteSat fs = or [all (eval [('p', a), ('q', b), ('r', c)]) fs | a <- [False, True], b <- [False, True], c <- [False, True]]

    sample      = fromStrings ["p", "", "", "q", "", "r", "!p", "", "", "", "", "", "", "", "q", "", "", ""]
    rowEnd      = fromStrings ["", "", "", "", "", "p", "q", "", "", "", "", "", "", "", "", "", "", ""]
    diag        = fromStrings ["p", "", "", "", "", "", "", "", "", "", "", "", "", "", "q", "", "", ""]
    diagBlocked = fromStrings ["p", "", "", "", "", "", "", "r", "", "", "", "", "", "", "q", "", "", ""]

    refuteBoards = [R.randomBoard s (R.stageSpec n) | (s, n) <- zip [1 ..] [1, 6, 11, 16, 21]]
    refuteFound  = [R.findBoard 3000 (R.stageSpec n) (n * 31 + 1) | n <- [1, 8, 13, 17, 22]]

    deriveStagesT = [snd' (D.findStage (D.dstageSpec n) (n * 101 + 3)) | n <- [1, 6, 11, 16, 17]]
    snd' (d, bs) = (d, bs)
    stageReplays (d, bs) = all (\b -> maybe False (D.reaches (D.dGoal d)) (D.replay (D.dGoal d) (D.bCells b) (D.bSolution b))) bs
    parOk (_, bs) = all (\b -> D.bPar b == length (D.bSolution b) && D.bPar b >= 2 && D.bPar b <= 8) bs

-- | シードから式を 1 つ(深さ d まで)。
randomProp :: Seed -> Int -> Prop
randomProp s d = fst (go s d)
  where
    go s0 0 = let (v, s1) = pick s0 [Var 'p', Var 'q', Var 'r', Bot] in (v, s1)
    go s0 n =
      let (k, s1) = randInt s0 6
      in case k of
           0 -> go s1 0
           1 -> let (a, s2) = go s1 (n - 1) in (Not a, s2)
           2 -> bin And s1 n
           3 -> bin Or s1 n
           4 -> bin Imp s1 n
           _ -> go s1 0
    bin op s0 n = let (a, s1) = go s0 (n - 1)
                      (b, s2) = go s1 (n - 1)
                  in (op a b, s2)

main :: IO ()
main = do
  hSetEncoding stdout utf8
  results <- mapM run tests
  let failed = length (filter not results)
  putStrLn (show (length tests - failed) ++ " passed, " ++ show failed ++ " failed")
  unless (failed == 0) exitFailure
  where
    run (name, ok) = do
      putStrLn ((if ok then "  ok   " else "  FAIL ") ++ name)
      return ok
