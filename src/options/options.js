/* BiliLock 完整设置页。 */
"use strict";
(function () {
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  var config = null;
  var $ = function (id) { return document.getElementById(id); };

  function save() {
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_SET_CONFIG", config: config }, function () {
        $("saveHint").textContent = "已保存 ✓ " + new Date().toLocaleTimeString();
        renderCounts();
      });
    } catch (e) {
      $("saveHint").textContent = "已保存（本地）";
      renderCounts();
    }
  }

  function renderCounts() {
    $("zoneCount").textContent = "已勾选 " + config.blockedZones.length + " / " + Rules.mainZones.length + " 个分区";
  }

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
      cb.addEventListener("change", function () {
        var set = new Set(config.blockedZones);
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        config.blockedZones = Array.from(set);
        save();
      });
      var span = document.createElement("span");
      span.textContent = z.tname;
      label.appendChild(cb);
      label.appendChild(span);
      grid.appendChild(label);
    });
  }

  function fillUI() {
    $("removeAds").checked = !!config.removeAds;
    $("hideComments").checked = !!config.hideComments;
    $("hideRecommend").checked = !!config.hideRecommend;
    $("pureVideoMode").checked = !!config.pureVideoMode;
    $("favoritesOnly").checked = !!config.favoritesOnly;
    $("lockMessage").value = config.lockMessage || "";
    renderZones();
    renderCounts();
    loadFavDetail();
  }

  function loadFavDetail() {
    var done = false;
    var handle = function (res) {
      if (done) return;
      done = true;
      var fav = res && res.fav;
      var box = $("favDetail");
      if (!fav || !fav.bvids || !fav.bvids.length) {
        box.textContent = "收藏夹缓存：空。开启「只看收藏夹」后访问 B 站会自动收集（需登录）。";
        return;
      }
      var zoneCount = {};
      (fav.items || []).forEach(function (it) {
        var code = Rules.normalizeZone(it.tname || it.tid);
        if (code) zoneCount[code] = (zoneCount[code] || 0) + 1;
      });
      var top = Object.keys(zoneCount).sort(function (a, b) { return zoneCount[b] - zoneCount[a]; })
        .slice(0, 5).map(function (c) {
          var info = Rules.zoneInfo(c);
          return (info && info.tname || c) + "×" + zoneCount[c];
        }).join("、");
      box.textContent = "收藏夹缓存：" + fav.bvids.length + " 个视频，覆盖 " +
        Object.keys(zoneCount).length + " 个分区（" + top + "）。刷新于 " +
        new Date(fav.ts).toLocaleString();
    };
    try {
      chrome.runtime.sendMessage({ type: "BILILOCK_GET_FAV" }, handle);
    } catch (e) {
      handle(null);
    }
  }

  function initWithConfig(c) {
    config = Object.assign({}, D.DEFAULT_CONFIG, c || {});
    fillUI();
  }
  try {
    chrome.runtime.sendMessage({ type: "BILILOCK_GET_CONFIG" }, function (res) {
      void chrome.runtime.lastError;
      initWithConfig(res && res.config);
    });
  } catch (e) {
    initWithConfig(null);
  }

  function bindToggle(id, key) {
    $(id).addEventListener("change", function (e) { config[key] = e.target.checked; save(); });
  }
  bindToggle("removeAds", "removeAds");
  bindToggle("hideComments", "hideComments");
  bindToggle("hideRecommend", "hideRecommend");
  bindToggle("pureVideoMode", "pureVideoMode");
  bindToggle("favoritesOnly", "favoritesOnly");
  $("lockMessage").addEventListener("change", function (e) { config.lockMessage = e.target.value.trim(); save(); });

  $("zoneAll").addEventListener("click", function () {
    config.blockedZones = Rules.mainZones.map(function (z) { return z.code; });
    renderZones(); save();
  });
  $("zoneNone").addEventListener("click", function () {
    config.blockedZones = [];
    renderZones(); save();
  });
  $("zoneInvert").addEventListener("click", function () {
    var cur = new Set(config.blockedZones);
    config.blockedZones = Rules.mainZones.filter(function (z) { return !cur.has(z.code); })
      .map(function (z) { return z.code; });
    renderZones(); save();
  });

  $("favRefresh").addEventListener("click", function () {
    $("favDetail").textContent = "收集中…（收藏夹多时约需数秒）";
    chrome.cookies && chrome.cookies.get({ url: "https://www.bilibili.com", name: "DedeUserID" }, function (c) {
      chrome.runtime.sendMessage({ type: "BILILOCK_REFRESH_FAV", uid: c && c.value }, function (res) {
        loadFavDetail();
        if (res && !res.ok) {
          $("favDetail").textContent = "收集失败：" + (res.error || "") + "（请确认已在浏览器登录 B 站）";
        }
      });
    });
  });
})();
