-- | 面データとテストベクタを JSON で書き出す。IO はこのファイルに閉じ込める。
--   使い方:  cabal run gen            (../web に書く)
--            cabal run gen -- <出力先>
module Main (main) where

import System.Environment (getArgs)
import System.IO
import Logic.Prop
import Logic.Grid
import Logic.Random
import qualified Logic.Refute as R
import qualified Logic.Derive as D
import Logic.Json

-- | 作るステージ数と、REFUTE の 1 回の探索に許すノード数。
refuteStages, deriveStages, refuteBudget, variantCount :: Int
refuteStages = 25
deriveStages = 20
refuteBudget = 3000   -- 小さめ: 探索がすぐ見つけるボード = 人にも筋道が見つけやすいボード
variantCount = 3

-- ---------------------------------------------------------------------------
-- REFUTE

-- | 1 ステージ = 同じ設定のボードを variantCount 枚(別シードから)。
refuteStage :: Int -> (R.StageSpec, [R.Found])
refuteStage n = (spec, [R.findBoard refuteBudget spec (n * 100003 + 7 + k * 104729) | k <- [0 .. variantCount - 1]])
  where spec = R.stageSpec n

refuteJson :: (R.StageSpec, [R.Found]) -> Json
refuteJson (spec, boards) = jObj
  [ ("stage",    jInt (R.specStage spec))
  , ("width",    jInt R.width)
  , ("shuffles", jInt (R.specShuffles spec))
  , ("boards",   jList (map boardJson boards))
  ]
  where
    boardJson f = jObj
      [ ("seed",           jInt (R.fSeed f))
      , ("cells",          cellsJson (R.fBoard f))
      , ("initialMoves",   jInt (R.fMoves f))
      , ("solutionLength", jInt (length (R.fSolution f)))
      ]

cellsJson :: Board -> Json
cellsJson = jList . map jStr . toStrings

-- ---------------------------------------------------------------------------
-- DERIVE

deriveStage :: Int -> (D.DStage, D.Derivation, [D.DBoard])
deriveStage n = (spec, d, boards)
  where
    spec        = D.dstageSpec n
    (d, boards) = D.findStage spec (n * 7919 + 11)

deriveJson :: (D.DStage, D.Derivation, [D.DBoard]) -> Json
deriveJson (spec, d, boards) = jObj
  [ ("stage",  jInt (D.dStage spec))
  , ("width",  jInt D.width)
  , ("height", jInt D.height)
  , ("goal",   jStr (toPrefix (D.dGoal d)))
  , ("boards", jList (map boardJson boards))
  ]
  where
    boardJson b = jObj
      [ ("seed",     jInt (D.bSeed b))
      , ("cells",    cellsJson (D.bCells b))
      , ("par",      jInt (D.bPar b))
      , ("solution", jList (map moveJson (D.bSolution b)))
      ]
    moveJson (D.Move r i j) = jList [jStr (D.ruleName r), jInt i, jInt j]

-- ---------------------------------------------------------------------------
-- テストベクタ

-- | 文字列から式へ(ベクタの手書き分)。読めない文字列はプログラムの誤りなので落とす。
prop :: String -> Prop
prop s = maybe (error ("bad prefix: " ++ s)) id (parse s)

-- | pretty: 各結合子・括弧の有無を網羅する手書きの一覧。
prettyCases :: [String]
prettyCases =
  [ "p", "q", "r", "F", "!p", "!!p", "!F", "!!!q"
  , "&pq", "|pq", ">pq", "&p!q", "|!pq", ">p!q", ">!p!q", "&!p!q"
  , "!&pq", "!|pq", "!>pq", "!!&pq", "!>!pq"
  , ">&pqr", "&p|qr", "|&pq&qr", ">>pqr", ">p>qr", "|p&qr", "&&pqr"
  , "!&p|qr", ">!&pqF", "|pF", "&F!p", ">pF", "&!&pq!|pq", ">|pq&qr", "|!&pq>pr", "!!>pq"
  ]

prettyJson :: Json
prettyJson = jList [jObj [("prefix", jStr s), ("pretty", jStr (pretty (prop s)))] | s <- prettyCases]

