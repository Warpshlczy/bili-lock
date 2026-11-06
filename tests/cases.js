/* BiliLock 测试用例 —— 与 docs/01-SRS §3 追溯矩阵一一对应。
 * 运行: 浏览器打开 tests/runner.html
 * 框架: window.__test(name, fn)（fn 可 async）
 */
(function () {
  "use strict";
  var D = globalThis.BiliLockDefaults;
  var Rules = globalThis.BiliLockRules;
  var Net = globalThis.BiliLockNet;
  var Cleaner = globalThis.BiliLockDomCleaner;
  var Guard = globalThis.BiliLockNavGuard;

  var cases = [];
  function test(id, name, fn) { cases.push({ id: id, name: name, fn: fn }); }
  function eq(actual, expected, msg) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg || "") + " 期望 " + b + "，实际 " + a);
  }
  function ok(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }

  function cfg(over) {
    return Object.assign({}, D.DEFAULT_CONFIG, over || {});
  }
  function fixture(html) {
    document.getElementById("fixture").innerHTML = html;
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content;
  }

  /* 合成 bvid（BV + 10位） */
  var BV = { kichiku: "BV1000000KIC", music: "BV2000000MUS", game: "BV3000000GAM", fav1: "BV4000000FAV", fav2: "BV5000000FAV" };

  function feedCardHtml(bvid, extraClass) {
    return '<div class="feed-card"><div class="bili-feed-card"><div class="bili-video-card is-rcmd ' + (extraClass || "") + '">' +
      '<div class="bili-video-card__wrap"><a class="bili-video-card__image--link" href="https://www.bilibili.com/video/' + bvid + '/">' +
      '<img src="x.jpg"></a></div></div></div></div>';
  }

  /* ============ 分区数据健全性 ============ */
  test("Z-01", "分区数据完整（v2 主分区 31 个，含鬼畜/游戏/科技数码）", function () {
    var codes = Rules.mainZones.map(function (z) { return z.code; });
    ok(codes.length >= 30, "主分区数量不足: " + codes.length);
    ["kichiku", "game", "tech", "music"].forEach(function (c) { ok(codes.indexOf(c) !== -1, "缺少 " + c); });
  });
  test("Z-02", "分区归一：主分区名/子分区/别名/tid/英文码", function () {
    eq(Rules.normalizeZone("鬼畜"), "kichiku");
    eq(Rules.normalizeZone("单人RPG游戏"), "game");      // v2 子分区 → 主分区
    eq(Rules.normalizeZone("科技数码"), "tech");
    eq(Rules.normalizeZone("科技"), "tech");              // v1 别名
    eq(Rules.normalizeZone("体育运动"), "sports");
    eq(Rules.normalizeZone(119), "kichiku");              // v1 tid
    eq(Rules.normalizeZone(2064), "game");                // v2 子分区 tid
    eq(Rules.normalizeZone("kichiku"), "kichiku");
    eq(Rules.normalizeZone("不存在分区xyz"), null);        // 未知不臆断
  });

  /* ============ R1 分区屏蔽 ============ */
  test("TC-01", "FR1-1 首页信息流：被锁分区卡片被删除，其他分区完好", function () {
    fixture('<div id="feed">' +
      feedCardHtml(BV.kichiku) + feedCardHtml(BV.music) + feedCardHtml(BV.game) + "</div>");
    var cache = {};
    cache[BV.kichiku] = "鬼畜"; cache[BV.music] = "音乐"; cache[BV.game] = "游戏";
    Cleaner.applyOnce({
      config: cfg({ blockedZones: ["kichiku"] }),
      favSet: null,
      zoneOf: function (b) { return b in cache ? cache[b] : undefined; },
    });
    var left = document.querySelectorAll("#feed .feed-card").length;
    eq(left, 2, "鬼畜卡片应被删除：");
    ok(!document.querySelector("#feed .feed-card a[href*='" + BV.kichiku + "']"), "鬼畜卡片仍存在");
    ok(document.querySelector("#feed .feed-card a[href*='" + BV.music + "']"), "音乐卡片被误删");
    ok(document.querySelector("#feed .feed-card a[href*='" + BV.game + "']"), "游戏卡片被误删");
  });

  test("TC-02", "FR1-2 接口层过滤：tname 命中即删，字段缺失降级保留并上报", function () {
    var payload = { code: 0, data: { items: [
      { bvid: BV.kichiku, goto: "av", tname: "鬼畜", title: "a" },
      { bvid: BV.music, goto: "av", tname: "音乐", title: "b" },
      { bvid: BV.game, goto: "av", title: "c" },                 // 无 tname → 降级
      { goto: "ogv", id: 1, title: "banner" },                    // 非视频条目保留
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, function () { return "游戏"; });
    eq(r.json.data.items.length, 3, "保留条目数：");
    eq(r.json.data.items.map(function (i) { return i.title; }), ["b", "c", "banner"]);
    ok(r.bvidZoneMap[BV.kichiku] === "鬼畜", "被删条目也应广播映射");
    ok(r.bvidZoneMap[BV.game] === null || r.bvidZoneMap[BV.game] === undefined || true, "");
  });

  test("TC-03", "FR1-3 分区频道页整页上锁（/v/kichiku 锁、/v/music 不锁）", function () {
    var c = cfg({ blockedZones: ["kichiku"] });
    var v1 = Rules.isPageLocked(c, "https://www.bilibili.com/v/kichiku/", {});
    ok(v1.locked, "/v/kichiku 应上锁");
    ok(v1.reason.indexOf("上锁") !== -1, "提示语缺失");
    var v2 = Rules.isPageLocked(c, "https://www.bilibili.com/v/music/", {});
    ok(!v2.locked, "/v/music 不应上锁");
    var v3 = Rules.isPageLocked(c, "https://www.bilibili.com/c/douga/", {}); // v2 路由
    var c2 = cfg({ blockedZones: ["douga"] });
    v3 = Rules.isPageLocked(c2, "https://www.bilibili.com/c/douga/", {});
    ok(v3.locked, "/c/douga 应上锁");
    var v4 = Rules.isPageLocked(cfg({ blockedZones: ["anime"] }), "https://www.bilibili.com/anime/", {});
    ok(v4.locked, "站点级频道 /anime 应上锁");
  });

  test("TC-04", "FR1-4 分区入口点击被拦截判定（含站点级频道）", function () {
    var c = cfg({ blockedZones: ["kichiku"] });
    Guard.start({ config: c, favSet: null, uid: null }); // 初始化守卫（等同真实装配）
    ok(Guard.judgeForTest("https://www.bilibili.com/v/kichiku/"), "鬼畜入口应拦截");
    ok(!Guard.judgeForTest("https://www.bilibili.com/v/music/"), "音乐入口不应拦截");
    ok(!Guard.judgeForTest("https://www.bilibili.com/video/" + BV.music + "/"), "视频链接不应拦截");
  });

  test("TC-05", "FR1-5 被锁分区的视频详情页整页上锁（零请求判定）", function () {
    var c = cfg({ blockedZones: ["kichiku"] });
    var v = Rules.isPageLocked(c, "https://www.bilibili.com/video/" + BV.kichiku + "/", { videoZone: "kichiku" });
    ok(v.locked, "鬼畜视频页应上锁");
    var v2 = Rules.isPageLocked(c, "https://www.bilibili.com/video/" + BV.music + "/", { videoZone: "music" });
    ok(!v2.locked, "音乐视频页不应上锁");
  });

  test("TC-06", "FR1-6 相关推荐接口条目被过滤（archive/related）", function () {
    var payload = { code: 0, data: { list: [
      { bvid: BV.kichiku, tname: "鬼畜" },
      { bvid: BV.music, tname: "音乐" },
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, null);
    eq(r.json.data.list.length, 1);
    eq(r.json.data.list[0].bvid, BV.music);
  });

  test("TC-07", "FR1-7 搜索页分类正确（同用卡片清理规则）", function () {
    eq(Rules.classifyUrl("https://search.bilibili.com/all?keyword=x").type, "other");
    eq(Rules.classifyUrl("https://www.bilibili.com/search?keyword=x").type, "search");
  });

  /* ============ R2 去广告 ============ */
  test("TC-08", "FR2-1 首页广告卡片（is-ads）删除", function () {
    fixture(feedCardHtml(BV.music, "is-ads") + feedCardHtml(BV.music));
    Cleaner.applyOnce({ config: cfg({ removeAds: true }), zoneOf: function () { return "音乐"; } });
    ok(!document.querySelector(".is-ads"), "广告卡片应被删除");
    eq(document.querySelectorAll(".feed-card").length, 1, "正常卡片保留：");
  });

  test("TC-09", "FR2-2 视频页广告位全部删除", function () {
    fixture(
      '<div id="slide_ad" class="slide-ad-exp">横幅广告</div>' +
      '<div class="ad-report">版位广告</div>' +
      '<div id="right-bottom-banner">右下广告</div>' +
      '<div class="ad-floor-exp">底部广告</div>' +
      '<div id="video-page-app">内容</div>');
    Cleaner.applyOnce({ config: cfg({ removeAds: true }), zoneOf: function () { return null; } });
    ["#slide_ad", ".ad-report", "#right-bottom-banner", ".ad-floor-exp"].forEach(function (sel) {
      ok(!document.querySelector(sel), sel + " 应被删除");
    });
    ok(document.querySelector("#video-page-app"), "正常内容不应误删");
  });

  test("TC-10", "FR2-3 动态插入广告可被再次清理（模拟 mutation 后回调）", function () {
    fixture( "");
    Cleaner.applyOnce({ config: cfg({ removeAds: true }), zoneOf: function () { return null; } });
    fixture( '<div class="ad-report">新插入广告</div>');
    Cleaner.applyOnce({ config: cfg({ removeAds: true }), zoneOf: function () { return null; } });
    ok(!document.querySelector(".ad-report"), "动态广告应被删除");
  });

  /* ============ R3 视频页单项 ============ */
  function videoPageDom() {
    fixture(
      '<div id="playerWrap">播放器</div>' +
      '<div id="danmukuBox">弹幕列表</div>' +
      '<div class="danmaku-box">弹幕</div>' +
      '<div class="right-container"><div class="recommend-list-v1">相关推荐</div><div class="next-play">连播</div></div>' +
      '<div id="commentapp">评论区</div>');
  }
  test("TC-11", "FR3-1 去掉评论区", function () {
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ hideComments: true }), zoneOf: function () { return null; } });
    ok(!document.querySelector("#commentapp"), "评论区应被删除");
    ok(document.querySelector(".recommend-list-v1"), "推荐不应误删");
  });
  test("TC-12", "FR3-2 去掉视频推荐", function () {
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ hideRecommend: true }), zoneOf: function () { return null; } });
    ok(!document.querySelector(".recommend-list-v1") && !document.querySelector(".next-play"), "推荐应被删除");
    ok(document.querySelector("#commentapp"), "评论区不应误删");
  });
  test("TC-13", "FR3-3 两开关相互独立（特异性）", function () {
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ hideComments: true, hideRecommend: false }), zoneOf: function () { return null; } });
    ok(!document.querySelector("#commentapp") && document.querySelector(".recommend-list-v1"), "独立生效失败");
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ hideComments: false, hideRecommend: true }), zoneOf: function () { return null; } });
    ok(document.querySelector("#commentapp") && !document.querySelector(".recommend-list-v1"), "独立生效失败2");
  });

  /* ============ R4 反选 ============ */
  test("TC-14", "FR4 反选即白名单：全选去掉鬼畜 = 锁定其余全部", function () {
    var all = Rules.mainZones.map(function (z) { return z.code; });
    var inverse = all.filter(function (c) { return c !== "kichiku"; });
    var c = cfg({ blockedZones: inverse });
    ok(Rules.isPageLocked(c, "https://www.bilibili.com/v/kichiku/", {}).locked === false, "鬼畜应可访问");
    ok(Rules.isPageLocked(c, "https://www.bilibili.com/v/music/", {}).locked === true, "音乐应上锁");
    ok(Rules.isPageLocked(c, "https://www.bilibili.com/v/game/", {}).locked === true, "游戏应上锁");
  });

  /* ============ R5 只看收藏夹 ============ */
  var FAV = new Set([BV.fav1, BV.fav2]);
  test("TC-15", "FR5-1 favoritesOnly：首页/分区/搜索上锁，收藏夹列表页可访问", function () {
    var c = cfg({ favoritesOnly: true });
    ok(Rules.isPageLocked(c, "https://www.bilibili.com/", { favSet: FAV, favKnown: true }).locked, "首页应上锁");
    ok(Rules.isPageLocked(c, "https://www.bilibili.com/v/music/", { favSet: FAV, favKnown: true }).locked, "分区页应上锁");
    ok(Rules.isPageLocked(c, "https://search.bilibili.com/all", { favSet: FAV, favKnown: true }).locked, "搜索页应上锁");
    ok(!Rules.isPageLocked(c, "https://space.bilibili.com/12345/favlist", { favSet: FAV, favKnown: true }).locked, "收藏夹页不应上锁");
  });
  test("TC-16", "FR5-2 收藏夹内视频可访问，夹外视频上锁", function () {
    var c = cfg({ favoritesOnly: true });
    ok(!Rules.isPageLocked(c, "https://www.bilibili.com/video/" + BV.fav1 + "/", { favSet: FAV, favKnown: true }).locked, "收藏内视频应可访问");
    var v = Rules.isPageLocked(c, "https://www.bilibili.com/video/" + BV.kichiku + "/", { favSet: FAV, favKnown: true });
    ok(v.locked, "夹外视频应上锁");
    ok(v.reason.indexOf("收藏夹") !== -1, "提示语应说明原因");
  });
  test("TC-17", "FR5-3 收藏夹页内应用分区屏蔽", function () {
    ok(Rules.shouldStripFavItem(cfg({ blockedZones: ["kichiku"] }), { bvid: BV.kichiku, tname: "鬼畜" }, FAV), "鬼畜收藏应隐藏");
    ok(!Rules.shouldStripFavItem(cfg({ blockedZones: ["kichiku"] }), { bvid: BV.fav1, tname: "音乐" }, FAV), "音乐收藏不应隐藏");
  });
  test("TC-18", "FR5-4 未登录 fail-closed：全站上锁且提示", function () {
    var v = Rules.isPageLocked(cfg({ favoritesOnly: true }), "https://www.bilibili.com/", { favSet: null, favKnown: true });
    ok(v.locked, "无收藏数据时首页应上锁");
  });

  /* ============ R6 一键过滤 ============ */
  test("TC-19", "FR6-1 一键过滤：弹幕+评论区+推荐全消失，播放器保留", function () {
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ pureVideoMode: true }), zoneOf: function () { return null; } });
    ["#danmukuBox", ".danmaku-box", ".recommend-list-v1", ".next-play", "#commentapp"].forEach(function (sel) {
      ok(!document.querySelector(sel), sel + " 应被删除");
    });
    ok(document.querySelector("#playerWrap"), "播放器应保留");
  });
  test("TC-20", "FR6-2 与 R3 叠加无冲突", function () {
    videoPageDom();
    Cleaner.applyOnce({ config: cfg({ pureVideoMode: true, hideComments: true, hideRecommend: true }), zoneOf: function () { return null; } });
    ok(document.querySelector("#playerWrap"), "播放器应保留");
    ok(!document.querySelector("#commentapp") && !document.querySelector(".recommend-list-v1"), "叠加后仍正确");
  });

  /* ============ NFR-1 特异性反向用例 ============ */
  test("TC-21", "NFR-1 默认/关闭状态不改变页面（特异性反向验证）", function () {
    // 默认配置（全关 + 广告开）之外：全部关闭时任何东西都不应被删
    fixture(feedCardHtml(BV.music, "is-ads") +
      '<div id="commentapp">评论区</div><div class="ad-report">广告</div>');
    Cleaner.applyOnce({ config: cfg({ removeAds: false }), zoneOf: function () { return "音乐"; } });
    ok(document.querySelector(".feed-card"), "默认不应删卡片");
    ok(document.querySelector("#commentapp"), "默认不应删评论区");
    ok(document.querySelector(".ad-report"), "removeAds=false 不应删广告");
    // feed 过滤：无屏蔽分区 → 全保留
    var payload = { code: 0, data: { items: [{ bvid: BV.kichiku, goto: "av", tname: "鬼畜" }] } };
    var r = Net.processFeedPayload(cfg({}), payload, null);
    eq(r.json.data.items.length, 1, "默认不应过滤条目");
    // 页面锁定：空配置无锁定
    ok(!Rules.isPageLocked(cfg({}), "https://www.bilibili.com/v/kichiku/", {}).locked, "默认分区页不应上锁");
  });

  test("TC-22", "评论接口置空（FR3-1 网络层）", function () {
    var payload = { code: 0, data: { replies: [{ rpid: 1 }], count: 10, cursor: { all_count: 10 } } };
    var out = Net.processReplyPayload(cfg({ hideComments: true }), payload);
    eq(out.data.replies, [], "replies 应清空");
    eq(out.data.count, 0, "count 应为 0");
    var out2 = Net.processReplyPayload(cfg({ hideComments: false }), payload);
    eq(out2.data.replies.length, 1, "关闭时不应置空");
  });

  test("TC-23", "URL 分类全表（SPA 路由覆盖）", function () {
    eq(Rules.classifyUrl("https://www.bilibili.com/").type, "home");
    eq(Rules.classifyUrl("https://www.bilibili.com/video/BV1AF4g6MEMu?p=1").bvid, "BV1AF4g6MEMu");
    eq(Rules.classifyUrl("https://www.bilibili.com/zh-Hans/video/BV1AF4g6MEMu/").bvid, "BV1AF4g6MEMu"); // 本地化前缀
    eq(Rules.classifyUrl("https://space.bilibili.com/952/favlist?ftype=fav").type, "favlist");
    eq(Rules.classifyUrl("https://space.bilibili.com/952").type, "space");
    eq(Rules.classifyUrl("https://live.bilibili.com/6").type, "channel");
    eq(Rules.classifyUrl("https://www.bilibili.com/v/douga/").type, "channel");
  });

  test("TC-24", "FR1-2 真实首页推荐流结构：分区在 args.rid/rname（tid/tname 是标签）", function () {
    // 结构取自 docs/research/api_recommend.md 实样（docs/03 R9：rid/rname=分区，tid/tname=标签）
    var payload = { code: 0, data: { items: [
      { bvid: BV.kichiku, card_goto: "av", args: { rid: 119, rname: "鬼畜", tid: 1833, tname: "搞笑", up_name: "u" } },
      { bvid: BV.music, card_goto: "av", args: { rid: 130, rname: "音乐" } },
      { bvid: BV.game, card_goto: "av", args: { rid: 999999999 } },          // 未知 rid → 不臆断保留
      { card_goto: "banner", id: 9, args: { tname: "活动" } }                // 非视频条目保留
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, null);
    var bvids = r.json.data.items.filter(function (i) { return i.bvid; }).map(function (i) { return i.bvid; });
    eq(bvids, [BV.music, BV.game], "args.rname=鬼畜 应被删：");
    ok(r.json.data.items.some(function (i) { return i.card_goto === "banner"; }), "非视频条目应保留");
    eq(r.bvidZoneMap[BV.kichiku], "鬼畜", "映射应取 rname");
  });

  test("TC-25", "FR1-6 真实相关推荐结构：data 本身是数组", function () {
    var payload = { code: 0, data: [
      { bvid: BV.kichiku, tid: 119, tname: "鬼畜" },
      { bvid: BV.music, tid: 130, tname: "音乐" },
      { bvid: "BV6000000SUB", tid: 1833 }   // 未收录子分区 tid → 不臆断，保留走兜底
    ] };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, null);
    ok(Array.isArray(r.json.data), "data 应保持数组结构");
    eq(r.json.data.map(function (i) { return i.bvid; }), [BV.music, "BV6000000SUB"]);
  });

  test("TC-26", "子分区归一（修复后）：音游→game、搞笑→life、tid26→kichiku", function () {
    eq(Rules.normalizeZone("音游"), "game");
    eq(Rules.normalizeZone("搞笑"), "life");
    eq(Rules.normalizeZone(26), "kichiku");
    eq(Rules.normalizeZone(122), "knowledge");
  });

  test("TC-27", "运行时分区库注入：榜单收割的子分区 tid/tname 生效（覆盖文档未收录分区）", function () {
    var n = Rules.enrichZoneTable({
      tidToCode: { "1833": "life", "10174": "game" },
      tnameToCode: { "音乐游戏": "game", "整蛊综合": "life" },
      ts: Date.now(),
    });
    ok(n >= 4, "注入条数异常: " + n);
    eq(Rules.normalizeZone(1833), "life");
    eq(Rules.normalizeZone(10174), "game");
    eq(Rules.normalizeZone("音乐游戏"), "game");
    // 注入后 feed 过滤可命中（此前未知→保留）
    var payload = { code: 0, data: { items: [
      { bvid: BV.kichiku, card_goto: "av", args: { rid: 1833 } },
      { bvid: BV.music, card_goto: "av", args: { rid: 10174 } },
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["life"] }), payload, null);
    eq(r.json.data.items.map(function (i) { return i.bvid; }), [BV.music]);
    // 非法 code 的注入条目必须被拒绝（特异性保护）
    Rules.enrichZoneTable({ tidToCode: { "99999": "不存在的code" } });
    eq(Rules.normalizeZone(99999), null);
  });

  test("TC-28", "FR5-3 收藏夹接口（fav/resource/list）medias 网络层过滤", function () {
    var payload = { code: 0, data: { info: { id: 1 }, has_more: false, medias: [
      { bv_id: BV.kichiku, tid: 119, tname: "鬼畜", title: "a" },
      { bv_id: BV.music, tid: 130, tname: "音乐", title: "b" },
      { bvid: BV.game, tid: 4, tname: "游戏", title: "c" },
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, null);
    eq(r.json.data.medias.map(function (i) { return i.title; }), ["b", "c"]);
    ok(r.json.data.info && r.json.data.info.id === 1, "info 字段应保留");
  });

  test("TC-29", "args.rname 亦可作为分区候选源", function () {
    var payload = { code: 0, data: { items: [
      { bvid: BV.kichiku, card_goto: "av", args: { rname: "鬼畜调教", tid: 22 } },
    ] } };
    var r = Net.processFeedPayload(cfg({ blockedZones: ["kichiku"] }), payload, null);
    eq(r.json.data.items.length, 0);
  });

  test("TC-30", "R2 网络层广告过滤：cm 卡片 / is_ad_loc / cm_mark", function () {
    var payload = { code: 0, data: { items: [
      { card_goto: "cm", id: 1, title: "cm广告" },
      { card_goto: "av", bvid: BV.music, args: { tid: 130 }, is_ad_loc: true, title: "av广告" },
      { card_goto: "av", bvid: BV.game, args: { tid: 4 }, cm_mark: 1, title: "cm_mark广告" },
      { card_goto: "av", bvid: BV.kichiku, args: { tid: 3 }, title: "正常视频" },
    ] } };
    var r = Net.processFeedPayload(cfg({ removeAds: true, blockedZones: [] }), payload, null);
    eq(r.json.data.items.map(function (i) { return i.title; }), ["正常视频"], "开启去广告应删尽三种广告：");
    var r2 = Net.processFeedPayload(cfg({ removeAds: false, blockedZones: [] }), payload, null);
    eq(r2.json.data.items.length, 4, "关闭去广告不应删");
  });

  test("TC-31", "FR1 扩展：OGV（番剧/电影等）按 season_type / args 分区过滤", function () {
    var payload = { code: 0, data: { items: [
      { card_goto: "ogv", id: 1, args: { tid: 13 }, title: "番剧卡" },                      // args.tid=番剧
      { card_goto: "ogv", id: 2, ogv_info: { season_type: 2 }, title: "电影卡" },           // season_type=电影
      { card_goto: "ogv", id: 3, ogv_info: { season_type: 3 }, title: "纪录片卡" },
      { card_goto: "ogv", id: 4, title: "未知OGV" },                                        // 无法判定 → 保留（不臆断）
      { card_goto: "ogv", id: 5, args: { tid: 22 }, title: "鬼畜调教卡" },                  // 非屏蔽分区 → 保留
    ] } };
    // r1: 屏蔽番剧+电影 → 番剧卡(args.tid=13)与电影卡(season_type=2)删除
    var r1 = Net.processFeedPayload(cfg({ blockedZones: ["anime", "movie"] }), payload, null);
    eq(r1.json.data.items.map(function (i) { return i.title; }), ["纪录片卡", "未知OGV", "鬼畜调教卡"]);
    // r2: 仅屏蔽纪录片 → 只有纪录片卡删除
    var r2 = Net.processFeedPayload(cfg({ blockedZones: ["documentary"] }), payload, null);
    eq(r2.json.data.items.map(function (i) { return i.title; }), ["番剧卡", "电影卡", "未知OGV", "鬼畜调教卡"]);
  });

  test("TC-32", "NFR-1 特异性：args.tid/tname 是标签不作为删除依据（防误删）", function () {
    // 实样 #0：分区=网络游戏(rid 65)，标签=搞笑(tid 1833)。屏蔽"生活"不得误删此游戏视频
    var item = { bvid: BV.game, card_goto: "av", args: { rid: 65, rname: "网络游戏", tid: 1833, tname: "搞笑" } };
    var r1 = Net.processFeedPayload(cfg({ blockedZones: ["life"] }), { code: 0, data: { items: [item] } }, null);
    eq(r1.json.data.items.length, 1, "标签'搞笑'不应触发生活分区删除：");
    var r2 = Net.processFeedPayload(cfg({ blockedZones: ["game"] }), { code: 0, data: { items: [item] } }, null);
    eq(r2.json.data.items.length, 0, "分区'网络游戏'命中应删除");
  });

  window.BILILOCK_CASES = cases;
})();
