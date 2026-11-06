/* BiliLock 默认配置与存储键名（与 SRS §2.3 一致） */
(function () {
  "use strict";
  var KEYS = {
    SYNC_CONFIG: "bililock.config",
    LOCAL_FAVSET: "bililock.favset",
    LOCAL_ZONETABLE: "bililock.zonetable",     // storage.local 运行时分区库
    MIRROR_CONFIG: "bililock.config",          // sessionStorage 镜像键
    MIRROR_ZONE: "bililock.bvidzone",          // sessionStorage bvid→tname 映射缓存键
    MIRROR_ZONETABLE: "bililock.zonetable",    // sessionStorage 分区库镜像（MAIN world 消费）
  };
  var EVENTS = {
    CONFIG_MIRROR: "bililock:config",          // ISOLATED → MAIN 配置变更事件
    ZONETABLE_MIRROR: "bililock:zonetable",    // ISOLATED → MAIN 分区库镜像变更事件
    BVZONE_BROADCAST: "bililock:bvidzone",     // MAIN → ISOLATED 分区映射广播（postMessage type）
    CONFIG_CHANGED: "BILILOCK_CONFIG_CHANGED", // background → tabs 广播（runtime message）
  };
  var DEFAULT_CONFIG = {
    blockedZones: [],        // 主分区 code 列表（R1/R4）
    removeAds: true,         // R2
    hideComments: false,     // R3-1
    hideRecommend: false,    // R3-2
    favoritesOnly: false,    // R5
    pureVideoMode: false,    // R6
    lockMessage: "这里已被 BiliLock 上锁",
  };
  var FAV_TTL = 6 * 60 * 60 * 1000; // FR5-5 收藏夹缓存 6h

  globalThis.BiliLockDefaults = {
    KEYS: KEYS,
    EVENTS: EVENTS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    FAV_TTL: FAV_TTL,
  };
})();
