const { webFrame } = require("electron");

const STAGE_HIDE_CHROME_CSS = `
html, body, ytd-app, #content, #page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner {
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: #000 !important;
}
ytd-masthead,
#secondary,
#below,
#comments,
#related,
tp-yt-app-drawer,
ytd-popup-container,
ytd-consent-bump-v2-lightbox,
ytd-enforcement-message-view-model,
tp-yt-paper-dialog,
ytd-watch-metadata,
#chat-container,
ytd-merch-shelf-renderer,
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
.ytp-chrome-top,
.ytp-chrome-bottom,
.ytp-gradient-top,
.ytp-gradient-bottom,
.ytp-watermark,
.ytp-ce-element,
.ytp-pause-overlay,
.ytp-paid-content-overlay,
.ytp-suggested-action,
.ytp-spinner,
.ytp-bezel,
.ytp-bezel-text-wrapper,
.ytp-doubletap-ui,
.ytp-doubletap-ui-legacy,
.ytp-cued-thumbnail-overlay,
.ytp-cued-thumbnail-overlay-image,
.ytp-large-play-button,
.ytp-ad-module,
.ytp-ad-overlay-container,
.ytp-ad-player-overlay,
.ytp-ad-player-overlay-layout,
.ytp-ad-skip-button-container,
.video-ads,
.iv-branding,
.annotation,
.ytp-cards-teaser,
.ytp-cards-button,
.ytp-title,
.ytp-title-channel,
.ytp-show-tiles,
.ytp-endscreen-content,
.ytp-autonav-endscreen-countdown-overlay,
.ytp-caption-window-container {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
ytd-player,
#ytd-player,
#player-container,
#player-container-inner,
#player-container-outer,
#full-bleed-container,
#player-full-bleed-container,
#movie_player {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #000 !important;
  visibility: visible !important;
  opacity: 1 !important;
}
#movie_player {
  z-index: 2147483647 !important;
}
#movie_player .html5-video-container {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #000 !important;
}
#movie_player video.html5-main-video {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  left: 0 !important;
  top: 0 !important;
  transform: none !important;
  object-fit: contain !important;
  visibility: visible !important;
  opacity: 1 !important;
}
`;

const AD_STRIP_BOOTSTRAP = `
(() => {
  if (window.__ariaYtAdStripInstalled) return;
  window.__ariaYtAdStripInstalled = true;
  const stripAdFields = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 2) return obj;
    try {
      if ("adPlacements" in obj) delete obj.adPlacements;
      if ("playerAds" in obj) delete obj.playerAds;
      if ("adSlots" in obj) delete obj.adSlots;
      if ("adBreakHeartbeatParams" in obj) delete obj.adBreakHeartbeatParams;
      if (obj.playerResponse && typeof obj.playerResponse === "object") {
        stripAdFields(obj.playerResponse, depth + 1);
      }
    } catch {}
    return obj;
  };
  try {
    let storedInitialPlayer = stripAdFields(window.ytInitialPlayerResponse);
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() {
        return storedInitialPlayer;
      },
      set(val) {
        storedInitialPlayer = stripAdFields(val);
      },
    });
  } catch {}
  try {
    const origParse = JSON.parse;
    JSON.parse = function (...args) {
      const parsed = origParse.apply(this, args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if ("adPlacements" in parsed || "playerAds" in parsed || "adSlots" in parsed || "playerResponse" in parsed) {
          stripAdFields(parsed);
        }
      }
      return parsed;
    };
  } catch {}
  try {
    if (typeof window.fetch === "function") {
      const origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : "";
        return origFetch(input, init).then((response) => {
          if (!/\\/youtubei\\/v1\\/(?:player|next)/.test(url)) return response;
          try {
            const origJson = response.json.bind(response);
            response.json = () => origJson().then((data) => stripAdFields(data));
          } catch {}
          return response;
        });
      };
    }
  } catch {}
})();
`;

try {
  webFrame.insertCSS(STAGE_HIDE_CHROME_CSS);
} catch {
  // Best-effort document_start CSS injection; renderer also injects on dom-ready.
}

try {
  void webFrame.executeJavaScript(AD_STRIP_BOOTSTRAP, true).catch(() => {});
} catch {
  // Ignore isolated world failures before navigation settles.
}
