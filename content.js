(() => {
  if (globalThis.__XHS_LOTTERY_CONTENT_LOADED__) return;
  globalThis.__XHS_LOTTERY_CONTENT_LOADED__ = true;

  const POST_PATTERNS = [
    /\/explore\/([a-zA-Z0-9]+)/,
    /\/discovery\/item\/([a-zA-Z0-9]+)/,
    /\/item\/([a-zA-Z0-9]+)/
  ];

  function firstText(...values) {
    return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  }

  function postIdFromLocation() {
    for (const pattern of POST_PATTERNS) {
      const match = location.pathname.match(pattern);
      if (match) return match[1];
    }
    return new URL(location.href).searchParams.get("note_id") || "";
  }

  function meta(property) {
    return document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.content || "";
  }

  function authorFromDom() {
    const profile = document.querySelector([
      '[data-testid*="author"] a[href*="/user/profile/"]',
      '[class*="author-container"] a[href*="/user/profile/"]',
      '[class*="note"] [class*="author"] a[href*="/user/profile/"]',
      '.author a[href*="/user/profile/"]'
    ].join(","));
    return {
      userId: userIdFromHref(profile?.getAttribute("href")),
      nickname: firstText(profile?.getAttribute("aria-label"), profile?.textContent)
    };
  }

  function authorFromPageData(postId) {
    const scripts = [...document.querySelectorAll('script[type="application/json"], script#__INITIAL_STATE__')];
    const visited = new WeakSet();
    let found = null;

    function pick(obj, keys) {
      for (const key of keys) if (obj?.[key] !== undefined && obj[key] !== null) return obj[key];
      return undefined;
    }

    function walk(value, depth = 0) {
      if (found || !value || typeof value !== "object" || depth > 18 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
      const candidateId = String(pick(value, ["note_id", "noteId", "id"]) || "");
      const user = pick(value, ["user", "user_info", "userInfo"]);
      if (candidateId === postId && user) {
        const userId = String(pick(user, ["user_id", "userId", "userid", "id"]) || "");
        if (userId) found = { userId, nickname: firstText(pick(user, ["nickname", "nick_name", "name"])) };
      }
      for (const child of Object.values(value)) walk(child, depth + 1);
    }

    for (const script of scripts) {
      const raw = script.textContent?.trim();
      if (!raw || raw.length > 20_000_000) continue;
      try { walk(JSON.parse(raw)); } catch { /* Ignore non-JSON state scripts. */ }
      if (found) break;
    }
    return found || { userId: "", nickname: "" };
  }

  function identifyPost() {
    const postId = postIdFromLocation();
    const domAuthor = authorFromDom();
    const dataAuthor = authorFromPageData(postId);
    const title = firstText(meta("og:title"), document.querySelector("h1")?.textContent, document.title.replace(/\s*[-|_]\s*小红书.*$/i, ""));
    const author = firstText(
      domAuthor.nickname,
      dataAuthor.nickname,
      document.querySelector('[data-testid*="author"]')?.textContent,
      meta("author")
    );
    return {
      isPost: Boolean(postId),
      postId,
      title: title || "当前小红书帖子",
      author,
      authorUserId: domAuthor.userId || dataAuthor.userId,
      cover: firstText(meta("og:image"), meta("twitter:image")),
      url: location.href
    };
  }

  function userIdFromHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/\/user\/profile\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch { return ""; }
  }

  function extractDomComments() {
    const candidates = document.querySelectorAll([
      '[data-testid="comment-item"]',
      '[data-testid*="comment"][data-comment-id]',
      '[data-comment-id]',
      '.comment-item',
      '[class*="comment-item"]'
    ].join(","));
    const output = [];
    const seenNodes = new Set();

    for (const node of candidates) {
      if (seenNodes.has(node)) continue;
      seenNodes.add(node);
      const nestedMarker = node.closest('.reply-container, [class*="reply-container"], [data-testid*="reply"]');
      if (nestedMarker && nestedMarker !== node) continue;
      const parentComment = node.parentElement?.closest('[data-comment-id], .comment-item, [class*="comment-item"]');
      if (parentComment) continue;

      const profile = node.querySelector('a[href*="/user/profile/"]');
      const userId = userIdFromHref(profile?.getAttribute("href"));
      if (!userId) continue;
      const nickname = firstText(
        profile?.getAttribute("aria-label"),
        node.querySelector('[data-testid*="user"], [class*="author"], [class*="name"]')?.textContent,
        profile?.textContent,
        `用户 ${userId.slice(-6)}`
      );
      const image = node.querySelector('img[src]');
      output.push({
        userId,
        nickname,
        avatar: image?.currentSrc || image?.src || "",
        commentId: node.getAttribute("data-comment-id") || node.id || "",
        source: "dom"
      });
    }
    return output;
  }

  function parseJsonScripts() {
    const results = [];
    const visited = new WeakSet();
    const scripts = [...document.querySelectorAll('script[type="application/json"], script#__INITIAL_STATE__')];

    function pick(obj, keys) {
      for (const key of keys) if (obj?.[key] !== undefined && obj[key] !== null) return obj[key];
      return undefined;
    }

    function walk(value, depth = 0) {
      if (!value || typeof value !== "object" || depth > 18 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }

      const user = pick(value, ["user_info", "userInfo", "user"]);
      const commentId = String(pick(value, ["id", "comment_id", "commentId"]) || "");
      const content = pick(value, ["content", "text", "comment_content"]);
      if (user && commentId && typeof content === "string") {
        const parentId = pick(value, ["parent_comment_id", "parentCommentId", "root_comment_id", "rootCommentId"]);
        const isReply = parentId !== undefined && parentId !== null && String(parentId) !== "" && String(parentId) !== "0" && String(parentId) !== commentId;
        if (!isReply) {
          const userId = String(pick(user, ["user_id", "userId", "userid", "id"]) || "");
          if (userId) results.push({
            userId,
            nickname: firstText(pick(user, ["nickname", "nick_name", "name"]), `用户 ${userId.slice(-6)}`),
            avatar: firstText(pick(user, ["image", "avatar", "avatar_url", "avatarUrl"])),
            commentId,
            source: "page-data"
          });
        }
      }
      for (const child of Object.values(value)) walk(child, depth + 1);
    }

    for (const script of scripts) {
      const raw = script.textContent?.trim();
      if (!raw || raw.length > 20_000_000) continue;
      try { walk(JSON.parse(raw)); } catch { /* Not all state scripts contain strict JSON. */ }
    }
    return results;
  }

  function mergeByUserId(items) {
    const map = new Map();
    for (const item of items) {
      if (!item.userId) continue;
      const previous = map.get(item.userId);
      if (!previous) map.set(item.userId, item);
      else map.set(item.userId, {
        ...previous,
        nickname: previous.nickname || item.nickname,
        avatar: previous.avatar || item.avatar,
        commentId: previous.commentId || item.commentId
      });
    }
    return [...map.values()];
  }

  function findScrollTarget() {
    const explicit = document.querySelector('.comments-container, [class*="comments-container"], [data-testid="comments"]');
    if (explicit && explicit.scrollHeight > explicit.clientHeight) return explicit;
    return document.scrollingElement || document.documentElement;
  }

  function visibleRelationElements() {
    const statuses = new Set(["回关", "互相关注", "已关注", "关注"]);
    return [...document.querySelectorAll(
      '.tooltip-content button.follow-button, .tooltip-content .follow-button'
    )].filter((element) => {
      const textElement = element.querySelector(".reds-button-new-text") || element;
      const text = textElement.textContent?.replace(/\s+/g, "").trim();
      if (!statuses.has(text)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
        style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0;
    });
  }

  function profileElementForUser(userId) {
    const avatar = [...document.querySelectorAll("img.avatar-item[data-user-id]")]
      .find((image) => image.dataset.userId === userId && image.getBoundingClientRect().width > 0);
    if (avatar) return avatar;
    const matches = [...document.querySelectorAll('a[href*="/user/profile/"]')]
      .filter((anchor) => userIdFromHref(anchor.getAttribute("href")) === userId);
    return matches.find((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && anchor.querySelector("img");
    }) || matches.find((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || matches[0] || null;
  }

  function dispatchHover(element, entering) {
    const events = entering
      ? [["pointerover", true], ["pointerenter", false], ["pointermove", true], ["mouseover", true], ["mouseenter", false], ["mousemove", true]]
      : [["pointerout", true], ["pointerleave", false], ["mouseout", true], ["mouseleave", false]];
    for (const [type, bubbles] of events) {
      const EventClass = type.startsWith("pointer") && globalThis.PointerEvent ? PointerEvent : MouseEvent;
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new EventClass(type, {
        bubbles,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerType: "mouse",
        isPrimary: true
      }));
    }
  }

  function relationForParticipant(participant) {
    for (const control of visibleRelationElements()) {
      const card = control.closest(".tooltip-content") || control.parentElement;
      const cardUserIds = new Set([
        ...[...card.querySelectorAll("[data-user-id]")].map((element) => element.getAttribute("data-user-id")),
        ...[...card.querySelectorAll('a[href*="/user/profile/"]')].map((anchor) => userIdFromHref(anchor.getAttribute("href")))
      ].filter(Boolean));
      const normalizedCardText = card.textContent?.replace(/\s+/g, "").trim() || "";
      const normalizedNickname = participant.nickname?.replace(/\s+/g, "").trim() || "";
      if (cardUserIds.size && !cardUserIds.has(participant.userId)) continue;
      if (!cardUserIds.size && normalizedNickname && !normalizedCardText.includes(normalizedNickname)) continue;
      const textElement = control.querySelector(".reds-button-new-text") || control;
      return textElement.textContent.replace(/\s+/g, "").trim();
    }
    return "";
  }

  async function waitForRelationStatus(participant, timeoutMs = 3200) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const relation = relationForParticipant(participant);
      if (relation) return relation;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return "unknown";
  }

  async function waitForManualHover(element, participant, timeoutMs = 20000) {
    const previousOutline = element.style.outline;
    const previousOutlineOffset = element.style.outlineOffset;
    const previousTransition = element.style.transition;
    element.style.outline = "4px solid #ff2442";
    element.style.outlineOffset = "4px";
    element.style.transition = "outline-color .2s ease";
    element.setAttribute("data-xhs-lottery-hover-target", "true");
    try {
      return await waitForRelationStatus(participant, timeoutMs);
    } finally {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOutlineOffset;
      element.style.transition = previousTransition;
      element.removeAttribute("data-xhs-lottery-hover-target");
    }
  }

  async function verifyFollowers({ authorUserId, participants, maxChecks = 10 }) {
    if (!authorUserId) throw new Error("缺少作者 User ID");
    if (!Array.isArray(participants) || participants.length > maxChecks) throw new Error(`测试模式最多验证 ${maxChecks} 人`);
    // Version the cache when relationship-card parsing changes so stale results
    // from older, broader DOM matching cannot affect eligibility.
    const cacheKey = "followerRelationCacheV2";
    const stored = await chrome.storage.local.get(cacheKey);
    const cache = stored[cacheKey] || {};
    const now = Date.now();
    const ttl = 24 * 60 * 60 * 1000;
    const results = [];
    let unknownCount = 0;
    const failureCounts = { profileNotFound: 0, hoverNotTriggered: 0 };
    const scrollTarget = findScrollTarget();
    const originalTargetTop = scrollTarget.scrollTop;
    const originalWindowTop = window.scrollY;

    try {
      for (const participant of participants) {
        const key = `${authorUserId}:${participant.userId}`;
        const cached = cache[key];
        let relation = cached && now - cached.checkedAt < ttl ? cached.relation : "";
        if (!relation) {
          const profile = profileElementForUser(participant.userId);
          if (!profile) {
            relation = "unknown";
            failureCounts.profileNotFound += 1;
          } else {
            profile.scrollIntoView({ block: "center", behavior: "auto" });
            await new Promise((resolve) => setTimeout(resolve, 450));
            const possibleTargets = [
              profile.matches?.("img") ? profile : profile.querySelector("img"),
              profile,
              profile.closest?.("a"),
              profile.closest?.(".avatar"),
              profile.parentElement
            ].filter((element, index, array) => element && array.indexOf(element) === index);
            const manualTarget = possibleTargets[0];
            manualTarget.scrollIntoView({ block: "center", behavior: "auto" });
            relation = await waitForManualHover(manualTarget, participant, 20000);
            if (relation === "unknown") failureCounts.hoverNotTriggered += 1;
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
          if (relation !== "unknown") cache[key] = { relation, checkedAt: Date.now() };
        }
        const isFollower = relation === "回关" || relation === "互相关注";
        if (relation === "unknown") unknownCount += 1;
        results.push({ ...participant, relation, isFollower });
      }
    } finally {
      scrollTarget.scrollTo({ top: originalTargetTop, behavior: "auto" });
      window.scrollTo({ top: originalWindowTop, behavior: "auto" });
    }
    await chrome.storage.local.set({ [cacheKey]: cache });
    return { participants: results, unknownCount, failureCounts };
  }

  async function collectParticipants() {
    const post = identifyPost();
    if (!post.isPost) throw new Error("当前页面不是可识别的小红书帖子");
    const combined = [];
    let lastSize = 0;
    let stagnantRounds = 0;

    const target = findScrollTarget();
    const originalTargetTop = target.scrollTop;
    const originalWindowTop = window.scrollY;
    try {
      for (let round = 0; round < 30 && stagnantRounds < 5; round += 1) {
        combined.push(...parseJsonScripts(), ...extractDomComments());
        const size = mergeByUserId(combined).length;
        stagnantRounds = size === lastSize ? stagnantRounds + 1 : 0;
        lastSize = size;
        target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      combined.push(...parseJsonScripts(), ...extractDomComments());
    } finally {
      target.scrollTo({ top: originalTargetTop, behavior: "auto" });
      window.scrollTo({ top: originalWindowTop, behavior: "auto" });
    }
    const participants = mergeByUserId(combined);
    if (!participants.length) {
      throw new Error("未能读取一级评论。请确认评论区已显示，并在安装扩展后刷新帖子页面再试");
    }
    return { post, participants };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "XHS_LOTTERY_PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "XHS_IDENTIFY_POST") {
      sendResponse({ ok: true, post: identifyPost() });
      return;
    }
    if (message?.type === "XHS_COLLECT_PARTICIPANTS") {
      collectParticipants()
        .then((payload) => sendResponse({ ok: true, ...payload }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "XHS_VERIFY_FOLLOWERS") {
      verifyFollowers(message)
        .then((payload) => sendResponse({ ok: true, ...payload }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });
})();
