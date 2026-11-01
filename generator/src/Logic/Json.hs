-- | JSON の書き出し(最小限)。ライブラリ(aeson)を使わず、文字列の結合だけで組み立てる。
--   文字列は ASCII だけで書く。非 ASCII 文字(pretty の ¬ ∧ ∨ → ⊥)は \uXXXX にエスケープする。
module Logic.Json
  ( Json
  , jNull, jInt, jBool, jStr, jList, jObj
  , render
  ) where

import Data.Char (ord)
import Data.List (intercalate)
import Numeric (showHex)

-- | JSON の値。文字列として組み立て済みのものを持つだけの薄い型。
newtype Json = Json String

render :: Json -> String
render (Json s) = s

jNull :: Json
jNull = Json "null"

jInt :: Int -> Json
jInt = Json . show

jBool :: Bool -> Json
jBool True  = Json "true"
jBool False = Json "false"

-- | 文字列。JSON のエスケープを自分で行う(Haskell の show は非 ASCII を \172 の形にするので使わない)。
jStr :: String -> Json
jStr s = Json ("\"" ++ concatMap esc s ++ "\"")
  where
    esc '"'  = "\\\""
    esc '\\' = "\\\\"
    esc '\n' = "\\n"
    esc c
      | ord c < 0x20 || ord c > 0x7e = "\\u" ++ pad4 (showHex (ord c) "")
      | otherwise                    = [c]
    pad4 h = replicate (4 - length h) '0' ++ h

jList :: [Json] -> Json
jList xs = Json ("[" ++ intercalate "," (map render xs) ++ "]")

jObj :: [(String, Json)] -> Json
jObj kvs = Json ("{" ++ intercalate "," [render (jStr k) ++ ":" ++ render v | (k, v) <- kvs] ++ "}")
