/* BiliLock 规则引擎 —— 全部"锁/不锁"判定的唯一真值来源（纯函数，可脱离浏览器单测）。
 * 依赖: zones-data.js 提供 globalThis.BILILOCK_ZONES_DATA
 * 对外暴露: globalThis.BiliLockRules
 */
globalThis.BiliLockRules = (function () {
  "use strict";

  var DATA = globalThis.BILILOCK_ZONES_DATA || {};
  var ALIASES = DATA.aliases || {};

  /* ---------- 分区归一表（一次性构建） ---------- */
  var tnameToCode = {};   // 中文名/英文码(小写) -> 主分区 code
  var tidToCode = {};     // tid -> 主分区 code
  var slugToCode = {};    // 频道路由 slug -> 主分区 code
  var codeToInfo = {};    // code -> {code, tname, route}

  function reg(code, tname, tid, route) {
    if (!code) return;
    codeToInfo[code] = { code: code, tname: tname || code, route: route || code };
    if (tname) tnameToCode[tname] = code;
    if (code) tnameToCode[String(code).toLowerCase()] = code;
    if (tid != null) tidToCode[String(tid)] = code;
    if (route) slugToCode[route] = code;
  }

  (DATA.v1_main || []).forEach(function (m) { reg(m.code, m.tname, m.tid, m.route); });
  (DATA.v2_main || []).forEach(function (m) { reg(m.code, m.tname, m.tid, m.route); });
  (DATA.v1_sub || []).forEach(function (s) {
    var parent = s.route && s.route.indexOf("/") > 0 ? s.route.split("/")[0] : s.parent;
    tnameToCode[s.tname] = parent || null;
    if (s.tid != null && parent) tidToCode[String(s.tid)] = parent;
  });
  (DATA.v2_sub || []).forEach(function (s) {
    tnameToCode[s.tname] = s.parent || null;
    if (s.tid != null && s.parent) tidToCode[String(s.tid)] = s.parent;
  });
  Object.keys(ALIASES).forEach(function (alias) {
    tnameToCode[alias] = ALIASES[alias];
  });
  (DATA.extra_channels || []).forEach(function (c) {
    reg(c.code, c.tname, null, c.route);
  });

  /* ---------- 主分区清单（UI 用） ---------- */
  var MAIN_ZONES = (DATA.v2_main || [])
    .filter(function (m) { return m.code !== "ad"; })
    .map(function (m) {
      var known = codeToInfo[m.code] || {};
      return { code: m.code, tname: m.tname || known.tname || m.code, route: m.route || known.route || m.code };
    });

  /* ---------- 判定函数 ---------- */

  /** 任意 tname / 英文 code / tid → 主分区 code；未知返回 null（不臆断） */
  function normalizeZone(input) {
    if (input == null || input === "") return null;
    if (typeof input === "number") return tidToCode[String(input)] || null;
    var key = String(input).trim();
    if (tnameToCode[key]) return tnameToCode[key];
    var lower = key.toLowerCase();
    if (tnameToCode[lower]) return tnameToCode[lower];
    return null;
  }

  /**
   * 注入运行时分区库（后台经官方榜单收割的"子分区 tid/tname → 主分区"映射）。
   * 运行时表对同名键覆盖内置表（更新、更全）；值必须是合法主分区 code。
   */
  function enrichZoneTable(table) {
    if (!table) return 0;
    var n = 0;
    var tid = table.tidToCode || {};
    var tn = table.tnameToCode || {};
    Object.keys(tid).forEach(function (k) {
      var code = tid[k];
      if (code && codeToInfo[code]) { tidToCode[String(k)] = code; n++; }
    });
    Object.keys(tn).forEach(function (k) {
      var code = tn[k];
      if (code && codeToInfo[code]) {
        tnameToCode[k] = code;
        tnameToCode[String(k).toLowerCase()] = code;
        n++;
      }
    });
    return n;
  }

  function isZoneBlocked(config, zoneInput) {
    var code = zoneInput == null ? null : normalizeZone(zoneInput);
    if (!code) return false;
    var blocked = (config && config.blockedZones) || [];
    return blocked.indexOf(code) !== -1;
  }

  var BV_RE = /(BV[0-9A-Za-z]{10})/g;
  function extractBvid(str) {
    if (!str) return null;
    var m = BV_RE.exec(String(str));
    BV_RE.lastIndex = 0;
    return m ? m[1] : null;
  }

  /** URL → 页面分类 */
  function classifyUrl(url) {
    var u;
    try { u = new URL(url, "https://www.bilibili.com"); } catch (e) { return { type: "other" }; }
    var host = u.hostname;
    var path = u.pathname.replace(/\/+/g, "/");
    if (host === "live.bilibili.com") return { type: "channel", slug: "live.bilibili.com", site: "live" };
    if (host !== "www.bilibili.com" && host !== "m.bilibili.com" && host.endsWith(".bilibili.com")) {
      if (host === "space.bilibili.com") {
        var uid = path.split("/")[1] || "";
        if (/^favlist/.test(path.split("/")[2] || "")) return { type: "favlist", uid: uid };
        return { type: "space", uid: uid };
      }
      return { type: "other" };
    }
    if (path === "/" || path === "" || path === "/index.html") return { type: "home" };
    var m;
    // 视频页（兼容本地化前缀，如实测的 /zh-Hans/video/BV…，见 docs/research/bili_home.html）
    if ((m = path.match(/^(?:\/[a-zA-Z]{2,5}(?:-[a-zA-Z]{2,5})?)?\/video\/(BV[0-9A-Za-z]{10})/))) {
      return { type: "video", bvid: m[1] };
    }
    if ((m = path.match(/^\/v\/([a-z0-9_]+)/))) return { type: "channel", slug: m[1] };
    if ((m = path.match(/^\/c\/([a-z0-9_]+)/))) return { type: "channel", slug: m[1] };
    // 站点级频道：/anime /guochuang /documentary /movie /tv /variety
    if ((m = path.match(/^\/(anime|guochuang|documentary|movie|tv|variety)(?:\/|$)/))) {
      return { type: "channel", slug: m[1] };
    }
    if (path.indexOf("/search") === 0) return { type: "search" };
    return { type: "other" };
  }

  /** 频道 slug（v1 路由 / v2 代号 / 站点级）是否被锁 */
  function isChannelLocked(config, slug) {
    if (!slug) return false;
    var code = slugToCode[slug] || tnameToCode[slug.toLowerCase()] || null;
    if (!code) return false;
    var blocked = (config && config.blockedZones) || [];
    return blocked.indexOf(code) !== -1;
  }

  /** 整页是否上锁（L4）。ctx: {favSet:Set|null, videoZone:code|null, favKnown:bool} */
  var classifyUrlImpl = classifyUrl; // 可注入覆盖（模拟站点/测试用），生产环境恒为本地实现
  function setUrlClassifier(fn) { classifyUrlImpl = fn; }

  function isPageLocked(config, url, ctx) {
    ctx = ctx || {};
    var page = classifyUrlImpl(url);
    var reason = "";
    if ((config && config.favoritesOnly) && ctx.favKnown !== false) {
      var favSet = ctx.favSet || null;
      var allowed =
        page.type === "favlist" ||
        (page.type === "video" && favSet && page.bvid && favSet.has(page.bvid));
      if (!allowed) {
        reason = page.type === "video" && favSet
          ? "该视频不在你的收藏夹中"
          : "「只看收藏夹」已开启：收藏夹以外的 B 站站点均已上锁";
        return { locked: true, reason: reason, page: page };
      }
      return { locked: false, reason: "", page: page };
    }
    if (page.type === "channel" && isChannelLocked(config, page.slug)) {
      var chanCode = slugToCode[page.slug] || tnameToCode[String(page.slug).toLowerCase()] || null;
      var chanInfo = chanCode ? codeToInfo[chanCode] : null;
      return { locked: true, reason: "分区「" + (chanInfo && chanInfo.tname || page.slug) + "」已被 BiliLock 上锁", page: page };
    }
    if (page.type === "video" && ctx.videoZone && isZoneBlocked(config, ctx.videoZone)) {
      var info = codeToInfo[ctx.videoZone] || {};
      return { locked: true, reason: "该视频属于分区「" + (info.tname || ctx.videoZone) + "」，该分区已被上锁", page: page };
    }
    return { locked: false, reason: "", page: page };
  }

  /**
   * 首页推荐流条目过滤（L1，特异性的核心）。
   * resolve(bvid) -> tname|code|null：外部解析器（缓存映射），可空。
   * 返回 {kept: 条目数组, unknownBvids: 分区未知的 bvid（交给 DOM 层兜底）}
   */
  function filterFeedItems(config, items, resolve) {
    var kept = [], unknownBvids = [];
    var SEASON_TYPE_TO_CODE = { "1": "anime", "2": "movie", "3": "documentary", "4": "guochuang", "5": "tv", "7": "variety" };
    (items || []).forEach(function (item) {
      if (!item) return;
      var gotoType = item.card_goto || item.goto;
      // R2 网络层广告过滤（cm 卡片/广告位标记），DOM 层为兜底
      if (config && config.removeAds) {
        if (gotoType === "cm" || item.is_ad_loc === true || item.is_ad_loc === 1 ||
            (item.cm_mark != null && item.cm_mark > 0)) return;
      }
      if (gotoType && gotoType !== "av" && gotoType !== "ogv") { kept.push(item); return; } // banner/live/web 不在范围
      var bvid = item.bvid || item.bv_id || (item.url && extractBvid(item.url)) || null;
      // 真实接口字段语义（docs/research/api_recommend.md 实样，docs/03-测试报告 R9）：
      //   首页推荐流 args: rid/rname = 分区（可靠）；tid/tname = 视频标签（可为任意活动标签，
      //     既不可靠也不能用于删除——否则会误删/漏删），仅 ogv 卡的 args.tid 为分区 tid。
      //   相关推荐: item.tname/item.tid（顶层，即分区）；收藏夹: bv_id + tid/tname（顶层）。
      var args = item.args || null;
      var zoneName = (args && (args.rname || args.rid))
        || item.tname_v2 || item.tnamev2 || item.tname
        || (item.tid_v2 != null ? item.tid_v2 : null)
        || (item.tid != null ? item.tid : null)
        || (gotoType === "ogv" && args && args.tid);
      var code = normalizeZone(zoneName);
      // OGV（番剧/电影/纪录片/国创/电视剧/综艺）: season_type 稳定枚举兜底映射（FR1 扩展覆盖）
      if (!code && gotoType === "ogv" && item.ogv_info && item.ogv_info.season_type != null) {
        code = normalizeZone(SEASON_TYPE_TO_CODE[String(item.ogv_info.season_type)] || null);
      }
      if (!code && resolve) code = normalizeZone(resolve(bvid));
      if (code) {
        if (!isZoneBlocked(config, code)) kept.push(item);
        else if (bvid) unknownBvids.push(bvid); // 已删条目的 bvid 一并广播，供映射缓存
      } else {
        kept.push(item); // 未知分区不臆断，保留并交给 DOM 层三级解析兜底
        if (bvid) unknownBvids.push(bvid);
      }
    });
    return { kept: kept, unknownBvids: unknownBvids };
  }

  /** 收藏夹页条目是否应被隐藏（FR5-3：收藏夹内同样应用分区屏蔽） */
  function shouldStripFavItem(config, item, favSet) {
    var bvid = item && (item.bvid || extractBvid(item.href || item.link || ""));
    if (config && config.favoritesOnly && favSet && bvid && !favSet.has(bvid)) return true;
    return isZoneBlocked(config, item && (item.tname || item.tid));
  }

  /** 通用卡片 bvid 是否应被删除（信息流/搜索/收藏等 DOM 兜底） */
  function shouldStripBvid(config, bvid, zoneInput, favSet) {
    if (!bvid) return false;
    if (config && config.favoritesOnly && favSet && !favSet.has(bvid)) return true;
    return isZoneBlocked(config, zoneInput);
  }

  return {
    normalizeZone: normalizeZone,
    enrichZoneTable: enrichZoneTable,
    isZoneBlocked: isZoneBlocked,
    isChannelLocked: isChannelLocked,
    classifyUrl: classifyUrl,
    setUrlClassifier: setUrlClassifier,
    isPageLocked: isPageLocked,
    filterFeedItems: filterFeedItems,
    shouldStripFavItem: shouldStripFavItem,
    shouldStripBvid: shouldStripBvid,
    extractBvid: extractBvid,
    mainZones: MAIN_ZONES,
    zoneInfo: function (code) { return codeToInfo[code] || null; },
  };
})();
