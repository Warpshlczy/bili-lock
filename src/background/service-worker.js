/* BiliLock 后台 Service Worker —— 消息路由 + 收藏夹收集器（FR5-5）+ 运行时分区库收割。
 * 注意: importScripts 相对路径相对于本文件所在目录解析；
 * bundle 构建时会把 lib 内联进本文件（无 importScripts），源码形态用根路径 "/lib/..."。 */
"use strict";

var BILILOCK_LIB_READY = false;
try {
  importScripts("/lib/zones-data.js", "/lib/rules.js", "/lib/defaults.js");
  BILILOCK_LIB_READY = !!(globalThis.BiliLockRules && globalThis.BiliLockDefaults);
} catch (e) {
  console.error("[BiliLock] SW lib 加载失败（目录不完整？）:", e && e.message);
}

var DEFAULTS = {
  KEYS: {
    SYNC_CONFIG: "bililock.config",
    LOCAL_FAVSET: "bililock.favset",
    LOCAL_ZONETABLE: "bililock.zonetable",
  },
  DEFAULT_CONFIG: {
    blockedZones: [], removeAds: true, hideComments: false,
    hideRecommend: false, favoritesOnly: false, pureVideoMode: false,
    lockMessage: "这里已被 BiliLock 上锁",
  },
  FAV_TTL: 6 * 60 * 60 * 1000,
  ZONES_TTL: 7 * 24 * 60 * 60 * 1000,
};

/* 主分区 rid 清单（榜单收割用）：v2 tid 优先，v1 tid 兜底（部分 v2 rid 榜单接口不支持） */
var MAIN_RIDS = (function () {
  var DATA = globalThis.BILILOCK_ZONES_DATA || {};
  var byCode = {};
  (DATA.v2_main || []).concat(DATA.v1_main || []).forEach(function (m) {
    if (!byCode[m.code]) byCode[m.code] = { code: m.code, tids: [] };
    if (byCode[m.code].tids.indexOf(m.tid) === -1) byCode[m.code].tids.push(m.tid);
  });
  return Object.keys(byCode).map(function (k) { return byCode[k]; });
})();

/* ---------------- 运行时分区库（子分区 → 主分区 全量映射） ---------------- */

function zoneFetch(url) {
  return fetch(url, {
    credentials: "include",
    headers: { "Referer": "https://www.bilibili.com/" },
  }).then(function (r) { return r.json(); });
}

/** 拉取 rid 对应主分区榜单，收割子分区 tid/tname → 主分区 code */
/** 依次尝试该主分区的候选 rid（v2 → v1），收割子分区 tid/tname → 主分区 code */
function harvestZone(entry, code, acc) {
  var tids = (entry && entry.tids) || [];
  return tids.reduce(function (chain, rid) {
    return chain.then(function (n) {
      if (n > 0) return n;
      return zoneFetch("https://api.bilibili.com/x/web-interface/ranking/v2?rid=" + rid + "&type=all")
        .then(function (j) {
          if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.list)) return 0;
          var count = 0;
          j.data.list.forEach(function (a) {
            if (a && a.tid != null && a.tname) {
              acc.tidToCode[String(a.tid)] = code;
              acc.tnameToCode[a.tname] = code;
              count++;
            }
          });
          return count;
        })
        .catch(function () { return 0; });
    });
  }, Promise.resolve(0));
}

