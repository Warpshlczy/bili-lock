#!/usr/bin/env python3
"""从 bilibili-API-collect 的分区表文档解析出 BiliLock 规则引擎数据源。

输入: docs/research/zone_v1.md, docs/research/zone_v2.md（pskdje/bilibili-API-collect 镜像，
      原仓库 SocialSisterYi/bilibili-API-collect 已转 deprecated，内容同步于 2026-01-25）
输出: src/lib/zones-data.json

可复现: python3 tools/parse_zones.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V1 = (ROOT / "docs/research/zone_v1.md").read_text(encoding="utf-8")
V2 = (ROOT / "docs/research/zone_v2.md").read_text(encoding="utf-8")


def strip_md(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"~~([^~]*)~~", "", s)  # 删除线=已废弃
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    return s.strip()


def parse_sections(md: str):
    """按 '## 名称' 切分, 返回 [(分区名, [表格行单元格数组])]"""
    out = []
    for sec in re.split(r"\n## ", md)[1:]:
        lines = sec.split("\n")
        name = lines[0].strip()
        for line in lines[1:]:
            if line.startswith("|") and not re.match(r"^\|[\s\-|]+\|$", line):
                cells = [strip_md(c) for c in line.strip().strip("|").split("|")]
                out.append((name, cells))
    return out


def parse_v1():
    """v1: | 名称 | 代号 | tid | 简介 | url路由 |"""
    mains, subs = [], []
    for sec_name, cells in parse_sections(V1):
        if len(cells) < 5 or not re.match(r"^\d+$", cells[2] or ""):
            continue
        name, code, tid, _intro, route = cells[:5]
        is_main = "主分区" in name
        # 提取 /v/xxx 或独立路由（去掉 /v/ 前缀本身，避免子分区 parent 误判为 "v"）
        m = re.search(r"/((?:v/)?[a-z0-9_]+(?:/[a-z0-9_]+)*)", route)
        slug = m.group(1) if m else ""
        if slug.startswith("v/"):
            slug = slug[2:]
        entry = {
            "tname": strip_md(name).replace("(主分区)", ""),
            "code": code,
            "tid": int(tid),
            "route": slug,
        }
        (mains if is_main else subs).append(entry)
    return mains, subs


def parse_v2():
    """v2: | 名称 | 代号 | tid | channelId | url 路由 |"""
    mains, subs = [], []
    current_main = None
    for sec_name, cells in parse_sections(V2):
        if len(cells) < 4 or not re.match(r"^\d+$", cells[2] or ""):
            continue
        name, code, tid = cells[0], cells[1], int(cells[2])
        is_main = "主分区" in name
        if is_main:
            current_main = code
            m = re.search(r"/(c/[a-z0-9_]+)", cells[4] if len(cells) > 4 else "")
            mains.append({
                "tname": name.replace("(主分区)", ""),
                "code": code,
                "tid": tid,
                "route": m.group(1).removeprefix("c/") if m else code,
            })
        elif current_main:
            subs.append({"tname": name, "code": code, "tid": tid, "parent": current_main})
    return mains, subs


# 手工补充: 站点级频道（无 /v/ 前缀或不在分区表中，但可从首页/频道页进入）
EXTRA_CHANNELS = [
    {"tname": "番剧", "code": "anime", "route": "anime"},
    {"tname": "国创", "code": "guochuang", "route": "guochuang"},
    {"tname": "纪录片", "code": "documentary", "route": "documentary"},
    {"tname": "电影", "code": "movie", "route": "movie"},
    {"tname": "电视剧", "code": "tv", "route": "tv"},
    {"tname": "综艺", "code": "variety", "route": "variety"},
    {"tname": "直播", "code": "live", "route": "live.bilibili.com"},
]

# 别名归一: 接口里可能出现的旧称/别称 -> 主分区 code
ALIASES = {
    "动画": "douga", "鬼畜": "kichiku", "音乐": "music", "舞蹈": "dance",
    "影视": "cinephile", "娱乐": "ent", "科技数码": "tech", "科技": "tech",
    "资讯": "information", "美食": "food", "小剧场": "shortplay", "汽车": "car",
    "时尚美妆": "fashion", "时尚": "fashion", "体育运动": "sports", "运动": "sports",
    "知识": "knowledge", "vlog": "vlog", "绘画": "painting", "人工智能": "ai",
    "家装房产": "home", "户外潮流": "outdoors", "健身": "gym", "手工": "handmake",
    "旅游出行": "travel", "三农": "rural", "亲子": "parenting", "健康": "health",
    "情感": "emotion", "生活兴趣": "life_joy", "生活经验": "life_experience",
    "生活": "life", "动物圈": "animal", "神秘学": "mysticism",
    "番剧": "anime", "国创": "guochuang", "纪录片": "documentary",
    "电影": "movie", "电视剧": "tv", "综艺": "variety", "游戏": "game",
    "生活其他": "life", "广告": "ad",
}


def main():
    v1m, v1s = parse_v1()
    v2m, v2s = parse_v2()
    data = {
        "_provenance": {
            "source": "SocialSisterYi/bilibili-API-collect (mirror: pskdje/bilibili-API-collect, master@2026-01-25)",
            "files": ["docs/video/video_zone.md", "docs/video/video_zone_v2.md"],
            "parsed_by": "tools/parse_zones.py",
        },
        "v1_main": v1m,
        "v1_sub": v1s,
        "v2_main": v2m,
        "v2_sub": v2s,
        "extra_channels": EXTRA_CHANNELS,
        "aliases": ALIASES,
    }
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    out = ROOT / "src/lib/zones-data.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    # 内容脚本无法 import JSON，同步产出全局变量版（manifest 按 classic script 加载）
    js = (
        "/* 由 tools/parse_zones.py 自动生成，请勿手改；再生成: python3 tools/parse_zones.py */\n"
        "(function () { globalThis.BILILOCK_ZONES_DATA = " + payload + "; })();\n"
    )
    (ROOT / "src/lib/zones-data.js").write_text(js, encoding="utf-8")
    print(f"v1 主分区 {len(v1m)} 子分区 {len(v1s)} | v2 主分区 {len(v2m)} 子分区 {len(v2s)}")
    print("v2 主分区:", ", ".join(f"{m['tname']}({m['code']})" for m in v2m))
    print("v1 主分区:", ", ".join(f"{m['tname']}({m['code']})" for m in v1m))
    print(f"写入 {out}")


if __name__ == "__main__":
    main()
