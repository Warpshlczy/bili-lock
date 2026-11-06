/* BiliLock 内容脚本装配（ISOLATED world, document_start）。
 * 职责: 配置装载与镜像 → 页面锁定评估（L4）→ 各层启停 → SPA 软导航重评估。
 */
(function () {
  "use strict";
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  var PC = globalThis.BiliLockPageContext;
  var UI = globalThis.BiliLockUI;
  var Cleaner = globalThis.BiliLockDomCleaner;
  var Guard = globalThis.BiliLockNavGuard;

  /* 依赖守卫：lib 文件缺失/版本混杂时给出可读错误，而不是裸 TypeError */
  var MISSING = [];
  if (!D) MISSING.push("lib/defaults.js");
  if (!Rules) MISSING.push("lib/rules.js");
  if (!PC) MISSING.push("content/page-context.js");
  if (!UI) MISSING.push("content/lock-screen.js");
  if (!Cleaner) MISSING.push("content/dom-cleaner.js");
  if (!Guard) MISSING.push("content/nav-guard.js");
  if (MISSING.length) {
    console.error("[BiliLock] 内容脚本依赖缺失: " + MISSING.join(", ") +
      " —— 扩展目录文件不完整或新旧混杂。请删除 chrome://extensions 中的 BiliLock，" +
      "用完整的 v1.0.2 目录重新加载，并强刷（Cmd+Shift+R）B 站页面。");
    return;
  }

  var state = {
    config: Object.assign({}, D.DEFAULT_CONFIG),
    favSet: null,        // Set<bvid> | null
    favKnown: false,     // 是否已取得收藏夹数据
    uid: null,
    videoZone: null,     // 主分区 code | null
    lastUrl: location.href,
    favUrl: null,
  };

  /* ---------- 配置镜像（MAIN world 的 shim 消费） ---------- */
  function mirrorConfig() {
    try {
      sessionStorage.setItem(D.KEYS.MIRROR_CONFIG, JSON.stringify(state.config));
      window.dispatchEvent(new CustomEvent(D.EVENTS.CONFIG_MIRROR, { detail: state.config }));
    } catch (e) { /* noop */ }
  }

  /* 配置尽早装载并镜像：MAIN world 的 net-shim 在首屏 feed/收藏夹请求发出前
   * 就能拿到 blockedZones，否则接口层会放行第一批数据（页面打开时的核心漏点）。 */
  var configReady = null;
  function loadConfig() {
    if (configReady) return configReady;
    configReady = new Promise(function (resolve) {
      function finish(saved) {
        state.config = Object.assign({}, D.DEFAULT_CONFIG, saved || {});
        mirrorConfig();
        resolve(state.config);
      }
      try {
        chrome.storage.sync.get(D.KEYS.SYNC_CONFIG, function (res) {
          finish(res && res[D.KEYS.SYNC_CONFIG]);
        });
      } catch (e) {
        finish(null);
      }
    });
    return configReady;
  }
  loadConfig(); // 脚本注入即执行（document_start），不等待 DOMContentLoaded

  /* ---------- 收藏夹集合（FR5） ---------- */
  function loadFavSet() {
    if (!chrome.storage || !chrome.storage.local) return Promise.resolve(null);
    return new Promise(function (resolve) {
      chrome.storage.local.get(D.KEYS.LOCAL_FAVSET, function (res) {
        var data = res && res[D.KEYS.LOCAL_FAVSET];
        if (data && data.bvids && data.bvids.length) {
          resolve({ set: new Set(data.bvids), items: data.items || [], ts: data.ts });
        } else {
          resolve(null);
        }
      });
    });
  }

  function requestFavRefresh(reason) {
    if (!state.uid) return;
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_REFRESH_FAV", uid: state.uid }, function () {
        if (chrome.runtime.lastError) { /* SW 未就绪等，忽略 */ }
      });
    } catch (e) { /* noop */ }
  }

  function refreshFavUrl() {
    state.favUrl = state.uid ? "https://space.bilibili.com/" + state.uid + "/favlist" : null;
  }

  /* ---------- 页面锁定评估（L4） ---------- */
  function evaluateLock() {
    var verdict = Rules.isPageLocked(state.config, location.href, {
      favSet: state.favSet,
      favKnown: state.favKnown,
      videoZone: state.videoZone,
    });
    if (verdict.locked) {
      UI.show({
        reason: verdict.reason,
        lockMessage: state.config.lockMessage,
        favoritesOnly: !!state.config.favoritesOnly,
        favUrl: state.config.favoritesOnly ? state.favUrl : null,
      });
      return true;
    }
    UI.hide();
    return false;
  }

  /* ---------- 运行时分区库（子分区→主分区全量映射，FR1 覆盖面保证） ---------- */
  function mirrorZoneTable(t) {
    try {
      sessionStorage.setItem(D.KEYS.MIRROR_ZONETABLE, JSON.stringify({
        tidToCode: t.tidToCode || {}, tnameToCode: t.tnameToCode || {}, ts: t.ts || 0,
      }));
      window.dispatchEvent(new CustomEvent(D.EVENTS.ZONETABLE_MIRROR));
    } catch (e) { /* noop */ }
  }

  function applyZoneTable(t) {
    if (!t || !t.tidToCode) return;
    Rules.enrichZoneTable(t);
    mirrorZoneTable(t);
  }

  function loadZoneTable() {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(D.KEYS.LOCAL_ZONETABLE, function (res) {
      var t = res && res[D.KEYS.LOCAL_ZONETABLE];
      if (t && t.tidToCode) {
        applyZoneTable(t);
        requestZoneRefresh(t);
      } else {
        requestZoneRefresh(null);
      }
    });
  }

  /** 已勾选主分区若未收割/过期 → 请求后台拉榜单 */
  function requestZoneRefresh(table) {
    var harvested = (table && table.harvested) || {};
    var ZONES_TTL = 7 * 24 * 60 * 60 * 1000;
    var need = (state.config.blockedZones || []).filter(function (code) {
      return !harvested[code] || Date.now() - harvested[code] > ZONES_TTL;
    });
    if (!need.length) return;
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_REFRESH_ZONES", codes: need }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* noop */ }
  }

  /* ---------- bvid→分区缓存 ---------- */
  var zoneCache = PC.readZoneCache();
  function zoneOf(bvid) {
    if (!bvid) return undefined;
    return bvid in zoneCache ? zoneCache[bvid] : undefined;
  }
  function mergeZoneMap(map) {
    if (!map) return;
    var changed = false;
    Object.keys(map).forEach(function (bvid) {
      if (map[bvid] && zoneCache[bvid] !== map[bvid]) {
        zoneCache[bvid] = map[bvid];
        changed = true;
      }
    });
    if (changed) {
      PC.writeZoneCache(zoneCache);
      if (!UI.isShown()) Cleaner.update({});
    }
  }

  window.addEventListener("message", function (ev) {
    if (ev && ev.data && ev.data.type === D.EVENTS.BVZONE_BROADCAST) {
      mergeZoneMap(ev.data.map);
    }
  });

  /* ---------- 启动流程 ---------- */
  function boot() {
    state.uid = PC.getUid();
    refreshFavUrl();

    loadConfig().then(function () {
      var page = Rules.classifyUrl(location.href);

      /* 视频页分区判定（FR1-5，零请求优先；MAIN 探针失败再从内联脚本解析） */
      var probeP = page.type === "video"
        ? PC.probeVideoPage(600).then(function (vd) {
            if (vd) {
              if (vd.bvid && vd.tname) mergeZoneMap({ bvid: vd.bvid, tname: vd.tname });
              state.videoZone = Rules.normalizeZone(vd.tname || vd.tid);
              return;
            }
            var tname = PC.getVideoZoneFromScripts();
            if (tname) state.videoZone = Rules.normalizeZone(tname);
          })
        : Promise.resolve();

      var favP = state.config.favoritesOnly
        ? loadFavSet().then(function (fav) {
            if (fav) {
              state.favSet = fav.set;
              state.favKnown = true;
            } else if (state.uid) {
              requestFavRefresh(); // 异步刷新，先用 fail-closed 上锁
            } else {
              state.favKnown = true; // 未登录：favSet 恒为空 → 全站上锁并提示
            }
          })
        : Promise.resolve();

      loadZoneTable(); // 运行时分区库（异步，不阻塞装配）

      Promise.all([probeP, favP]).then(function () {
        afterInit(page);
      });
    });

    /* storage 变化（后台刷新收藏夹/分区库 / 其他上下文改配置） */
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "sync" && changes[D.KEYS.SYNC_CONFIG]) {
          state.config = Object.assign({}, D.DEFAULT_CONFIG, changes[D.KEYS.SYNC_CONFIG].newValue || {});
          mirrorConfig();
          requestZoneRefresh(null); // 新勾选的分区可能需要收割
          onSettingsChanged();
        }
        if (area === "local" && changes[D.KEYS.LOCAL_FAVSET]) {
          var nv = changes[D.KEYS.LOCAL_FAVSET].newValue;
          if (nv && nv.bvids) {
            state.favSet = new Set(nv.bvids);
            state.favKnown = true;
            onSettingsChanged();
          }
        }
        if (area === "local" && changes[D.KEYS.LOCAL_ZONETABLE]) {
          applyZoneTable(changes[D.KEYS.LOCAL_ZONETABLE].newValue);
          onSettingsChanged(); // 表更新后全量重扫（漏网卡片回删）
        }
      });
    }

    /* MAIN→ISOLATED 分区映射广播在 shim 里 postMessage，此处已监听 */
  }

  function onSettingsChanged() {
    mirrorConfig();
    refreshFavUrl();
    var locked = evaluateLock();
    Guard.update({ config: state.config, favSet: state.favSet });
    Cleaner.update({ config: state.config, favSet: state.favSet });
    if (!locked) Cleaner.update({});
  }

  function afterInit(page) {
    var locked = evaluateLock();
    Guard.start({ config: state.config, favSet: state.favSet, uid: state.uid });
    if (!locked) {
      Cleaner.start({
        config: state.config,
        favSet: state.favSet,
        zoneOf: zoneOf,
        resolveBvid: PC.resolveBvid,
      });
    }
    watchSpaNav();
  }

  /* ---------- SPA 软导航 ---------- */
  function watchSpaNav() {
    function check() {
      if (location.href === state.lastUrl) return;
      state.lastUrl = location.href;
      state.videoZone = null;
      onSettingsChanged();
      var page = Rules.classifyUrl(location.href);
      if (page.type === "video" && !UI.isShown()) {
        PC.probeVideoPage(800).then(function (vd) {
          if (vd) {
            if (vd.bvid && vd.tname) mergeZoneMap({ bvid: vd.bvid, tname: vd.tname });
            state.videoZone = Rules.normalizeZone(vd.tname || vd.tid);
          } else {
            var tname = PC.getVideoZoneFromScripts();
            if (tname) state.videoZone = Rules.normalizeZone(tname);
          }
          evaluateLock();
        });
      }
    }
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    setInterval(check, 500); // pushState 无事件的兜底（NFR-2: 极轻量字符串比较）
  }

  /* ---------- 诊断通道（弹窗"诊断"按钮用） ---------- */
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== "BILILOCK_PING") return;
      var answered = false;
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        sendResponse({
          alive: true,
          mainWorld: answered,                       // MAIN world net-shim 是否注入成功
          page: Rules.classifyUrl(location.href).type,
          url: location.href,
          config: state.config,
          videoZone: state.videoZone,
          zoneCacheSize: Object.keys(zoneCache).length,
          favSetSize: state.favSet ? state.favSet.size : null,
          locked: UI.isShown(),
        });
      }
      function onMsg(ev) {
        if (!ev || !ev.data || ev.data.type !== "bililock:probe:answer") return;
        answered = true;
        window.removeEventListener("message", onMsg);
        finish();
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ type: "bililock:probe" }, "*");
      setTimeout(function () { window.removeEventListener("message", onMsg); finish(); }, 350);
      return true; // 异步 sendResponse
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
