(() => {
  const HOST_ID = "xhs-lottery-floating-panel";
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .panel {
      position: fixed;
      top: 76px;
      right: 24px;
      width: 380px;
      height: min(560px, calc(100vh - 100px));
      min-height: 420px;
      border: 0;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 18px 52px rgba(24, 28, 33, .24), 0 2px 10px rgba(24, 28, 33, .10);
      pointer-events: auto;
      overflow: hidden;
    }
    @media (max-width: 460px) {
      .panel { right: 12px; width: calc(100vw - 24px); }
    }
  `;
  const frame = document.createElement("iframe");
  frame.className = "panel";
  frame.src = chrome.runtime.getURL("sidepanel.html");
  frame.title = "小红书抽奖助手";
  frame.setAttribute("allow", "clipboard-write");
  shadow.append(style, frame);
  document.documentElement.append(host);

  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data?.type === "XHS_LOTTERY_CLOSE") host.remove();
  });
})();
