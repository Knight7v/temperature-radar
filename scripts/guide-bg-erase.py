#!/usr/bin/env python3
"""模板二（格力空调选购指南 750×1041）抹字：抹掉会变化的文字，保留标题/行名/产品图/落款。
用列内垂直插值回填（面板渐变以纵向为主），--rects 画矩形自检几何。"""
import sys
from PIL import Image, ImageFilter, ImageDraw

RAW = '/Users/knight/Desktop/AI/02-HTML/workbench/assets/pk/guide-bg-raw.jpg'
OUT = '/Users/knight/Desktop/AI/02-HTML/workbench/assets/pk/guide-bg-clean.png'
RECTS_PNG = '/tmp/guide-rects.png'

# 四个数据列的内部区间（分界按面板亮度实测：~289 / ~449 / ~579；右边框 741）
COLS = [(126, 286), (293, 446), (455, 577), (581, 740)]
# 四个机名胶囊内部（避开胶囊圆角边缘）
PILLS = [(168, 278), (300, 444), (462, 576), (596, 740)]

# (y0, y1) 各行数据区（列内插值的上下采样点；采样线必须落在行内空白处，不能压字或分隔线）
BANDS = [
    ('pill-text',  131, 165),   # 胶囊文字（用 PILLS 的 x）
    ('acimg',      172, 292),   # 原机照片整块抹掉（照片必须来自所选机型的商品主图，不能烤死）
    ('reason',     312, 376),
    ('model',      384, 416),
    ('apf',        421, 467),
    ('temp',       473, 515),   # 金字两行 475-510，分隔线 518
    ('vane',       525, 556),   # 文字 530-545，分隔线 560
    ('clean',      564, 605),   # 金字两行 567-600，分隔线 622
    ('air',        617, 650),   # 数字 622-634
    ('swing',      658, 722),
    ('ctrl',       728, 772),
    ('tempctl',    778, 817),
    ('sleep',      823, 867),
    ('light',      873, 922),
]


def erase_band(im, x0, x1, y0, y1):
    """列内垂直插值：对每一列 x，用 y0-2 与 y1+2 两行的像素做线性过渡。"""
    px = im.load()
    top, bot = max(0, y0 - 2), min(im.height - 1, y1 + 2)
    span = bot - top
    for x in range(x0, x1):
        c0 = px[x, top]
        c1 = px[x, bot]
        for y in range(y0, y1 + 1):
            t = (y - top) / span
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))


def main():
    check_only = '--rects' in sys.argv
    im = Image.open(RAW).convert('RGB')
    if check_only:
        d = ImageDraw.Draw(im)
        for name, y0, y1 in BANDS:
            xs = PILLS if name == 'pill-text' else COLS
            for (x0, x1) in xs:
                d.rectangle([x0, y0, x1, y1], outline=(255, 105, 180), width=2)
        im.save(RECTS_PNG)
        print('rects ->', RECTS_PNG)
        return
    for name, y0, y1 in BANDS:
        xs = PILLS if name == 'pill-text' else COLS
        for (x0, x1) in xs:
            erase_band(im, x0, x1, y0, y1)
    # 型号行 col4 的编码跨过分界缝隙（577-581），单独补一刀
    erase_band(im, 577, 582, 384, 416)
    # 抹过的区域整体轻模糊，融掉插值条纹
    blurred = im.filter(ImageFilter.GaussianBlur(1.2))
    for name, y0, y1 in BANDS:
        xs = PILLS if name == 'pill-text' else COLS
        for (x0, x1) in xs:
            im.paste(blurred.crop((x0, y0, x1 + 1, y1 + 1)), (x0, y0))
    im.save(OUT, quality=95)
    print('clean ->', OUT)


if __name__ == '__main__':
    main()
