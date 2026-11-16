#!/usr/bin/env python3
"""
whiten-brand.py —— 去品牌标识（涂白）小工具，订单/评审链路常用。

场景：客户要求「不带品牌 logo」，但订单里挂的还是 CP 的旧图样（铭牌图样、彩盒标、卡通箱标）。
做法：复用原图，只把品牌字标那块涂成白色，其余内容（型号、SN、条码、CE/RoHS）一字不动。

为什么要有 probe 模式：手算坐标二次缩放最容易错——本次现场就把 `(` 和 `客` 一起涂掉了。
先用 --probe 看 ink 行带与列簇，再用精确 box 去涂，涂完看 compare 图确认。

用法
----
# 1) 探坐标（只读，不改文件）
python3 whiten-brand.py --probe --image a.png --box 0,0,700,140

# 2) 涂白（每块标识一个 --box，可重复）
python3 whiten-brand.py --image a.png --box 218,50,582,121 --out-dir out

# 3) 只看效果不落最终文件（只出对照图）
python3 whiten-brand.py --image a.png --box 218,50,582,121 --dry-run --out-dir out

参数
----
--box L,T,R,B   提示框（原图像素坐标，左上含、右下不含）。工具只在框内找 ink 并涂白，
                框外一个像素都不碰。可重复。
--threshold N   灰度阈值，默认 128（<N 视为墨）
--margin N      白框外扩像素，默认 4
--dry-run       只出对照图，不写 *_whitened.png
--suffix S      输出后缀，默认 _whitened

约定
----
- 同尺寸、同格式输出，不重采样、不转格式。
- 断言：ink 面积占框 < 60%（防整块涂掉）、bbox 不能同时贴满四边（防框选小了）。
- 失败即退非 0，不写半成品。
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit('需要 Pillow：pip install pillow')


def parse_box(text):
    parts = [p.strip() for p in str(text).split(',')]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError('--box 需要 L,T,R,B 四个整数')
    try:
        left, top, right, bottom = (int(float(p)) for p in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'--box 不是整数：{text}') from exc
    if right <= left or bottom <= top:
        raise argparse.ArgumentTypeError(f'--box 右下必须大于左上：{text}')
    return left, top, right, bottom


def ink_mask(gray_crop, threshold):
    return gray_crop.point(lambda v: 255 if v < threshold else 0)


def clusters(values, gap=2):
    """把离散坐标切成连续簇（间距 > gap 断开）"""
    out = []
    if not values:
        return out
    start = prev = values[0]
    for value in values[1:]:
        if value - prev > gap:
            out.append((start, prev))
            start = value
        prev = value
    out.append((start, prev))
    return out


def probe(im, box, threshold):
    """打印框内 ink 的行带与每个行带的列簇（原图坐标）"""
    left, top, right, bottom = box
    gray = im.convert('L')
    crop = gray.crop(box)
    width, height = crop.size
    pixels = crop.load()
    rows = []
    for y in range(height):
        hit = [x for x in range(width) if pixels[x, y] < threshold]
        if hit:
            rows.append((y, hit))
    print(f'\n[box {left},{top},{right},{bottom}] 尺寸 {width}×{height}')
    if not rows:
        print('  框内没有 ink（换 box，或调 --threshold）')
        return 0
    bands = clusters([y for y, _ in rows], gap=1)
    print(f'  ink 行带 {len(bands)} 段：')
    total = 0
    for y0, y1 in bands:
        xs = sorted({x for y, hit in rows if y0 <= y <= y1 for x in hit})
        cols = clusters(xs, gap=2)
        total += sum(len(hit) for y, hit in rows if y0 <= y <= y1)
        span = f'{left + cols[0][0]}-{left + cols[-1][1]}' if cols else '-'
        print(f'    y {top + y0}-{top + y1}  x {span}  列簇 {len(cols)} 段')
        if len(cols) <= 12:
            print('      ' + ' '.join(f'{left + a}-{left + b}' for a, b in cols))
    print(f'  合计 ink 像素 {total}（占框 {total / (width * height):.1%}）')
    return 0


def whitened_bbox(crop, threshold, margin, box):
    """框内 ink 的 bbox，外扩 margin；同时做面积与贴边断言"""
    left, top, right, bottom = box
    mask = ink_mask(crop.convert('L'), threshold)
    bbox = mask.getbbox()
    if not bbox:
        raise SystemExit(f'[{left},{top},{right},{bottom}] 框内没有 ink，未生成任何文件')
    width, height = crop.size
    area = sum(1 for px in mask.getdata() if px)
    if area / (width * height) >= 0.6:
        raise SystemExit(f'[{left},{top},{right},{bottom}] ink 占框 {area / (width * height):.1%}，疑似框选过大，拒绝整块涂白')
    x0, y0, x1, y1 = bbox
    if x0 <= 1 and y0 <= 1 and x1 >= width - 1 and y1 >= height - 1:
        raise SystemExit(f'[{left},{top},{right},{bottom}] ink 贴满四边，框可能选小了，拒绝执行')
    return (
        max(0, left + x0 - margin),
        max(0, top + y0 - margin),
        min(left + width, left + x1 + margin),
        min(top + height, top + y1 + margin),
    )


def main(argv=None):
    ap = argparse.ArgumentParser(add_help=True, description='去品牌标识涂白（框内 ink 变白，其余不动）')
    ap.add_argument('--image', required=True, help='输入 PNG/JPEG')
    ap.add_argument('--box', action='append', type=parse_box, default=[], help='L,T,R,B，可重复')
    ap.add_argument('--out-dir', default='', help='输出目录，默认与输入同目录')
    ap.add_argument('--suffix', default='_whitened', help='输出后缀，默认 _whitened')
    ap.add_argument('--threshold', type=int, default=128, help='灰度阈值，默认 128')
    ap.add_argument('--margin', type=int, default=4, help='白框外扩像素，默认 4')
    ap.add_argument('--probe', action='store_true', help='只读：打印 ink 行带与列簇')
    ap.add_argument('--dry-run', action='store_true', help='只出对照图，不写 *_whitened')
    args = ap.parse_args(argv)

    src = Path(args.image).expanduser()
    if not src.is_file():
        raise SystemExit(f'找不到图片：{src}')
    if not args.box:
        raise SystemExit('至少要给一个 --box（先用 --probe 探坐标）')

    im = Image.open(src)
    im.load()
    if args.probe:
        for box in args.box:
            probe(im, box, args.threshold)
        return 0

    out_dir = Path(args.out_dir).expanduser() if args.out_dir else src.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    work = im.convert('RGB') if im.mode in ('RGBA', 'LA', 'P') else im.copy()
    draw = ImageDraw.Draw(work)
    rects = []
    for box in args.box:
        rect = whitened_bbox(im.crop(box), args.threshold, args.margin, box)
        rects.append(rect)
        print(f'box {box} → 白框 {rect}')
        draw.rectangle(rect, fill=(255, 255, 255))

    compare = Image.new('RGB', (im.width * 2 + 12, im.height), (235, 235, 235))
    compare.paste(im.convert('RGB'), (0, 0))
    compare.paste(work, (im.width + 12, 0))
    compare_path = out_dir / f'{src.stem}_compare.png'
    compare.save(compare_path)
    print(f'对照图（左原图 / 右涂白）：{compare_path}')

    if args.dry_run:
        print('dry-run：未写最终文件')
        return 0

    suffix = args.suffix or '_whitened'
    out_path = out_dir / f'{src.stem}{suffix}{src.suffix or ".png"}'
    work.save(out_path, format='PNG' if src.suffix.lower() in ('.png', '') else im.format)
    print(f'输出：{out_path}（{work.size[0]}×{work.size[1]}，与输入同尺寸）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
