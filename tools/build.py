#!/usr/bin/env python3
"""BiliLock 构建：把多文件内容脚本合并为单文件 bundle。

背景：内容脚本按 manifest 的 js 数组逐文件注入，用户环境多次出现"目录部分文件
缺失/新旧混杂"导致规则引擎静默失效。bundle 把每个世界的脚本物理合并为一个文件，
消除该失效模式；同时构建时强校验源文件存在且非空。

用法: python3 tools/build.py
输出: dist/bililock-v<version>-bundle/   （可直接"加载已解压的扩展程序"）
      dist/bililock-v<version>-bundle.zip
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"

BANNER = "\n/* ==================== [%d/%d] %s ==================== */\n"


def concat(files: list) -> str:
    parts = []
    for i, rel in enumerate(files, 1):
        p = SRC / rel
        if not p.is_file() or p.stat().st_size == 0:
            raise SystemExit(f"[build] 源文件缺失或为空: {rel}")
        parts.append(BANNER % (i, len(files), rel) + p.read_text(encoding="utf-8"))
    return "\n".join(parts)


def main() -> None:
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    out = DIST / f"bililock-v{version}-bundle"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 1) 合并各世界的内容脚本
    for i, cs in enumerate(manifest["content_scripts"]):
        world = cs.get("world", "ISOLATED").lower()
        name = f"bundle-{world}.js"
        (out / name).write_text(concat(cs["js"]), encoding="utf-8")
        cs["js"] = [name]
        print(f"[build] {name} (world={cs.get('world', 'ISOLATED')}) <- {len(cs['js']) and ''}{name}")

    # 2) 复制其余资源（popup/options/background/assets/lib——lib 供扩展页面引用）
    for item in SRC.iterdir():
        if item.name == "manifest.json":
            continue
        dest = out / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)

    # 2.5) SW 加固：把 importScripts 的 lib 内联进 bundle 的 service-worker，
    #      消除相对路径解析（background/lib/...）这一真机故障源
    sw = out / "background" / "service-worker.js"
    sw_text = sw.read_text(encoding="utf-8")
    marker = 'importScripts("/lib/zones-data.js", "/lib/rules.js", "/lib/defaults.js");'
    if marker in sw_text:
        inline = "\n".join(
            (SRC / f).read_text(encoding="utf-8")
            for f in ["lib/zones-data.js", "lib/rules.js", "lib/defaults.js"]
        )
        sw_text = sw_text.replace(
            marker,
            "/* [build] lib 已内联（bundle 版无 importScripts） */\n" + inline,
        )
        sw.write_text(sw_text, encoding="utf-8")
        print("[build] service-worker: lib 已内联")

    # 3) 写入改写后的 manifest
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 4) 校验：bundle 目录里 manifest 引用的文件全部存在
    refs = [manifest["background"]["service_worker"], manifest["action"]["default_popup"],
            manifest["options_ui"]["page"]] + list(manifest["icons"].values())
    for cs in manifest["content_scripts"]:
        refs += cs["js"]
    missing = [r for r in refs if not (out / r).is_file()]
    if missing:
        raise SystemExit(f"[build] bundle 缺文件: {missing}")

    # 5) 打 zip
    zpath = DIST / f"bililock-v{version}-bundle.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(out.rglob("*")):
            if p.is_file() and p.name != ".DS_Store":
                zf.write(p, p.relative_to(out))
    print(f"[build] 完成: {out}")
    print(f"[build] 打包: {zpath} ({zpath.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
