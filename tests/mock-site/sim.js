/* BiliLock 模拟站点装载器 —— 在无扩展环境复刻扩展行为（E2E）。
 * 用法: 页面引入本文件后引入全部扩展脚本（顺序同 manifest 双入口，合并为单世界模拟）。
 * 配置: localStorage["bililock.sim.config"] = JSON(config)，控制面板可写入并刷新。
 */
(function () {
  "use strict";
  /* ---- chrome.* 桩 ---- */
  var PRESETS = {
    default: { blockedZones: [], removeAds: true, hideComments: false, hideRecommend: false, favoritesOnly: false, pureVideoMode: false },
    block_kichiku: { blockedZones: ["kichiku"], removeAds: true, hideComments: false, hideRecommend: false, favoritesOnly: false, pureVideoMode: false },
    pure_video: { blockedZones: [], removeAds: true, hideComments: false, hideRecommend: false, favoritesOnly: false, pureVideoMode: true },
    fav_only: { blockedZones: [], removeAds: true, hideComments: false, hideRecommend: false, favoritesOnly: true, pureVideoMode: false },
  };

  var favFixture = {
    uid: "9527",
    favset: { bvids: ["BV4000000FAV", "BV5000000FAV"], items: [], ts: Date.now() },
  };

  function simConfig() {
    try {
      var raw = localStorage.getItem("bililock.sim.config");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return PRESETS.default;
  }

  window.chrome = {
    storage: {
      sync: {
        get: function (key, cb) { var r = {}; r[key] = simConfig(); setTimeout(function () { cb(r); }, 0); },
        set: function () {},
      },
      local: {
        get: function (key, cb) {
          var r = {};
          r[key] = key === "bililock.favset" ? favFixture.favset : null;
          setTimeout(function () { cb(r); }, 0);
        },
      },
      onChanged: { addListener: function () {} },
    },
    runtime: {
      sendMessage: function () {},
      lastError: null,
      onMessage: { addListener: function () {} },
    },
    cookies: { get: function (o, cb) { cb({ value: favFixture.uid }); } },
  };

  /* Cookie 桩（uid 用于收藏夹链接） */
  Object.defineProperty(document, "cookie", {
    get: function () { return "DedeUserID=" + favFixture.uid + "; SESSDATA=sim"; },
    configurable: false,
  });

  /* 分区缓存种子（真实环境中由接口拦截建立；模拟环境直接给定，保证判定确定性） */
  try {
    sessionStorage.setItem("bililock.bvidzone", JSON.stringify({
      BV1000000KIC: "鬼畜", BV1000000KI2: "鬼畜", BV2000000MUS: "音乐",
      BV3000000GAM: "游戏", BV4000000FAV: "音乐", BV5000000FAV: "知识",
      BV3000000AD1: "广告",
    }));
  } catch (e) {}

  /* 模拟 URL：页面声明 window.BILILOCK_SIM_URL 后，location.href 分类即以该 URL 为准。
   * 在 DOMContentLoaded（main.js boot 之前，本文件先注册）注入分类器：
   *  - setUrlClassifier 供 rules.js 内部 isPageLocked 使用；
   *  - 覆盖导出的 classifyUrl 供 main.js / nav-guard / dom-cleaner 使用。 */
  document.addEventListener("DOMContentLoaded", function () {
    if (window.BILILOCK_SIM_URL && globalThis.BiliLockRules && globalThis.BiliLockRules.setUrlClassifier) {
      var orig = globalThis.BiliLockRules.classifyUrl;
      var wrapped = function (url) {
        return orig(url === location.href ? window.BILILOCK_SIM_URL : url);
      };
      globalThis.BiliLockRules.setUrlClassifier(wrapped);
      globalThis.BiliLockRules.classifyUrl = wrapped;
    }
  });

  /* ---- 控制面板 ---- */
  function panel() {
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483646;background:#fff;border:2px solid #00a1d6;border-radius:10px;padding:10px;font:12px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.25);";
    var html = '<b style="color:#00a1d6">BiliLock 模拟控制台</b><br/>';
    Object.keys(PRESETS).forEach(function (k) {
      html += '<button data-p="' + k + '" style="margin:4px 4px 0 0;padding:3px 8px;cursor:pointer">' + k + "</button>";
    });
    html += '<div style="color:#888;margin-top:4px">当前: ' + (localStorage.getItem("bililock.sim.config") ? "自定义" : "default") + "</div>";
    box.innerHTML = html;
    box.addEventListener("click", function (e) {
      var p = e.target && e.target.dataset && e.target.dataset.p;
      if (!p) return;
      localStorage.setItem("bililock.sim.config", JSON.stringify(PRESETS[p]));
      location.reload();
    });
    document.body.appendChild(box);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", panel);
  } else {
    setTimeout(panel, 0);
  }
})();
