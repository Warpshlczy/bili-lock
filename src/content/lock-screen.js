/* BiliLock 上锁页（L4）与提示浮层。上锁页为覆盖式（不销毁原 DOM，NFR-6 可逆）。 */
(function () {
  "use strict";

  var STYLE_ID = "bililock-style";
  var SCREEN_ID = "bililock-screen";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = [
      "html.bililock-locked, html.bililock-locked body { overflow: hidden !important; }",
      "html.bililock-locked body > *:not(#" + SCREEN_ID + ") { display: none !important; }",
      "#" + SCREEN_ID + " { position: fixed; inset: 0; z-index: 2147483647; background: #10141a;",
      "  color: #dbe2ea; display: flex; align-items: center; justify-content: center;",
      "  font-family: system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif; }",
      "#" + SCREEN_ID + " .bl-card { max-width: 520px; padding: 48px 44px; text-align: center;",
      "  border: 1px solid #2a3340; border-radius: 16px; background: #171d26; }",
      "#" + SCREEN_ID + " .bl-icon { font-size: 56px; line-height: 1; }",
      "#" + SCREEN_ID + " .bl-title { font-size: 22px; font-weight: 700; margin: 18px 0 10px; color: #fff; }",
      "#" + SCREEN_ID + " .bl-reason { font-size: 14px; color: #9aa7b4; line-height: 1.7; }",
      "#" + SCREEN_ID + " .bl-msg { font-size: 13px; color: #6b7683; margin-top: 14px; }",
      "#" + SCREEN_ID + " .bl-actions { margin-top: 22px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }",
      "#" + SCREEN_ID + " button { cursor: pointer; border: 0; border-radius: 8px; padding: 9px 16px;",
      "  font-size: 13px; background: #233140; color: #dbe2ea; }",
      "#" + SCREEN_ID + " button.bl-primary { background: #00a1d6; color: #fff; }",
      "#" + SCREEN_ID + " .bl-foot { margin-top: 26px; font-size: 12px; color: #4a5560; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  /** 渲染上锁页。opts: {reason, lockMessage, favUrl, uid, favoritesOnly} */
  function show(opts) {
    opts = opts || {};
    ensureStyle();
    hide();
    var el = document.createElement("div");
    el.id = SCREEN_ID;
    var title = opts.favoritesOnly ? "此站点已被上锁" : "此页面已被上锁";
    var actions = [];
    if (opts.favUrl) {
      actions.push('<button class="bl-primary" data-act="fav">打开我的收藏夹</button>');
    }
    actions.push('<button data-act="options">打开 BiliLock 设置</button>');
    el.innerHTML =
      '<div class="bl-card">' +
      '<div class="bl-icon">🔒</div>' +
      '<div class="bl-title">' + title + "</div>" +
      '<div class="bl-reason"></div>' +
      '<div class="bl-msg"></div>' +
      '<div class="bl-actions">' + actions.join("") + "</div>" +
      '<div class="bl-foot">BiliLock · 算法推送上锁 · 此提示由本地扩展生成，未修改任何站点数据</div>' +
      "</div>";
    el.querySelector(".bl-reason").textContent = opts.reason || "";
    el.querySelector(".bl-msg").textContent = opts.lockMessage || "";
    el.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      if (btn.dataset.act === "fav" && opts.favUrl) {
        location.href = opts.favUrl;
      } else if (btn.dataset.act === "options") {
        try { chrome.runtime.sendMessage({ type: "BILILOCK_OPEN_OPTIONS" }); } catch (err) { /* noop */ }
      }
    });
    (document.body || document.documentElement).appendChild(el);
    document.documentElement.classList.add("bililock-locked");
  }

  function hide() {
    var el = document.getElementById(SCREEN_ID);
    if (el) el.remove();
    document.documentElement.classList.remove("bililock-locked");
  }

  function isShown() {
    return !!document.getElementById(SCREEN_ID);
  }

  /* 提示浮层（导航拦截用，FR1-4） */
  var toastTimer = null;
  function toast(text) {
    ensureStyle();
    var id = "bililock-toast";
    var t = document.getElementById(id);
    if (!t) {
      t = document.createElement("div");
      t.id = id;
      t.style.cssText =
        "position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483647;" +
        "background:#171d26;color:#fff;border:1px solid #2a3340;border-radius:10px;padding:10px 18px;" +
        "font-size:14px;font-family:system-ui,'PingFang SC',sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);";
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = "🔒 " + text;
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, 2200);
  }

  globalThis.BiliLockUI = { show: show, hide: hide, isShown: isShown, toast: toast };
})();