function harvestCodes(codes) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(DEFAULTS.KEYS.LOCAL_ZONETABLE, function (res) {
      var table = (res && res[DEFAULTS.KEYS.LOCAL_ZONETABLE]) ||
        { tidToCode: {}, tnameToCode: {}, harvested: {}, ts: 0 };
      table.tidToCode = table.tidToCode || {};
      table.tnameToCode = table.tnameToCode || {};
      table.harvested = table.harvested || {};
      var chain = Promise.resolve();
      codes.forEach(function (code) {
        var entry = null;
        for (var i = 0; i < MAIN_RIDS.length; i++) if (MAIN_RIDS[i].code === code) entry = MAIN_RIDS[i];
        if (!entry) return;
        chain = chain.then(function () {
          return harvestZone(entry, code, table).then(function (n) {
            if (n > 0) table.harvested[code] = Date.now();
            return new Promise(function (r) { setTimeout(r, 150); }); // 限速防风控
          });
        });
      });
      chain.then(function () {
        table.ts = Date.now();
        chrome.storage.local.set({ [DEFAULTS.KEYS.LOCAL_ZONETABLE]: table }, function () {
          resolve({ ok: true, table: table });
          broadcastToBilibiliTabs({ type: "BILILOCK_CONFIG_CHANGED" });
        });
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.sync.get(DEFAULTS.KEYS.SYNC_CONFIG, function (res) {
    if (!res || !res[DEFAULTS.KEYS.SYNC_CONFIG]) {
      chrome.storage.sync.set({ [DEFAULTS.KEYS.SYNC_CONFIG]: DEFAULTS.DEFAULT_CONFIG });
    }
  });
});

/* ---------------- 收藏夹收集器 ---------------- */

function favFetch(url) {
  return fetch(url, { credentials: "include" })
    .then(function (r) { return r.json(); })
    .catch(function () { return { code: -1, message: "network" }; });
}

/** 拉取用户全部收藏夹内的视频（官方接口，携带用户 Cookie；NFR-3） */
function collectFavorites(uid) {
  return favFetch("https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=" + uid)
    .then(function (j) {
      if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.list)) {
        throw new Error(j && j.message ? j.message : "folder list failed");
      }
      var folders = j.data.list.map(function (f) {
        return { id: f.id, title: f.title, media_count: f.media_count || 0 };
      });
      return folders;
    })
    .then(function (folders) {
      var seen = {}, bvids = [], items = [];
      var chain = Promise.resolve();
      folders.forEach(function (folder) {
        var pages = Math.ceil((folder.media_count || 1) / 20);
        for (var pn = 1; pn <= Math.min(pages, 25); pn++) {
          (function (mediaId, page) {
            chain = chain.then(function () {
              return favFetch(
                "https://api.bilibili.com/x/v3/fav/resource/list?media_id=" + mediaId +
                "&pn=" + page + "&ps=20&platform=web"
              ).then(function (j2) {
                var medias = j2 && j2.code === 0 && j2.data && j2.data.medias;
                (medias || []).forEach(function (m) {
                  if (m && m.bvid && !seen[m.bvid]) {
                    seen[m.bvid] = true;
                    bvids.push(m.bvid);
                    items.push({ bvid: m.bvid, tname: m.tname || null, tid: m.tid != null ? m.tid : null, title: m.title || "" });
                  }
                });
              });
            });
          })(folder.id, pn);
        }
      });
      return chain.then(function () {
        return { folders: folders, bvids: bvids, items: items, ts: Date.now() };
      });
    });
}

function refreshFavSet(uid) {
  return collectFavorites(uid).then(function (data) {
    data.uid = uid;
    return new Promise(function (resolve) {
      chrome.storage.local.set({ [DEFAULTS.KEYS.LOCAL_FAVSET]: data }, resolve);
    });
  });
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === "BILILOCK_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (msg.type === "BILILOCK_GET_CONFIG") {
    chrome.storage.sync.get(DEFAULTS.KEYS.SYNC_CONFIG, function (res) {
      sendResponse({ config: Object.assign({}, DEFAULTS.DEFAULT_CONFIG, (res && res[DEFAULTS.KEYS.SYNC_CONFIG]) || {}) });
    });
    return true;
  }

  if (msg.type === "BILILOCK_SET_CONFIG") {
    var cfg = Object.assign({}, DEFAULTS.DEFAULT_CONFIG, msg.config || {});
    chrome.storage.sync.set({ [DEFAULTS.KEYS.SYNC_CONFIG]: cfg }, function () {
      broadcastToBilibiliTabs({ type: "BILILOCK_CONFIG_CHANGED", config: cfg });
      sendResponse({ ok: true, config: cfg });
    });
    return true;
  }

  if (msg.type === "BILILOCK_REFRESH_FAV") {
    refreshFavSet(msg.uid)
      .then(function () {
        broadcastToBilibiliTabs({ type: "BILILOCK_CONFIG_CHANGED" });
        sendResponse({ ok: true });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      });
    return true;
  }

  if (msg.type === "BILILOCK_GET_FAV") {
    chrome.storage.local.get(DEFAULTS.KEYS.LOCAL_FAVSET, function (res) {
      var data = res && res[DEFAULTS.KEYS.LOCAL_FAVSET];
      sendResponse({ fav: data || null });
    });
  }

  if (msg.type === "BILILOCK_REFRESH_ZONES") {
    if (!BILILOCK_LIB_READY) {
      sendResponse({ ok: false, error: "后台 lib 未加载（扩展目录不完整），请用完整 v1.0.5 重新加载" });
      return;
    }
    var codes = Array.isArray(msg.codes) ? msg.codes : [];
    harvestCodes(codes).then(function (r) { sendResponse(r); });
    return true;
  }
});

function broadcastToBilibiliTabs(message) {
  if (!chrome.tabs || !chrome.tabs.query) return;
  chrome.tabs.query({ url: "*://*.bilibili.com/*" }, function (tabs) {
    (tabs || []).forEach(function (tab) {
      try { chrome.tabs.sendMessage(tab.id, message, function () { void chrome.runtime.lastError; }); } catch (e) {}
    });
  });
}
