#!/usr/bin/env python3
"""くみあわせ（QumiAwase）のアイコン・ロゴ・OGP を作る。

名前は「くみあわせ」（組み合わせ）。英字は QumiAwase（「く」を Q にする。おくるん＝OQRN・そらくる＝SoraQru と同じ作り方）。
アイコンはおくるんと同じ角の丸い四角に、夕焼けのようなオレンジ（ほかの Q のツールと重ならない色）。
Q は白い輪。右下へのびるしっぽは、トーナメント表の線（2本が1本にまとまって、次の回へ）。

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「QumiAwase」（Jua。Q はアイコンと同じ形）
  ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
from pathlib import Path

import brandkit_path  # noqa: F401
from brandkit import Brand, centered, polar

ROOT = Path(__file__).resolve().parent.parent
BRAND = Brand(light=(255, 170, 110), dark=(217, 98, 43))  # style.css の --ls-accent #d9622b

C = (40, 40)
R, RING_W = 22, 12

# しっぽ：トーナメント表の線。上と下の2本が縦の線でまとまり、右へ1本（勝ち上がり）
X0 = C[0] + 20
TOP, BOTTOM = C[1] + 22, C[1] + 38
XM = X0 + 12
SHAPES = [
    {"t": "ring", "c": C, "r": R, "w": RING_W, "fill": "white"},
    {"t": "line", "p": [(X0, TOP), (XM, TOP)], "w": 6, "fill": "white"},
    {"t": "line", "p": [(X0, BOTTOM), (XM, BOTTOM)], "w": 6, "fill": "white"},
    {"t": "line", "p": [(XM, TOP - 3), (XM, BOTTOM + 3)], "w": 6, "fill": "white"},
    {"t": "line", "p": [(XM, (TOP + BOTTOM) / 2), (XM + 14, (TOP + BOTTOM) / 2)], "w": 6, "fill": "white"},
    {"t": "circle", "c": (XM + 16, (TOP + BOTTOM) / 2), "r": 5.5, "fill": "white"},
]
SHAPES, (_DX, _DY) = centered(SHAPES)
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


# アイコン・ロゴ・OGP の画像をまとめて作る（python3 tools/icon.py で動かす）
def main():
    BRAND.write_icons(ROOT, SHAPES)
    logo, ratio = BRAND.logo_svg("QumiAwase", SHAPES, C, RING_OUTER, "QumiAwase（くみあわせ）")
    (ROOT / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(
        ROOT / "ogp.png", SHAPES, "くみあわせ", "QumiAwase",
        ["トーナメント・総当たりの組み合わせと日程", "結果から、勝ち上がりと順位表まで"], None,
        copy="トーナメントも総当たりも、すぐできる",
    )
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
