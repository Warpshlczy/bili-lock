/* BiliLock 页面上下文（ISOLATED world）：uid、视频分区、bvid→分区解析器。
 * 三级解析（SDD §3.2）：拦截映射缓存 → sessionStorage 缓存 → view 接口限流反查。
 */
(function () {
  "use strict";
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  if (!D || !Rules) {
    console.error("[BiliLock] page-context 依赖缺失（lib/rules.js 或 lib/defaults.js 未加载）—— 扩展目录不完整，请用完整 v1.0.2 重新加载");
    return;
  }

  function getUid() {
    var m = /(?:^|;\s*)DedeUserID=(\d+)/.exec(document.cookie || "");
    return m ? m[1] : null;
  }

  /* 内存中保持同一个对象：main 在启动时持有引用，后续 resolve/广播写入必须立即可见
   * （原先每次 read 都新建对象，导致 main.zoneOf 看不到反查结果）。 */
  var MAX_ZONE_ENTRIES = 3000;
  var PERSIST_KEY = D.KEYS.MIRROR_ZONE + ".local";
  var cacheObj = null;
  var persistedLoaded = false;

  function trimCache(cache) {
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length - MAX_ZONE_ENTRIES; i++) delete cache[keys[i]];
  }

  function readZoneCache() {
    if (cacheObj) return cacheObj;
    cacheObj = {};
    try {
      var s = JSON.parse(sessionStorage.getItem(D.KEYS.MIRROR_ZONE) || "{}");
      if (s && typeof s === "object") {
        Object.keys(s).forEach(function (k) { if (s[k]) cacheObj[k] = s[k]; });
      }
    } catch (e) { /* noop */ }
    if (!persistedLoaded) {
      persistedLoaded = true;
      try {
        var p = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
        var fresh = p && p.ts && (Date.now() - p.ts < 7 * 24 * 3600 * 1000);
        if (fresh && p.m && typeof p.m === "object") {
          Object.keys(p.m).forEach(function (k) {
            if (p.m[k] && !(k in cacheObj)) cacheObj[k] = p.m[k];
          });
        } else if (p) {
          localStorage.removeItem(PERSIST_KEY);
        }
      } catch (e) { /* noop */ }
    }
    return cacheObj;
  }

  function writeZoneCache(cache) {
    if (!cache || typeof cache !== "object") return;
    var target = readZoneCache();
    Object.keys(cache).forEach(function (k) { target[k] = cache[k]; });
    trimCache(target);
    try { sessionStorage.setItem(D.KEYS.MIRROR_ZONE, JSON.stringify(target)); } catch (e) { /* noop */ }
    /* 跨标签页持久缓存（7 天）：下次打开首页/收藏夹可零请求命中，首屏不再等待反查 */
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify({ ts: Date.now(), m: target })); } catch (e) { /* noop */ }
  }

  /** MAIN 探针：读取 __INITIAL_STATE__.videoData（视频页零请求判定） */
  function probeVideoPage(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      function onMsg(ev) {
        if (!ev || !ev.data || ev.data.type !== "bililock:probe:answer") return;
        done = true;
        window.removeEventListener("message", onMsg);
        resolve(ev.data.videoData || null);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ type: "bililock:probe" }, "*");
      setTimeout(function () {
        if (!done) { window.removeEventListener("message", onMsg); resolve(null); }
      }, timeoutMs || 500);
    });
  }

  /* view 接口限流反查（并发≤3；风控码冷却；失败退避重试，避免首屏卡片永久漏网） */
  var RISK_CODES = { "-352": 1, "-412": 1, "-799": 1 };
  var MAX_ATTEMPTS = 3;
  var inflight = 0, queue = [], resolved = {}, attempts = {}, notBefore = {};
  var cooldownUntil = 0, lastStart = 0, pumpTimer = 0;

  /** 从 view 响应中提取可归一化的分区字段：v2 优先，其次 v1；都识别不了视为未知 */
  function zoneFromView(data) {
    if (!data) return null;
    var cands = [data.tid_v2, data.tname_v2, data.tid, data.tname];
    for (var i = 0; i < cands.length; i++) {
      if (cands[i] == null || cands[i] === "") continue;
      if (Rules.normalizeZone(cands[i])) return cands[i];
    }
    return null;
  }

  function schedulePump(delay) {
    if (pumpTimer) return;
    pumpTimer = setTimeout(function () { pumpTimer = 0; pump(); }, Math.max(0, delay || 0));
  }

  function pump() {
    var now = Date.now();
    if (now < cooldownUntil) { schedulePump(cooldownUntil - now + 50); return; }
    while (inflight < 3 && queue.length) {
      now = Date.now();
      if (now - lastStart < 120) { schedulePump(120 - (now - lastStart)); return; }
      var job = queue.shift();
      inflight++;
      lastStart = now;
      (function (job) {
        var finish = function (j, failed) {
          inflight--;
          var code = j && typeof j.code === "number" ? j.code : null;
          if (!failed && code !== null && RISK_CODES[String(code)]) {
            cooldownUntil = Date.now() + 30000; // 风控：全队列冷却 30s，稍后自动重试
            attempts[job.bvid] = (attempts[job.bvid] || 0) + 1;
            notBefore[job.bvid] = Date.now() + 30000;
            if (attempts[job.bvid] >= MAX_ATTEMPTS) resolved[job.bvid] = null;
            job.resolve(null);
            pump();
            return;
          }
          var zone = (!failed && code === 0) ? zoneFromView(j && j.data) : null;
          if (zone) {
            resolved[job.bvid] = zone;
            attempts[job.bvid] = 0;
            delete notBefore[job.bvid];
            var cache = readZoneCache();
            cache[job.bvid] = zone;
            writeZoneCache(cache);
            job.resolve(zone);
          } else {
            attempts[job.bvid] = (attempts[job.bvid] || 0) + 1;
            notBefore[job.bvid] = Date.now() + 6000;
            if (attempts[job.bvid] >= MAX_ATTEMPTS) resolved[job.bvid] = null;
            job.resolve(null);
          }
          pump();
        };
        fetch("https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(job.bvid), {
          credentials: "include",
        }).then(function (r) { return r.json(); })
          .then(function (j) { finish(j, false); })
          .catch(function () { finish(null, true); });
      })(job);
    }
  }

  function resolveBvid(bvid) {
    if (!bvid) return Promise.resolve(null);
    var cache = readZoneCache();
    if (bvid in cache) return Promise.resolve(cache[bvid]);
    if (bvid in resolved) return Promise.resolve(resolved[bvid]);
    if (attempts[bvid] >= MAX_ATTEMPTS) { resolved[bvid] = null; return Promise.resolve(null); }
    if (notBefore[bvid] && Date.now() < notBefore[bvid]) return Promise.resolve(null);
    return new Promise(function (resolve) {
      queue.push({ bvid: bvid, resolve: resolve });
      pump();
    });
  }

  /** MAIN world 不可用时的兜底：从内联 <script> 文本解析 __INITIAL_STATE__.videoData */
  function getVideoZoneFromScripts() {
    try {
      var scripts = document.querySelectorAll("script:not([src])");
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent || "";
        if (t.indexOf("__INITIAL_STATE__") === -1 || t.indexOf("videoData") === -1) continue;
        var m = t.match(/"videoData"\s*:\s*\{[\s\S]{0,4000}?"tname"\s*:\s*"([^"]{1,24})"/);
        if (m) return m[1];
      }
    } catch (e) { /* noop */ }
    return null;
  }

  globalThis.BiliLockPageContext = {
    getUid: getUid,
    probeVideoPage: probeVideoPage,
    getVideoZoneFromScripts: getVideoZoneFromScripts,
    resolveBvid: resolveBvid,
    readZoneCache: readZoneCache,
    writeZoneCache: writeZoneCache,
    classifyUrl: Rules.classifyUrl,
  };
})();
