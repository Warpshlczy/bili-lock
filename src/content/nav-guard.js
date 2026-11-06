/* BiliLock 导航拦截（L3）—— capture 阶段拦截指向锁定目标的链接（FR1-4 / FR5-1）。 */
(function () {
  "use strict";
  var Rules = globalThis.BiliLockRules;
  var UI = globalThis.BiliLockUI;

  var state = { config: null, favSet: null, uid: null };

  function judge(href) {
    var cfg = state.config;
    if (!cfg) return null;
    var page = Rules.classifyUrl(href);
    if (page.type === "channel" && Rules.isChannelLocked(cfg, page.slug)) {
      var info = Rules.zoneInfo ? null : null;
      return "分区「" + page.slug + "」已被 BiliLock 上锁";
    }
    if (cfg.favoritesOnly) {
      var favSet = state.favSet;
      var allowed = page.type === "favlist" ||
        (page.type === "video" && favSet && page.bvid && favSet.has(page.bvid));
      if (!allowed) {
        return "「只看收藏夹」已开启，该页面已上锁";
      }
    }
    return null;
  }

  function onClick(ev) {
    if (ev.defaultPrevented || ev.button !== 0) return;
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var msg = judge(a.href);
    if (msg) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      UI.toast(msg);
    }
  }

  function start(opts) {
    state.config = opts.config;
    state.favSet = opts.favSet;
    state.uid = opts.uid;
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true); // 中键新标签
  }

  function update(opts) {
    if (opts.config) state.config = opts.config;
    if ("favSet" in opts) state.favSet = opts.favSet;
  }

  function judgeForTest(href) { return judge(href); }

  globalThis.BiliLockNavGuard = { start: start, update: update, judgeForTest: judgeForTest };
})();
