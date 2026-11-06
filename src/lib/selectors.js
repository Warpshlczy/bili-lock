/* BiliLock 选择器常量表 —— 全部 DOM 目标集中此处（NFR-5，依据 docs/research 实抓 HTML）。
 * 改版时只需维护本文件。
 */
(function () {
  "use strict";
  globalThis.BiliLockSelectors = {
    /* R2 广告 */
    AD_ELEMENTS: [
      "#slide_ad", ".slide-ad-exp", ".ad-floor-exp", ".ad-report", "#right-bottom-banner",
      ".banner-card",       // 首页顶部活动/广告横幅
      ".bili-video-card.is-ads",  // 信息流广告卡片（实测类名）
      ".feed-card:has(.bili-video-card.is-ads)",
      ".video-card-ad-common", ".page-ad-banner", // 视频页版位广告兜底
    ].join(","),

    /* R1 信息流卡片（首页/搜索通用） */
    FEED_CARD: ".feed-card, .bili-feed-card",
    FEED_CARD_INNER: ".bili-video-card",
    CARD_LINK: 'a[href*="/video/BV"]',

    /* R3 / R6 视频页 */
    COMMENTS: "#commentapp, .comment-container, #comment",
    DANMAKU: [
      "#danmukuBox", ".danmaku-box", ".danmaku-wrap",
      ".bpx-player-dm", ".bpx-player-dm-wrap", ".bpx-player-dm-btn", // 播放器弹幕层与弹幕开关
      ".danmaku-info-row",
    ].join(","),
    RECOMMEND: [
      ".recommend-list-v1", ".next-play", ".right-container", ".right-container-inner",
      ".video-page-card", ".video-page-card-small", "#reco_related", ".rec-list",
      ".playlist-container--right", ".playlist-wrap", ".up-list-v1",  // 连播/合集右栏
    ].join(","),

    /* R1 分区频道入口（顶部导航/侧栏内指向被锁频道的 <a>，动态匹配 href） */
    NAV_CONTAINER: ".bili-header, #biliMainHeader, .left-entry, .channel-link, .nav-menu",

    /* R5 收藏夹页条目（space.bilibili.com/<uid>/favlist） */
    FAV_ITEM: ".fav-list-main .items .item, .fav-content-item, .fav-video-list .item, .items .item",
  };
})();