-- | unsat2: 手書き数件 + 乱数で選んだ組。真と偽を 50 件ずつにそろえる。
unsat2Json :: Json
unsat2Json = jList (map entry (handmade ++ take 50 trues ++ take 50 falses))
  where
    handmade = [("p", "!p"), ("p", "q"), ("F", "p"), ("&p!p", "q"), (">pq", "&p!q"), ("p", "p"), ("!!p", "!p")]
    vocab    = ["F", "&p!p", "|p!p"] ++ map toPrefix (R.vocabulary (R.stageSpec 21))
    pairsAll = randomPairs 20260101 vocab
    trues    = filter (\(a, b) -> unsat2 (prop a) (prop b)) pairsAll
    falses   = filter (\(a, b) -> not (unsat2 (prop a) (prop b))) pairsAll
    entry (a, b) = jObj [("a", jStr a), ("b", jStr b), ("unsat", jBool (unsat2 (prop a) (prop b)))]

-- | 無限に続く乱数の組。(第4章: 無限リスト iterate から必要なだけ取る)
randomPairs :: Seed -> [a] -> [(a, a)]
randomPairs s xs = go s
  where
    go s0 = let (a, s1) = pick s0 xs
                (b, s2) = pick s1 xs
            in (a, b) : go s2

-- | connected: 手書き(行またぎが false になる例を含む) + 乱数のボード。
connectedJson :: Json
connectedJson = jList (handmade ++ concatMap randomCase [1 .. 12 :: Int])
  where
    row6 = fromStrings ["", "", "", "", "", "p", "q", "", "", "", "", "", "", "", "", "", "", ""]
    sample = fromStrings ["p", "", "", "q", "", "r", "!p", "", "", "", "", "", "", "", "q", "", "", ""]
    diag = fromStrings ["p", "", "", "", "", "", "", "", "", "", "", "", "", "", "q", "", "", ""]
    handmade =
      [ entry 6 row6 5 6     -- 右端と次の行の左端: つながらない
      , entry 6 row6 5 11    -- 縦
      , entry 6 sample 0 3   -- 横、間が空
      , entry 6 sample 0 5   -- 横、間に q
      , entry 6 sample 3 5   -- 横、間(4)が空
      , entry 6 diag 0 14    -- 斜め (0,0)-(2,2)
      , entry 6 sample 5 6   -- 行またぎ(隣の添字だが別の行)
      , entry 4 (fromStrings ["p", "", "", "q", "", "", "", "", "", "", "", "", "r", "", "", "!p"]) 0 15
      , entry 4 (fromStrings ["p", "", "", "q", "", "", "", "", "", "", "", "", "r", "", "", "!p"]) 3 12
      , entry 4 (fromStrings ["p", "", "", "q", "", "q", "", "", "", "", "", "", "r", "", "", "!p"]) 0 15
      ]
    entry w b i j = jObj
      [ ("width", jInt w), ("cells", cellsJson b), ("i", jInt i), ("j", jInt j)
      , ("connected", jBool (connected w b i j)) ]
    -- 乱数のボード 1 枚につき、タイルどうしの組を 3 つ
    randomCase k =
      let s0       = k * 1000003 + 5
          (w, s1)  = pick s0 [6, 6, 4]
          n        = if w == 6 then 18 else 16 :: Int
          (cells, s2) = randomCells s1 n
          b        = fromStrings cells
          ps       = map fst (tiles b)
          (pairsK, _) = pickPairs s2 ps (3 :: Int)
      in [entry w b i j | (i, j) <- pairsK]
    randomCells s 0 = ([], s)
    randomCells s n = let (c, s')      = pick s ["", "", "p", "!q", "r", ">pq", "&p!q"]
                          (rest, s'')  = randomCells s' (n - 1)
                      in (c : rest, s'')
    pickPairs s _ 0 = ([], s)
    pickPairs s ps n = let (i, s1) = pick s ps
                           (j, s2) = pick s1 ps
                           (rest, s3) = pickPairs s2 ps (n - 1)
                       in (if i == j then rest else (i, j) : rest, s3)

-- | derive: 手書き(全規則と null) + 乱数の組。
deriveJsonVec :: Json
deriveJsonVec = jList (map entry (handmade ++ take 48 (randomTriples 777)))
  where
    handmade =
      [ ("q", "p", ">pq"), ("q", ">pq", "p"), ("!p", "!q", ">pq"), ("!p", ">pq", "!q")
      , ("q", "!p", "|pq"), ("p", "!q", "|pq"), ("p", "|pq", "!q")
      , ("&pq", "p", "q"), ("&qp", "p", "q"), ("&qp", "q", "p"), (">&pqr", "q", "p"), ("r", "p", "q")
      , ("F", "p", "!p"), ("F", "!p", "p"), ("q", "p", "!p"), ("F", "&pq", "!&pq")
      , ("q", "p", "q"), ("q", "!!p", ">!pq"), ("!q", "!q", ">pq"), ("r", ">pq", ">qr")
      , ("r", "&pq", ">&pqr"), ("!!p", "!!!q", ">!pq"), ("&p&qr", "q", "r"), ("&p&qr", "p", "&qr")
      ]
    goals = ["q", "!p", "r", "&pq", "&qp", "F", "&p&qr", "!q", "p"]
    vocab = ["p", "q", "r", "!p", "!q", "!r", ">pq", ">qp", ">p!q", ">!pq", ">qr", "|pq", "|!pq", "|qr", "&pq", "&qr", "F"]
    randomTriples s0 = let (g, s1) = pick s0 goals
                           (x, s2) = pick s1 vocab
                           (y, s3) = pick s2 vocab
                       in (g, x, y) : randomTriples s3
    entry (g, x, y) = jObj
      [ ("goal", jStr g), ("x", jStr x), ("y", jStr y)
      , ("result", maybe jNull (jStr . toPrefix . snd) r)
      , ("rule",   maybe jNull (jStr . D.ruleName . fst) r) ]
      where r = D.derive (prop g) (prop x) (prop y)

-- | andE: 手書きの例。
andEJson :: Json
andEJson = jList (map entry cases)
  where
    cases =
      [ (["&pq", "", "r"], 0), (["&pq", "r"], 0), (["p", ""], 0), (["", "&pq", ""], 1)
      , (["&pq", "r", "", ""], 0), (["r", "&p!q", "", "q"], 1), (["&&pqr", "", "", ""], 0)
      , (["", "", "&p|qr", ""], 2), (["&pq", "&qr", "", ""], 1), (["p", "q", "&pq", "r"], 2)
      , (["|pq", "", ""], 0), (["", "&pq"], 1), (["", "r", "&!pq", "", "p"], 2)
      ]
    entry (cells, i) = jObj
      [ ("cells", jList (map jStr cells)), ("i", jInt i)
      , ("result", maybe jNull (jList . map jStr . toStrings) (D.andE (fromStrings cells) i)) ]

vectorsJson :: Json
vectorsJson = jObj
  [ ("pretty",    prettyJson)
  , ("unsat2",    unsat2Json)
  , ("connected", connectedJson)
  , ("derive",    deriveJsonVec)
  , ("andE",      andEJson)
  ]

-- ---------------------------------------------------------------------------

main :: IO ()
main = do
  args <- getArgs
  let outDir = case args of
        (d : _) -> d
        []      -> "../web"
  hSetEncoding stdout utf8
  hSetBuffering stdout LineBuffering   -- 進み具合を 1 行ずつ表示する

  let rStages = map refuteStage [1 .. refuteStages]
  mapM_ reportRefute rStages
  writeFile (outDir ++ "/levels/refute.json") (render (jList (map refuteJson rStages)))

  let dStages = map deriveStage [1 .. deriveStages]
  mapM_ reportDerive dStages
  writeFile (outDir ++ "/levels/derive.json") (render (jList (map deriveJson dStages)))

  writeFile (outDir ++ "/test/vectors-logic.json") (render vectorsJson)
  putStrLn ("wrote refute " ++ show (length rStages) ++ " stages, derive " ++ show (length dStages)
            ++ " stages (x" ++ show variantCount ++ " boards), vectors")
  where
    reportRefute (spec, boards) = putStrLn $ concat
      [ "refute stage ", show (R.specStage spec)
      , " seeds=", show (map R.fSeed boards)
      , " moves=", show (map R.fMoves boards)
      , " solution=", show (map (length . R.fSolution) boards)
      ]
    reportDerive (spec, d, boards) = putStrLn $ concat
      [ "derive stage ", show (D.dStage spec)
      , " goal=", toPrefix (D.dGoal d)
      , " leaves=", show (map toPrefix (D.dLeaves d))
      , " par=", show (map D.bPar boards)
      , " tiles=", show (map (tileCount . D.bCells) boards)
      ]
