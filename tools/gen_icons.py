#!/usr/bin/env python3
"""生成 BiliLock 扩展图标（纯标准库 PNG 写入，无 PIL 依赖）。
深蓝底圆角方块 + 白色挂锁图形。
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "assets"
BG = (16, 20, 26, 255)        # #10141a
FG = (255, 255, 255, 255)     # 白
ACCENT = (0, 161, 214, 255)   # B 站蓝 #00a1d6


def png_chunk(tag: bytes, data: bytes) -> bytes:
    raw = tag + data
    return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixels) -> None:
    rows = b""
    for y in range(size):
        rows += b"\x00"
        for x in range(size):
            rows += bytes(pixels(x, y))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    data = b"".join([
        b"\x89PNG\r\n\x1a\n",
        png_chunk(b"IHDR", ihdr),
        png_chunk(b"IDAT", zlib.compress(rows, 9)),
        png_chunk(b"IEND", b""),
    ])
    path.write_bytes(data)


def in_rounded_rect(x, y, s, r=0.22):
    """圆角方块内部判定"""
    m = s * r
    if x < m and y < m and (m - x) ** 2 + (m - y) ** 2 > m ** 2:
        return False
    if x > s - m and y < m and (x - (s - m)) ** 2 + (m - y) ** 2 > m ** 2:
        return False
    if x < m and y > s - m and (m - x) ** 2 + (y - (s - m)) ** 2 > m ** 2:
        return False
    if x > s - m and y > s - m and (x - (s - m)) ** 2 + (y - (s - m)) ** 2 > m ** 2:
        return False
    return True


def make_pixel(size):
    def pixel(x, y):
        # 坐标系以左上为原点，浮点中心化
        fx, fy = x + 0.5, y + 0.5
        if not in_rounded_rect(fx, fy, size):
            return (0, 0, 0, 0)
        # 锁环: 圆心 (0.5, 0.36) 外径 0.17 内径 0.10 (相对)
        cx, cy = size * 0.5, size * 0.36
        d = ((fx - cx) ** 2 + (fy - cy) ** 2) ** 0.5
        ro, ri = size * 0.17, size * 0.10
        # 锁体: 圆角矩形 (0.26,0.42)-(0.74,0.78)
        if ri <= d <= ro and fy <= cy + size * 0.02:
            return FG
        if size * 0.26 <= fx <= size * 0.74 and size * 0.44 <= fy <= size * 0.76:
            # 锁孔: 竖条 + 圆点
            if abs(fx - cx) <= size * 0.035 and size * 0.52 <= fy <= size * 0.66:
                return ACCENT
            kc = size * 0.585
            if ((fx - cx) ** 2 + (fy - kc) ** 2) ** 0.5 <= size * 0.055:
                return ACCENT
            return FG
        return BG
    return pixel


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(OUT / f"icon{s}.png", s, make_pixel(s))
    print("icons ->", OUT)


if __name__ == "__main__":
    main()
