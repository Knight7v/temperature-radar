#!/usr/bin/env python3
"""机型性能PK 底图衍生器：从 4 列固定文字底图同一规范，生成 3 列 / 2 列 SVG。
仅调整：列边界、列线、胶囊、橙列位置、副标题台数；标题/行名/面板/光效全部照搬原规范。"""
from pathlib import Path

ROOT = Path('/Users/knight/Desktop/AI/02-HTML/workbench')
OUT = ROOT / 'assets' / 'pk'

# 4 列原版几何：内容 x20-1102，标签列 x20-170，机型列自 170 起
# 4 列: 170/403/636/869（各233）；3 列均分 932；2 列均分 932
VARIANTS = {
    '3col': {'cols': [170, 481, 791], 'end': 1102, 'sub': '三款明星挂机 满足不同家庭需求'},
    '2col': {'cols': [170, 636], 'end': 1102, 'sub': '两款明星挂机 满足不同家庭需求'},
}

FONT = 'PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif'


def build(n):
    cols = VARIANTS[n]['cols']
    end = VARIANTS[n]['end']
    sub = VARIANTS[n]['sub']
    ox = cols[-1]                       # 橙列左边界（最后一列）
    widths = [cols[i + 1] - cols[i] for i in range(len(cols) - 1)] + [end - cols[-1]]

    def vlines(y1, y2):
        return ' '.join(f'M{x} {y1}V{y2}' for x in cols)

    # 胶囊：x = 列起点+9，宽 = 列宽-19（与 4 列原版公式一致）
    pills = []
    for i, x in enumerate(cols):
        w = widths[i] - 19
        fill = 'url(#orangePill)' if i == len(cols) - 1 else 'url(#bluePill)'
        stroke = '#ffad42' if i == len(cols) - 1 else '#24bfff'
        sw = 1.8 if i == len(cols) - 1 else 1.5
        pills.append(f'    <rect x="{x + 9}" y="229" width="{w}" height="55" rx="25" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    pills = '\n'.join(pills)

    faint_blue = f'M170 575H{ox} M170 700H{ox}'
    faint_orange = f'M{ox} 575H1102 M{ox} 700H1102'
    lower_orange_rows = ' '.join(f'M{ox} {y}H1102' for y in (917, 1001, 1085, 1169, 1253))

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1122" height="1402" viewBox="0 0 1122 1402">
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#063174"/>
      <stop offset=".28" stop-color="#011950"/>
      <stop offset="1" stop-color="#01113c"/>
    </linearGradient>
    <radialGradient id="topLight" cx="50%" cy="0" r="60%">
      <stop offset="0" stop-color="#0866d8" stop-opacity=".58"/>
      <stop offset="1" stop-color="#0866d8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bottomLight" cx="50%" cy="100%" r="55%">
      <stop offset="0" stop-color="#0861c8" stop-opacity=".3"/>
      <stop offset="1" stop-color="#0861c8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bluePanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#063577"/>
      <stop offset=".52" stop-color="#002153"/>
      <stop offset="1" stop-color="#02194c"/>
    </linearGradient>
    <linearGradient id="labelPanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#053671"/>
      <stop offset="1" stop-color="#03204b"/>
    </linearGradient>
    <linearGradient id="orangePanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9d2b0b"/>
      <stop offset=".48" stop-color="#5f1b07"/>
      <stop offset="1" stop-color="#682012"/>
    </linearGradient>
    <linearGradient id="bluePill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#096eee"/>
      <stop offset=".54" stop-color="#0756d0"/>
      <stop offset="1" stop-color="#123d9c"/>
    </linearGradient>
    <linearGradient id="orangePill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff8724"/>
      <stop offset=".58" stop-color="#fb5a0f"/>
      <stop offset="1" stop-color="#d73a0b"/>
    </linearGradient>
    <clipPath id="upperClip"><rect x="20" y="216" width="1082" height="598" rx="15"/></clipPath>
    <clipPath id="lowerClip"><rect x="20" y="833" width="1082" height="505" rx="15"/></clipPath>
  </defs>

  <rect width="1122" height="1402" fill="url(#page)"/>
  <rect width="1122" height="380" fill="url(#topLight)"/>
  <rect y="1100" width="1122" height="302" fill="url(#bottomLight)"/>
  <path d="M0 58L280 168 M1122 58L842 168" fill="none" stroke="#257ded" stroke-opacity=".13" stroke-width="2"/>
  <path d="M0 80L275 173 M1122 80L847 173" fill="none" stroke="#257ded" stroke-opacity=".08" stroke-width="2"/>

  <!-- 上区：{len(cols)} 个机型列。纯背景，不含文字、产品图或参数。 -->
  <g clip-path="url(#upperClip)">
    <rect x="20" y="216" width="1082" height="598" fill="url(#bluePanel)"/>
    <rect x="20" y="216" width="150" height="598" fill="url(#labelPanel)"/>
    <rect x="{ox}" y="216" width="{end - ox}" height="598" fill="url(#orangePanel)"/>
    <path d="{vlines(216, 814)}" fill="none" stroke="#1761a8" stroke-width="1.6"/>
    <path d="M20 341H1102 M20 575H1102 M20 700H1102" fill="none" stroke="#1761a8" stroke-width="1.2"/>
    <path d="{faint_blue}" fill="none" stroke="#4aa4ec" stroke-opacity=".28" stroke-width="1"/>
    <path d="{faint_orange}" fill="none" stroke="#ffb064" stroke-opacity=".5" stroke-width="1"/>
{pills}
  </g>
  <rect x="20" y="216" width="1082" height="598" rx="15" fill="none" stroke="#0373d6" stroke-opacity=".38" stroke-width="11"/>
  <rect x="20" y="216" width="1082" height="598" rx="15" fill="none" stroke="#23c8ff" stroke-width="2.5"/>
  <path d="M{ox} 217V813" fill="none" stroke="#ff9d35" stroke-opacity=".4" stroke-width="8"/>
  <path d="M1101 231V800" fill="none" stroke="#ff9d35" stroke-opacity=".35" stroke-width="8"/>
  <path d="M{ox} 217V813" fill="none" stroke="#ff9d35" stroke-width="2.2"/>

  <!-- 下区：六条参数行，继续使用相同列线。 -->
  <g clip-path="url(#lowerClip)">
    <rect x="20" y="833" width="1082" height="505" fill="url(#bluePanel)"/>
    <rect x="20" y="833" width="150" height="505" fill="url(#labelPanel)"/>
    <rect x="{ox}" y="833" width="{end - ox}" height="505" fill="url(#orangePanel)"/>
    <path d="{vlines(833, 1338)}" fill="none" stroke="#1761a8" stroke-width="1.6"/>
    <path d="M20 917H1102 M20 1001H1102 M20 1085H1102 M20 1169H1102 M20 1253H1102" fill="none" stroke="#1761a8" stroke-width="1.2"/>
    <path d="{lower_orange_rows}" fill="none" stroke="#ff9d35" stroke-opacity=".45" stroke-width="1"/>
  </g>
  <rect x="20" y="833" width="1082" height="505" rx="15" fill="none" stroke="#0373d6" stroke-opacity=".38" stroke-width="11"/>
  <rect x="20" y="833" width="1082" height="505" rx="15" fill="none" stroke="#23c8ff" stroke-width="2.5"/>
  <path d="M{ox} 834V1337" fill="none" stroke="#ff9d35" stroke-opacity=".4" stroke-width="8"/>
  <path d="M1101 848V1323" fill="none" stroke="#ff9d35" stroke-opacity=".35" stroke-width="8"/>
  <path d="M{ox} 834V1337" fill="none" stroke="#ff9d35" stroke-width="2.2"/>

  <!-- 固定标题与字段名。机型、商品图和各参数值仍为空，供后续叠加。 -->
  <g font-family="{FONT}" text-anchor="middle" font-weight="900">
    <text x="561" y="142" font-size="121" fill="#1a67b5" opacity=".7">空调性能PK</text>
    <text x="561" y="137" font-size="121" fill="#f8fcff">空调性能PK</text>
  </g>
  <g fill="none" stroke="#a8d8ff" stroke-width="2" stroke-linecap="round" opacity=".9">
    <path d="M182 187H278 M844 187H940"/>
  </g>
  <text x="561" y="198" text-anchor="middle" fill="#f4f9ff" font-family="{FONT}" font-size="30" font-weight="700">{sub}</text>

  <g fill="#f7fbff" font-family="{FONT}" font-size="27" font-weight="700" text-anchor="start">
    <text x="43" y="290">型号</text>
    <text x="43" y="533">推荐理由</text>
    <text x="43" y="652">APF值</text>
    <text x="43" y="779">循环风量</text>
    <text x="43" y="885">铜管排数</text>
    <text x="43" y="969">节能模式</text>
    <text x="43" y="1053">运行温度</text>
    <text x="43" y="1137">清洁方式</text>
    <text x="43" y="1221">控制方式</text>
    <text x="43" y="1305">电量查询</text>
  </g>
</svg>
'''


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in VARIANTS:
        path = OUT / f'pk-bg-{name}.svg'
        path.write_text(build(name), encoding='utf-8')
        print('wrote', path)
    # 4 列底图：直接用用户提供的固定文字 v2，一个字节都不改
    src = ROOT / 'docs' / 'mockups' / '机型性能PK-高保真底图-固定文字-v2.png'
    dst = OUT / 'pk-bg-4col.png'
    if not dst.exists():
        dst.write_bytes(src.read_bytes())
        print('copied', dst)


if __name__ == '__main__':
    main()
