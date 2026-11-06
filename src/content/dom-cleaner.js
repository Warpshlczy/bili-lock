/* BiliLock DOM 清理层（L2）—— 元素删除与漏网兜底。
 * 设计: 幂等；MutationObserver 增量扫描（rAF 节流）；对分区未知卡片走三级解析后回删（FR1-2）。
 */
(function () {
  "use strict";
  var S = globalThis.BiliLockSelectors;
  var Rules = globalThis.BiliLockRules;
  var D = globalThis.BiliLockDefaults;
  if (!S || !Rules || !D) {
    console.error("[BiliLock] dom-cleaner 依赖缺失（lib 文件未加载完整）—— 请用完整 v1.0.2 重新加载扩展");
    return;
  }

  var state = {
    config: null,
    favSet: null,          // Set<bvid> | null
    zoneOf: function () { return null; }, // bvid -> tname|null（由 main 注入）
    resolveBvid: function () { return Promise.resolve(null); },
    observer: null,
    pending: new Map(),    // bvid -> [element]
    scheduled: false,
    pendingResolveCount: 0,
    retryTimer: 0,
  };

  var PENDING_CLASS = "bililock-zone-pending";

  function hasZoneFilter() {
    return !!(state.config && state.config.blockedZones && state.config.blockedZones.length);
  }

  function markPending(el) {
    if (el && el.classList) el.classList.add(PENDING_CLASS);
  }

  function unmarkPending(el) {
    if (el && el.classList) el.classList.remove(PENDING_CLASS);
  }

  /* 分区未知的首屏卡片先隐藏，待反查完成再删除/恢复。
   * 首页 SSR 直出的卡片本身不带分区字段，若直接保留，打开页面时被屏蔽分区的视频会可见。 */
  function ensurePendingStyle() {
    if (!document.documentElement || document.getElementById("bililock-pending-css")) return;
    var st = document.createElement("style");
    st.id = "bililock-pending-css";
    st.textContent = "." + PENDING_CLASS + "{display:none !important;}";
    (document.head || document.documentElement).appendChild(st);
  }

  function scheduleRetry() {
    if (state.retryTimer) return;
    state.retryTimer = setTimeout(function () {
      state.retryTimer = 0;
      schedule();
    }, 15000);
  }

  function isLockedPage() {
    return document.documentElement.classList.contains("bililock-locked");
  }

  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ---------- R2 广告 ---------- */
  function cleanAds() {
    if (!state.config || !state.config.removeAds) return;
    try {
      document.querySelectorAll(S.AD_ELEMENTS).forEach(removeEl);
    } catch (e) { /* 选择器异常不中断 */ }
  }

  /* ---------- R1/R5 信息流与搜索卡片 ---------- */
  function cardBvid(card) {
    var a = card.querySelector && card.querySelector('a[href*="/video/BV"]');
    return a ? Rules.extractBvid(a.getAttribute("href")) : null;
  }

  function outerCard(el) {
    return el.closest ? el.closest(".feed-card, .bili-feed-card, .bili-video-card") : el;
  }

  function cleanFeedCards() {
    if (!state.config || isLockedPage()) return;
    var cfg = state.config;
    if (cfg.favoritesOnly) return; // favoritesOnly 下首页整页上锁，无需逐卡
    var cards = document.querySelectorAll(
      ".feed-card, .bili-feed-card, .bili-video-card, .video-card"
    );
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card.isConnected) continue;
      var bvid = cardBvid(card);
      if (!bvid) continue;
      var outer = outerCard(card) || card;
      var tname = state.zoneOf(bvid);
      if (tname === undefined) { // 尚未知 → 先隐藏再异步解析（FR1-2 三级兜底）
        if (hasZoneFilter()) {
          markPending(outer);
          enqueueResolve(bvid, outer);
        } else {
          unmarkPending(outer);
        }
        continue;
      }
      unmarkPending(outer);
      if (Rules.shouldStripBvid(cfg, bvid, tname, state.favSet)) {
        removeEl(outer);
      }
    }
  }

  function enqueueResolve(bvid, el) {
    if (state.pendingResolveCount > 120) return; // 上限保护（NFR-2）
    if (!state.pending.has(bvid)) {
      state.pending.set(bvid, []);
      state.pendingResolveCount++;
      state.resolveBvid(bvid).then(function (tname) {
        state.pendingResolveCount--;
        var els = state.pending.get(bvid) || [];
        state.pending.delete(bvid);
        if (tname) {
          var cache = globalThis.BiliLockPageContext.readZoneCache();
          cache[bvid] = tname;
          globalThis.BiliLockPageContext.writeZoneCache(cache);
        }
        var stillPending = false;
        els.forEach(function (card) {
          if (!card.isConnected) return;
          if (tname && Rules.shouldStripBvid(state.config, bvid, tname, state.favSet)) {
            removeEl(card);
          } else if (tname || !hasZoneFilter()) {
            unmarkPending(card);
          } else {
            stillPending = true; // 反查失败：保持隐藏，稍后重试，避免漏出被屏蔽视频
          }
        });
        if (stillPending) scheduleRetry();
        schedule();
      });
    }
    if (el && state.pending.has(bvid)) {
      var list = state.pending.get(bvid);
      if (list.indexOf(el) === -1 && list.length < 50) list.push(el);
    }
  }

  /* ---------- R3/R6 视频页 ---------- */
  function cleanVideoPage() {
    var cfg = state.config;
    if (!cfg || isLockedPage()) return;
    var hideComments = cfg.hideComments || cfg.pureVideoMode;   // FR3-1 / FR6-1
    var hideReco = cfg.hideRecommend || cfg.pureVideoMode;      // FR3-2 / FR6-1
    if (hideComments) try { document.querySelectorAll(S.COMMENTS).forEach(removeEl); } catch (e) {}
    if (cfg.pureVideoMode) try { document.querySelectorAll(S.DANMAKU).forEach(removeEl); } catch (e) {}
    if (hideReco) try { document.querySelectorAll(S.RECOMMEND).forEach(removeEl); } catch (e) {}
  }

  /* ---------- R5-3 收藏夹页内分区屏蔽（锚点驱动，不依赖收藏页容器类名） ---------- */
  function countBvids(container) {
    var set = {};
    var anchors = container.querySelectorAll ? container.querySelectorAll('a[href*="/video/BV"]') : [];
    for (var i = 0; i < anchors.length; i++) {
      var b = Rules.extractBvid(anchors[i].getAttribute("href") || "");
      if (b) set[b] = 1;
    }
    return Object.keys(set).length;
  }

  function favItemOf(a) {
    /* 收藏夹页面一条视频通常有封面/标题两个锚点，按“唯一 bvid 数≤1”选容器，
     * 否则会退化成删除单个锚点的父元素，卡片主体仍留在页面上。 */
    var cands = [
      a.closest(".items__item"),
      a.closest(".bili-video-card"),
      a.closest("[class*='video-card']"),
      a.closest("[class*='item']"),
      a.closest("li"),
      a.parentElement,
    ];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || !c.querySelectorAll) continue;
      if (countBvids(c) <= 1) return c;
    }
    return a;
  }

  function cleanFavPage() {
    var cfg = state.config;
    if (!cfg) return;
    if (Rules.classifyUrl(location.href).type !== "favlist") return;
    var anchors = document.querySelectorAll('a[href*="/video/BV"]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (!a.isConnected) continue;
      var bvid = Rules.extractBvid(a.getAttribute("href") || "");
      if (!bvid) continue;
      var tname = state.zoneOf(bvid);
      var item = favItemOf(a);
      if (tname === undefined) {
        if (hasZoneFilter()) {
          markPending(item);
          enqueueResolve(bvid, item);
        } else {
          unmarkPending(item);
        }
        continue;
      }
      unmarkPending(item);
      if (Rules.shouldStripBvid(cfg, bvid, tname, state.favSet)) removeEl(item);
    }
  }

  /* ---------- R1-4 分区入口净化（导航里的被锁频道链接移除） ---------- */
  function cleanNavEntries() {
    if (!state.config) return;
    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var page = Rules.classifyUrl(a.href);
      if (page.type === "channel" && Rules.isChannelLocked(state.config, page.slug)) {
        var li = a.closest && a.closest("li, .left-entry__item, .v-popover-wrap");
        removeEl(li || a);
      }
    }
  }

  /* ---------- 主入口 ---------- */
  function apply() {
    if (!state.config || isLockedPage()) return;
    cleanAds();
    /* 收藏夹先按条目整体删除，避免信息流清理只摘掉内层卡片、留下空条目壳 */
    cleanFavPage();
    cleanFeedCards();
    cleanVideoPage();
    cleanNavEntries();
  }

  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(function () {
      state.scheduled = false;
      apply();
    });
  }

  function start(opts) {
    state.config = opts.config;
    state.favSet = opts.favSet;
    state.zoneOf = opts.zoneOf;
    state.resolveBvid = opts.resolveBvid;
    ensurePendingStyle();
    if (state.observer) return;
    state.observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) { schedule(); return; }
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    apply();
  }

  function update(opts) {
    if (opts.config) state.config = opts.config;
    if ("favSet" in opts) state.favSet = opts.favSet;
    schedule();
  }

  /* 供测试用：无 observer 的单次执行 */
  function applyOnce(opts) {
    state.config = opts.config;
    state.favSet = opts.favSet;
    state.zoneOf = opts.zoneOf || function (b) {
      var cache = globalThis.BiliLockPageContext ? globalThis.BiliLockPageContext.readZoneCache() : {};
      return b in cache ? cache[b] : undefined;
    };
    state.resolveBvid = opts.resolveBvid || function () { return Promise.resolve(null); };
    apply();
  }

  globalThis.BiliLockDomCleaner = { start: start, update: update, applyOnce: applyOnce, _state: state };
})();
