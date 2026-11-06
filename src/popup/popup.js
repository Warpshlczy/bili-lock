/* BiliLock 弹窗：快捷勾选面板（R1–R6 全部入口）。 */
"use strict";
(function () {
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  var KEY = D.KEYS.SYNC_CONFIG;
  var config = null;

  var $ = function (id) { return document.getElementById(id); };

  /* 分区勾选网格 */
  function renderZones() {
    var grid = $("zoneGrid");
    grid.innerHTML = "";
    Rules.mainZones.forEach(function (z) {
      var label = document.createElement("label");
      label.className = "zone";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = z.code;
      cb.checked = config.blockedZones.indexOf(z.code) !== -1;
      cb.addEventListener("change", syncZones);
      var span = document.createElement("span");
      span.textContent = z.tname;
      label.appendChild(cb);
      label.appendChild(span);
      grid.appendChild(label);
    });
  }

  function syncZones() {
    var checked = [];
    document.querySelectorAll("#zoneGrid input:checked").forEach(function (cb) { checked.push(cb.value); });
    config.blockedZones = checked;
    save();
  }

  function save() {
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_SET_CONFIG", config: config }, function () {
        renderStatus();
      });
    } catch (e) { renderStatus(); }
  }

  function renderStatus() {
    var n = config.blockedZones.length;
    var parts = [];
    if (n) parts.push("已锁 " + n + " 个分区");
    if (config.removeAds) parts.push("去广告");
    if (config.hideComments) parts.push("无评论区");
    if (config.hideRecommend) parts.push("无推荐");
    if (config.pureVideoMode) parts.push("一键过滤");
    if (config.favoritesOnly) parts.push("只看收藏夹");
    $("status").textContent = parts.length ? parts.join(" · ") : "未上锁（默认直通）";
  }

  function loadFavStatus() {
    var done = false;
    var handle = function (res) {
      if (done) return;
      done = true;
      var fav = res && res.fav;
      if (!fav || !fav.bvids) {
        $("favStatus").textContent = "收藏夹缓存：空（开启只看收藏夹后自动收集，需登录）";
        return;
      }
      var age = Math.round((Date.now() - (fav.ts || 0)) / 60000);
      $("favStatus").textContent = "收藏夹缓存：" + fav.bvids.length + " 个视频（" + age + " 分钟前）";
    };
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_GET_FAV" }, handle);
    } catch (e) {
      handle(null);
    }
  }

  function bindToggle(id, key) {
    $(id).addEventListener("change", function (e) {
      config[key] = e.target.checked;
      save();
    });
  }

  function fillUI() {
    try { $("ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (e) { $("ver").textContent = "v?（目录文件与 manifest 不一致）"; }
    $("removeAds").checked = !!config.removeAds;
    $("hideComments").checked = !!config.hideComments;
    $("hideRecommend").checked = !!config.hideRecommend;
    $("pureVideoMode").checked = !!config.pureVideoMode;
    $("favoritesOnly").checked = !!config.favoritesOnly;
    renderZones();
    renderStatus();
    loadFavStatus();
    loadZoneLibStatus();
  }

  /* init：消息通道异常时以默认配置渲染（popup 始终可用） */
  function initWithConfig(c) {
    config = Object.assign({}, D.DEFAULT_CONFIG, c || {});
    fillUI();
  }
  try {
    chrome.runtime.sendMessage({ type: "BILILOCK_GET_CONFIG" }, function (res) {
      void chrome.runtime.lastError; // SW 未就绪时回退默认配置，UI 保持可用
      initWithConfig(res && res.config);
    });
  } catch (e) {
    initWithConfig(null);
  }

  $("zoneAll").addEventListener("click", function () {
    document.querySelectorAll("#zoneGrid input").forEach(function (cb) { cb.checked = true; });
    syncZones();
  });
  $("zoneNone").addEventListener("click", function () {
    document.querySelectorAll("#zoneGrid input").forEach(function (cb) { cb.checked = false; });
    syncZones();
  });
  $("zoneInvert").addEventListener("click", function () {
    document.querySelectorAll("#zoneGrid input").forEach(function (cb) { cb.checked = !cb.checked; });
    syncZones();
  });
  bindToggle("removeAds", "removeAds");
  bindToggle("hideComments", "hideComments");
  bindToggle("hideRecommend", "hideRecommend");
  bindToggle("pureVideoMode", "pureVideoMode");
  bindToggle("favoritesOnly", "favoritesOnly");

  $("favRefresh").addEventListener("click", function () {
    $("favStatus").textContent = "收藏夹收集中…";
    var uid = null;
    try {
      chrome.cookies && chrome.cookies.get({ url: "https://www.bilibili.com", name: "DedeUserID" }, function (c) {
        uid = c && c.value;
        chrome.runtime.sendMessage({ type: "BILILOCK_REFRESH_FAV", uid: uid }, function (res) {
          loadFavStatus();
          if (res && !res.ok) $("favStatus").textContent = "收藏夹收集失败：" + (res.error || "需登录");
        });
      });
    } catch (e) {
      $("favStatus").textContent = "无法读取登录态";
    }
  });

  /* ---------- 分区库（子分区→主分区全量映射）状态与刷新 ---------- */
  function loadZoneLibStatus() {
    try {
      chrome.storage.local.get("bililock.zonetable", function (res) {
        var t = res && res["bililock.zonetable"];
        var el = $("zoneLibStatus");
        if (!t || !t.tidToCode) {
          el.textContent = "分区库：未收割（勾选分区后自动拉取）";
          return;
        }
        var n = Object.keys(t.tidToCode).length;
        var age = Math.round((Date.now() - (t.ts || 0)) / 60000);
        el.textContent = "分区库：" + n + " 个子分区映射（" + age + " 分钟前）";
      });
    } catch (e) { /* noop */ }
  }

  $("zoneLibRefresh").addEventListener("click", function () {
    $("zoneLibStatus").textContent = "分区库更新中…";
    var codes = (config && config.blockedZones) || [];
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_REFRESH_ZONES", codes: codes }, function (res) {
        loadZoneLibStatus();
        if (res && !res.ok) $("zoneLibStatus").textContent = "分区库更新失败（稍后自动重试）";
      });
    } catch (e) { $("zoneLibStatus").textContent = "更新失败"; }
  });

  $("openOptions").addEventListener("click", function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  /* ---------- 诊断：定位"未生效"原因 ---------- */
  function diag(line) {
    var out = $("diagOut");
    out.style.display = "block";
    out.textContent += line + "\n";
  }
  $("diagBtn").addEventListener("click", function () {
    var out = $("diagOut");
    out.style.display = "block";
    out.textContent = "";
    var ver = "";
    try { ver = chrome.runtime.getManifest().version; } catch (e) { ver = "?"; }
    if (ver !== "1.0.7") {
      diag("⚠ 扩展版本为 v" + ver + "（当前最新 v1.0.7）——目录文件可能是新旧混杂的旧版，请删除扩展后用完整 v1.0.7 目录重新加载并强刷 B 站页面。");
    }
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab || !tab.url || tab.url.indexOf("bilibili.com") === -1) {
          diag("✗ 当前标签页不是 bilibili.com（本扩展只作用于 B 站页面）");
          return;
        }
        diag("• 页面: " + tab.url.slice(0, 80));
        chrome.tabs.sendMessage(tab.id, { type: "BILILOCK_PING" }, function (res) {
          if (chrome.runtime.lastError || !res) {
            diag("✗ 内容脚本未注入（刷新该页面；若仍失败，到 chrome://extensions 查看 BiliLock 是否报错）");
            return;
          }
          diag(res.alive ? "✓ 内容脚本已注入" : "✗ 内容脚本无响应");
          diag((res.mainWorld ? "✓" : "△") + " 网络过滤层(MAIN world)：" + (res.mainWorld ? "正常" : "未注入（Chrome 需 ≥111；视频页判定已自动走兜底）"));
          diag("• 页面类型: " + res.page);
          var bz = (res.config && res.config.blockedZones) || [];
          diag("• 已锁分区数: " + bz.length + (bz.length ? "（" + bz.join(",") + "）" : " —— 未勾选任何分区，信息流不会有变化"));
          diag("• 去广告:" + (res.config && res.config.removeAds ? "开" : "关")
            + " 评论区:" + (res.config && res.config.hideComments ? "开" : "关")
            + " 推荐:" + (res.config && res.config.hideRecommend ? "开" : "关")
            + " 一键过滤:" + (res.config && res.config.pureVideoMode ? "开" : "关")
            + " 只看收藏夹:" + (res.config && res.config.favoritesOnly ? "开" : "关"));
          diag("• 分区映射缓存: " + res.zoneCacheSize + " 条（首页卡片靠它+按需反查判定分区，刚打开的页面需数秒）");
          diag("• 收藏夹缓存: " + (res.favSetSize == null ? "未启用" : res.favSetSize + " 个视频"));
          if (res.locked) diag("• 当前页已被上锁");
        });
      });
    } catch (e) {
      diag("✗ 诊断失败: " + e.message);
    }
  });
})();
