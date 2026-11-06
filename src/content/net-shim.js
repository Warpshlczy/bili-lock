/* BiliLock 网络响应改写（L1）—— MAIN world, document_start。
 * 在页面自身脚本消费 JSON 响应之前，按规则引擎过滤被锁条目（FR1-2/1-6/3-1）。
 * 对外暴露:
 *   BiliLockNet.processFeedPayload(config, json, resolve)  纯函数（可单测）
 *   BiliLockNet.processReplyPayload(config, json)          纯函数（可单测）
 *   BiliLockNet.matchesApi(url)                            纯函数（可单测）
 *   BiliLockNet.install()                                  安装 fetch/XHR 补丁
 * 依赖: rules.js, defaults.js
 */
(function () {
  "use strict";
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  if (!D || !Rules) {
    console.error("[BiliLock] net-shim 依赖缺失（lib/rules.js 或 lib/defaults.js 未加载）—— 扩展目录不完整，请用完整 v1.0.2 重新加载");
    return;
  }

  var FEED_RE = /\/x\/web-interface\/(?:wbi\/)?index\/top\/feed\/rcmd/;
  var RELATED_RE = /\/x\/web-interface\/archive\/related/;
  var FAVLIST_RE = /\/x\/v3\/fav\/resource\/list/;
  var REPLY_RE = /\/x\/v2\/reply/;

  function matchesApi(url) {
    if (!url) return null;
    var s = String(url);
    if (FEED_RE.test(s)) return "feed";
    if (RELATED_RE.test(s)) return "related";
    if (FAVLIST_RE.test(s)) return "favlist";
    if (REPLY_RE.test(s)) return "reply";
    return null;
  }

  /* 运行时分区库（后台榜单收割）镜像：MAIN world 的 Rules 也随之增强 */
  var zoneTableTs = null;
  function maybeEnrichFromMirror() {
    try {
      var raw = sessionStorage.getItem(D.KEYS.MIRROR_ZONETABLE);
      if (!raw) return;
      var t = JSON.parse(raw);
      if (t && t.ts !== zoneTableTs) {
        zoneTableTs = t.ts;
        Rules.enrichZoneTable(t);
      }
    } catch (e) { /* noop */ }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener(D.EVENTS.ZONETABLE_MIRROR, maybeEnrichFromMirror);
  }

  function readMirrorConfig() {
    try {
      var raw = sessionStorage.getItem(D.KEYS.MIRROR_CONFIG);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      return Object.assign({}, D.DEFAULT_CONFIG, cfg);
    } catch (e) { return null; }
  }

  /* 首屏竞态：内容脚本的配置镜像由 chrome.storage 异步取得。页面第一批 feed/收藏夹
   * 请求可能早于镜像写入；此时不能直接放行，短暂等待镜像事件（最多 300ms）。 */
  var configWaiters = [];
  var configEventSeen = false;
  window.addEventListener(D.EVENTS.CONFIG_MIRROR, function () {
    configEventSeen = true;
    var waiters = configWaiters;
    configWaiters = [];
    waiters.forEach(function (fn) { fn(readMirrorConfig()); });
  });

  function getConfigAsync(timeoutMs) {
    var cfg = readMirrorConfig();
    if (cfg) return Promise.resolve(cfg);
    if (configEventSeen) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        resolve(value);
      }
      configWaiters.push(finish);
      setTimeout(function () { finish(readMirrorConfig()); }, timeoutMs || 300);
    });
  }

  /** 过滤 feed/related 载荷；返回 {json, bvidZoneMap} —— 纯函数
   * 兼容两种真实响应结构（docs/research/api_recommend.md 实样）：
   *   feed:    data.items[]，分区在 item.args.tname/args.tid
   *   related: data 本身是数组，分区在 item.tname/item.tid
   */
  function processFeedPayload(config, json, resolve) {
    if (!json || json.code !== 0 || !json.data) return { json: json, bvidZoneMap: {} };
    var data = json.data;
    var isArr = Array.isArray(data);
    var items = isArr ? data : (data.items || data.list || data.medias);
    if (!Array.isArray(items)) return { json: json, bvidZoneMap: {} };
    maybeEnrichFromMirror();
    var map = {};
    var zoneOf = function (bvid) {
      if (!bvid) return null;
      var t = resolve && resolve(bvid);
      return t || null;
    };
    var result = Rules.filterFeedItems(config, items, zoneOf);
    // 广播 bvid→分区（含被删条目），供 DOM 层与缓存使用（分区取 rname/rid，非标签）
    items.forEach(function (it) {
      if (!it) return;
      var bvid = it.bvid || it.bv_id || (it.url && Rules.extractBvid(it.url));
      var args = it.args || null;
      var zone = (args && (args.rname || args.rid))
        || it.tname_v2 || it.tnamev2 || it.tname || null;
      if (bvid && zone) map[bvid] = zone;
    });
    result.unknownBvids.forEach(function (bvid) { if (!map[bvid]) map[bvid] = map[bvid] || null; });
    var cloned = Object.assign({}, json);
    if (isArr) {
      cloned.data = result.kept;
    } else if (items === data.medias) {
      cloned.data = Object.assign({}, data, { medias: result.kept });
    } else {
      cloned.data = Object.assign({}, data, items === data.items ? { items: result.kept } : { list: result.kept });
    }
    return { json: cloned, bvidZoneMap: map };
  }

  /** 评论置空载荷 —— 纯函数 */
  function processReplyPayload(config, json) {
    if (!config || !config.hideComments) return json;
    if (!json || typeof json !== "object") return json;
    var cloned = Object.assign({}, json);
    if (cloned.code === 0 && cloned.data) {
      var d = Object.assign({}, cloned.data);
      if ("replies" in d) d.replies = [];
      if ("count" in d) d.count = 0;
      if (d.cursor) d.cursor = Object.assign({}, d.cursor, { all_count: 0, is_end: true });
      cloned.data = d;
    }
    return cloned;
  }

  function broadcastZoneMap(map) {
    if (!map || !Object.keys(map).length) return;
    try {
      window.postMessage({ type: D.EVENTS.BVZONE_BROADCAST, map: map }, "*");
    } catch (e) { /* noop */ }
  }

  /* 页面状态探针：ISOLATED world 看不到页面 JS 变量，由 MAIN 世界代读
   * window.__INITIAL_STATE__（视频页含 videoData.tid/tname，零请求判定 FR1-5）。 */
  window.addEventListener("message", function (ev) {
    if (!ev || !ev.data || ev.data.type !== "bililock:probe") return;
    var vd = null;
    try {
      var st = window.__INITIAL_STATE__ || {};
      var v = st.videoData || (st.videoInfo && st.videoInfo.videoData) || null;
      if (v && (v.bvid || v.tname || v.tid)) {
        vd = { bvid: v.bvid || null, tname: v.tname || null, tid: v.tid != null ? v.tid : null };
      }
    } catch (e) { vd = null; }
    try {
      window.postMessage({ type: "bililock:probe:answer", videoData: vd, mid: window.__INITIAL_STATE__ && window.__INITIAL_STATE__.mid || null }, "*");
    } catch (e) { /* noop */ }
  });

  /* ---------------- fetch / XHR 补丁 ---------------- */
  function install() {
    if (globalThis.__BILILOCK_NET_INSTALLED__) return;
    globalThis.__BILILOCK_NET_INSTALLED__ = true;

    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var kind = matchesApi(url);
        if (!kind) return origFetch(input, init);
        var cfg = readMirrorConfig();
        if (!cfg) {
          // 配置尚未镜像：等待（最多 300ms）后再发请求，避免首屏数据被放行
          return getConfigAsync(300).then(function (late) {
            return late ? patchedFetch(late) : origFetch(input, init);
          });
        }
        return patchedFetch(cfg);

        function patchedFetch(cfg) {
          return origFetch(input, init).then(function (resp) {
            return resp.text().then(function (text) {
              var out;
              try {
                var json = JSON.parse(text);
                if (kind === "reply") {
                  out = { json: processReplyPayload(cfg, json), map: {} };
                } else {
                  var cache = {};
                  try { cache = JSON.parse(sessionStorage.getItem(D.KEYS.MIRROR_ZONE) || "{}"); } catch (e) {}
                  var r = processFeedPayload(cfg, json, function (bvid) { return cache[bvid]; });
                  out = { json: r.json, map: r.bvidZoneMap };
                  try {
                    var persist = {};
                    Object.keys(r.bvidZoneMap).forEach(function (b) { if (r.bvidZoneMap[b]) persist[b] = r.bvidZoneMap[b]; });
                    if (Object.keys(persist).length) {
                      sessionStorage.setItem(D.KEYS.MIRROR_ZONE, JSON.stringify(Object.assign(cache, persist)));
                    }
                  } catch (e) { /* 存储满等忽略 */ }
                }
              } catch (e) { out = { json: null, map: {} }; }
              if (out.json != null) {
                broadcastZoneMap(out.map);
                var headers = new Headers(resp.headers);
                if (headers.has("content-length")) headers.delete("content-length");
                return new Response(JSON.stringify(out.json), {
                  status: resp.status, statusText: resp.statusText, headers: headers,
                });
              }
              return resp;
            });
          });
        }
      };
    }

    /* XHR 兜底：匹配 URL 的请求改由内部代理 xhr 发起，完成时以实例属性影子写入过滤后文本，
     * 页面监听器读到的即过滤结果（无需与页面监听器抢注册顺序）。 */
    var OrigXHR = window.XMLHttpRequest;
    if (!OrigXHR) return;
    var origOpen = OrigXHR.prototype.open;
    var origSend = OrigXHR.prototype.send;
    var origSetHeader = OrigXHR.prototype.setRequestHeader;

    OrigXHR.prototype.open = function (method, url) {
      this.__blMethod = method;
      this.__blUrl = String(url || "");
      this.__blHeaders = [];
      return origOpen.apply(this, arguments);
    };

    /* 被代理的请求不会真正发送原实例，页面设置的请求头必须记录并在代理上重放 */
    OrigXHR.prototype.setRequestHeader = function (name, value) {
      if (this.__blUrl && matchesApi(this.__blUrl)) {
        if (!this.__blHeaders) this.__blHeaders = [];
        this.__blHeaders.push([name, value]);
        return;
      }
      return origSetHeader.apply(this, arguments);
    };

    OrigXHR.prototype.send = function (body) {
      var xhr = this;
      var kind = matchesApi(xhr.__blUrl);
      if (!kind) return origSend.apply(this, arguments);
      var cfg = readMirrorConfig();
      if (!cfg) {
        // 配置尚未镜像：延迟发送（最多 300ms），保证第一批响应也被过滤
        getConfigAsync(300).then(function (late) {
          if (late) { proxySend(late); return; }
          (xhr.__blHeaders || []).forEach(function (h) {
            try { origSetHeader.call(xhr, h[0], h[1]); } catch (e) { /* noop */ }
          });
          origSend.call(xhr, body);
        });
        return;
      }
      proxySend(cfg);

      function proxySend(cfg) {
        var proxy = new OrigXHR();
        // 必须调用原生方法，否则 proxy.send 会再次进入本补丁，造成无限递归
        origOpen.call(proxy, xhr.__blMethod || "GET", xhr.__blUrl, true);
        proxy.withCredentials = true;
        if (xhr.timeout) proxy.timeout = xhr.timeout;
        (xhr.__blHeaders || []).forEach(function (h) {
          try { origSetHeader.call(proxy, h[0], h[1]); } catch (e) { /* 非法头忽略 */ }
        });
        proxy.onreadystatechange = function () {
          if (proxy.readyState !== 4) return;
          var text = proxy.responseText;
          var finalText = text;
          try {
            var json = JSON.parse(text);
            if (kind === "reply") {
              finalText = JSON.stringify(processReplyPayload(cfg, json));
            } else {
              var cache = {};
              try { cache = JSON.parse(sessionStorage.getItem(D.KEYS.MIRROR_ZONE) || "{}"); } catch (e) {}
              var r = processFeedPayload(cfg, json, function (bvid) { return cache[bvid]; });
              finalText = JSON.stringify(r.json);
              broadcastZoneMap(r.bvidZoneMap);
              try {
                var persist = {};
                Object.keys(r.bvidZoneMap).forEach(function (b) { if (r.bvidZoneMap[b]) persist[b] = r.bvidZoneMap[b]; });
                if (Object.keys(persist).length) {
                  sessionStorage.setItem(D.KEYS.MIRROR_ZONE, JSON.stringify(Object.assign(cache, persist)));
                }
              } catch (e) { /* 存储满等忽略 */ }
            }
          } catch (e) { finalText = text; }
          try {
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
            Object.defineProperty(xhr, "status", { value: proxy.status, configurable: true });
            // 页面可能以 responseType='json' 消费（对象），其余按文本影子写入
            if (xhr.responseType === "json") {
              var parsed = null;
              try { parsed = JSON.parse(finalText); } catch (e2) { parsed = null; }
              Object.defineProperty(xhr, "response", { value: parsed, configurable: true });
            } else {
              Object.defineProperty(xhr, "responseText", { value: finalText, configurable: true });
              Object.defineProperty(xhr, "response", { value: finalText, configurable: true });
            }
            Object.defineProperty(xhr, "responseURL", { value: proxy.responseURL, configurable: true });
          } catch (e) { /* noop */ }
          // dispatchEvent 会自动调用 onreadystatechange 属性，不能重复手动调用
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new ProgressEvent("load"));
          xhr.dispatchEvent(new ProgressEvent("loadend"));
        };
        proxy.onerror = function () {
          xhr.dispatchEvent(new ProgressEvent("error"));
          xhr.dispatchEvent(new ProgressEvent("loadend"));
        };
        proxy.ontimeout = function () { xhr.dispatchEvent(new ProgressEvent("timeout")); };
        origSend.call(proxy, body);
      }
    };
  }

  globalThis.BiliLockNet = {
    matchesApi: matchesApi,
    processFeedPayload: processFeedPayload,
    processReplyPayload: processReplyPayload,
    readMirrorConfig: readMirrorConfig,
    install: install,
  };

  install();
})();
