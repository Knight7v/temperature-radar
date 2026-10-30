#!/usr/bin/env python3
"""PK 底图抹字 v2：真实坐标 + 整带垂直插值回填。--rects 仅画矩形自检几何。"""
from PIL import Image, ImageDraw, ImageFilter
import sys

SRC = '/Users/knight/Desktop/AI/02-HTML/workbench/assets/pk/pk-ac-bg-raw.jpg'
DST = '/Users/knight/Desktop/AI/02-HTML/workbench/assets/pk/pk-ac-bg-clean.jpg'
DBG = '/tmp/pk-rects.png'

# 数据列面板真实 x 范围（含 4px 内缩）
COLS = [(170, 385), (400, 619), (640, 856), (872, 1104)]
# 胶囊内部真实 x 范围
PILLS = [(174, 372), (412, 613), (648, 849), (880, 1087)]

# (y0, y1, 采样上边距, 采样下边距, x范围列表)
BANDS = [
    (234, 288, 7, 7, PILLS),   # 机名胶囊
    (294, 330, 2, 3, COLS),    # 型号代码
    (471, 567, 4, 4, COLS),    # 推荐理由
    (579, 701, 4, 4, COLS),    # APF 大数字（含辉光）
    (709, 823, 4, 4, COLS),    # 循环风量
    (856, 928, 4, 4, COLS),    # 铜管排数
    (941, 996, 4, 4, COLS),    # 节能模式
    (1017, 1066, 4, 4, COLS),  # 运行温度
    (1098, 1154, 4, 4, COLS),  # 清洁方式
    (1180, 1229, 4, 4, COLS),  # 控制方式
    (1267, 1312, 4, 4, COLS),  # 电量查询
]

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

if '--rects' in sys.argv:
    d = ImageDraw.Draw(im)
    for y0, y1, mt, mb, xs in BANDS:
        for x0, x1 in xs:
            d.rectangle([x0, y0, x1, y1], outline=(255, 0, 255), width=2)
            d.line([(x0, y0 + mt), (x1, y0 + mt)], fill=(0, 255, 0), width=1)
            d.line([(x0, y1 - mb), (x1, y1 - mb)], fill=(0, 255, 0), width=1)
    im.save(DBG)
    print('saved', DBG)
    sys.exit(0)

for y0, y1, mt, mb, xs in BANDS:
    for x0, x1 in xs:
        ya, yb = y0 + mt, y1 - mb   # 上下采样行
        for x in range(x0, x1 + 1):
            ca, cb = px[x, ya], px[x, yb]
            span = yb - ya
            for y in range(y0, y1 + 1):
                t = max(0.0, min(1.0, (y - ya) / span))
                px[x, y] = (
                    int(ca[0] + (cb[0] - ca[0]) * t),
                    int(ca[1] + (cb[1] - ca[1]) * t),
                    int(ca[2] + (cb[2] - ca[2]) * t),
                )

im = im.filter(ImageFilter.GaussianBlur(0.5))
im.save(DST, quality=93)
print('saved', DST)
