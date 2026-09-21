const DEFAULT_WINNER_MESSAGE = "恭喜 {winners} 中奖！请私信联系领取奖品。";

const state = {
  tabId: null,
  post: null,
  participantPool: [],
  excludedUserIds: new Set(),
  currentWinners: [],
  winnerCount: 1,
  followersOnly: false,
  winnerMessage: DEFAULT_WINNER_MESSAGE
};

const $ = (selector) => document.querySelector(selector);
const setupView = $("#setupView");
const loadingView = $("#loadingView");
const resultView = $("#resultView");
const backButton = $("#backButton");
const drawButton = $("#drawButton");
const errorBox = $("#errorBox");

function setStatusIcon(name) {
  $("#statusIconUse").setAttribute("href", `#icon-${name}`);
}

function showView(name) {
  setupView.classList.toggle("hidden", name !== "setup");
  loadingView.classList.toggle("hidden", name !== "loading");
  resultView.classList.toggle("hidden", name !== "result");
  backButton.classList.toggle("hidden", name !== "result");
}

function setError(message = "") {
  errorBox.textContent = message;
  errorBox.classList.toggle("hidden", !message);
}

async function currentXhsTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !/^https:\/\/(www\.)?xiaohongshu\.com\//.test(tab.url || "")) return null;
  return tab;
}

async function sendToTab(message) {
  try {
    return await chrome.tabs.sendMessage(state.tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(state.tabId, message);
  }
}

async function identifyCurrentPost() {
  const card = $("#postCard");
  card.className = "post-card checking";
  setStatusIcon("loader");
  $("#postStatus").textContent = "正在识别当前帖子";
  $("#postDetail").textContent = "请保持小红书帖子页面打开";
  drawButton.disabled = true;
  setError();

  const tab = await currentXhsTab();
  if (!tab) return showInvalidPost("请先打开一个小红书帖子页面");
  state.tabId = tab.id;
  try {
    const response = await sendToTab({ type: "XHS_IDENTIFY_POST" });
    if (!response?.post?.isPost) return showInvalidPost("当前页面不是可识别的小红书帖子");
    state.post = response.post;
    card.className = "post-card";
    setStatusIcon("check");
    $("#postStatus").textContent = "当前帖子已识别";
    $("#postDetail").textContent = [state.post.title, state.post.author && `作者：${state.post.author}`].filter(Boolean).join(" · ");
    if (state.post.cover) {
      $("#postCover").src = state.post.cover;
      $("#postCover").classList.remove("hidden");
    }
    drawButton.disabled = false;
    await restoreSavedResult();
  } catch (error) {
    showInvalidPost(`无法连接当前帖子：${error.message}`);
  }
}

function showInvalidPost(message) {
  const card = $("#postCard");
  card.className = "post-card invalid";
  setStatusIcon("info");
  $("#postStatus").textContent = "未识别到帖子";
  $("#postDetail").textContent = message;
  $("#postCover").classList.add("hidden");
  drawButton.disabled = true;
}

function secureRandomBelow(maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new Error("无效的随机范围");
  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

function secureSample(items, count) {
  const copy = [...items];
  const take = Math.min(count, copy.length);
  for (let index = 0; index < take; index += 1) {
    const swapIndex = index + secureRandomBelow(copy.length - index);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy.slice(0, take);
}

function nicknameConflicts(pool) {
  const counts = new Map();
  for (const participant of pool) counts.set(participant.nickname, (counts.get(participant.nickname) || 0) + 1);
  return counts;
}

function currentResultPool() {
  const winnerIds = new Set(state.currentWinners.map((winner) => winner.userId));
  return state.participantPool.filter((participant) =>
    !state.excludedUserIds.has(participant.userId) || winnerIds.has(participant.userId)
  );
}

function profileUrl(userId) {
  return `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`;
}

function winnerLabels(pool = currentResultPool()) {
  const conflicts = nicknameConflicts(pool);
  return state.currentWinners.map((winner) =>
    conflicts.get(winner.nickname) > 1 ? `${winner.nickname}（User ID: ${winner.userId}）` : winner.nickname
  );
}

function buildWinnerMessage() {
  const labels = winnerLabels();
  const template = state.winnerMessage.trim() || DEFAULT_WINNER_MESSAGE;
  const replacements = {
    "{winners}": labels.join("、"),
    "{count}": String(labels.length),
    "{post}": state.post?.title || "当前帖子"
  };
  let message = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    message = message.split(placeholder).join(value);
  }
  if (!template.includes("{winners}")) message += `\n中奖用户：${labels.join("、")}`;
  return message;
}

function renderWinners(winners, eligiblePool) {
  const grid = $("#winnerGrid");
  const conflicts = nicknameConflicts(eligiblePool);
  const hasConflict = winners.some((winner) => conflicts.get(winner.nickname) > 1);
  grid.className = `winner-grid${winners.length === 1 ? " single" : ""}`;
  grid.replaceChildren();

  winners.forEach((winner, index) => {
    const card = document.createElement("article");
    card.className = "winner-card";
    const avatar = winner.avatar
      ? Object.assign(document.createElement("img"), { className: "winner-avatar", src: winner.avatar, alt: `${winner.nickname} 的头像`, referrerPolicy: "no-referrer" })
      : Object.assign(document.createElement("div"), { className: "winner-avatar", textContent: winner.nickname.slice(0, 1) || "?" });
    const rank = Object.assign(document.createElement("span"), { className: "winner-rank", textContent: String(index + 1) });
    const name = Object.assign(document.createElement("h3"), { textContent: winner.nickname });
    card.append(avatar, rank, name);
    if (conflicts.get(winner.nickname) > 1) {
      card.append(Object.assign(document.createElement("p"), { textContent: `User ID: ${winner.userId}` }));
    }
    const profileLink = Object.assign(document.createElement("a"), {
      className: "winner-profile-link",
      href: profileUrl(winner.userId),
      target: "_blank",
      rel: "noopener noreferrer"
    });
    profileLink.setAttribute("aria-label", `查看 ${winner.nickname} 的小红书主页`);
    profileLink.innerHTML = '<span>查看主页</span><svg aria-hidden="true"><use href="#icon-external-link"/></svg>';
    card.append(profileLink);
    grid.append(card);
  });
  const summary = $("#resultSummary");
  summary.replaceChildren("本次抽奖共 ", Object.assign(document.createElement("strong"), { textContent: String(winners.length) }), " 位中奖者");
  $("#conflictNotice").classList.toggle("hidden", !hasConflict);
  $("#redrawButton").disabled = eligiblePool.length - winners.length < state.winnerCount;
  showView("result");
}

async function persistState() {
  await chrome.storage.local.set({
    lotteryState: {
      post: state.post,
      participantPool: state.participantPool,
      excludedUserIds: [...state.excludedUserIds],
      currentWinners: state.currentWinners,
      winnerCount: state.winnerCount,
      savedAt: Date.now()
    }
  });
}

async function restoreSavedResult() {
  const { lotteryState } = await chrome.storage.local.get("lotteryState");
  if (!lotteryState?.currentWinners?.length || lotteryState.post?.postId !== state.post?.postId) return;
  const authorUserId = state.post?.authorUserId || lotteryState.post?.authorUserId || "";
  if (authorUserId && lotteryState.currentWinners.some((winner) => winner.userId === authorUserId)) return;
  state.participantPool = (Array.isArray(lotteryState.participantPool) ? lotteryState.participantPool : [])
    .filter((participant) => !authorUserId || participant.userId !== authorUserId);
  state.excludedUserIds = new Set(lotteryState.excludedUserIds || []);
  state.currentWinners = lotteryState.currentWinners;
  state.winnerCount = Number(lotteryState.winnerCount) || state.currentWinners.length;
  renderWinners(state.currentWinners, currentResultPool());
}

async function performDraw({ recollect = false } = {}) {
  setError();
  $("#loadingText").textContent = "正在读取当前帖子的一级评论…";
  showView("loading");
  try {
    if (recollect || !state.participantPool.length) {
      const response = await sendToTab({ type: "XHS_COLLECT_PARTICIPANTS" });
      if (!response?.ok) throw new Error(response?.error || "评论读取失败");
      state.post = response.post;
      state.participantPool = response.participants.filter((participant) =>
        !state.post.authorUserId || participant.userId !== state.post.authorUserId
      );
      state.excludedUserIds = new Set();
    }
    const eligible = state.participantPool.filter((participant) => !state.excludedUserIds.has(participant.userId));
    if (eligible.length < state.winnerCount) throw new Error("剩余有效参与者不足以抽取当前设置的中奖人数");
    if (state.followersOnly) {
      if (!state.post.authorUserId) throw new Error("无法取得帖子作者的稳定 User ID，暂不能验证粉丝关系");
      const verifiedWinners = [];
      while (verifiedWinners.length < state.winnerCount) {
        const remaining = state.participantPool.filter((participant) => !state.excludedUserIds.has(participant.userId));
        if (!remaining.length) throw new Error(`奖池已经用尽，只验证到 ${verifiedWinners.length} 名符合条件的粉丝`);
        const candidate = secureSample(remaining, 1)[0];
        $("#loadingText").textContent = `候选人「${candidate.nickname}」已抽出，请悬停评论区红色高亮头像进行粉丝验证`;
        const verification = await sendToTab({
          type: "XHS_VERIFY_FOLLOWERS",
          authorUserId: state.post.authorUserId,
          participants: [candidate],
          maxChecks: 1
        });
        if (!verification?.ok) throw new Error(verification?.error || "粉丝关系验证失败");
        const result = verification.participants?.[0];
        if (!result || result.relation === "unknown") {
          const failures = verification.failureCounts || {};
          const detail = failures.profileNotFound ? "未找到可悬停头像" : "未在 20 秒内识别到信息卡关系状态";
          throw new Error(`候选人「${candidate.nickname}」无法验证：${detail}`);
        }
        state.excludedUserIds.add(candidate.userId);
        if (result.isFollower) verifiedWinners.push({ ...candidate, relation: result.relation });
        else $("#loadingText").textContent = `「${candidate.nickname}」不是粉丝，已排除并重新抽取…`;
      }
      state.currentWinners = verifiedWinners;
    } else {
      state.currentWinners = secureSample(eligible, state.winnerCount);
      state.currentWinners.forEach((winner) => state.excludedUserIds.add(winner.userId));
    }
    await persistState();
    renderWinners(state.currentWinners, currentResultPool());
  } catch (error) {
    showView("setup");
    setError(error.message);
  }
}

function selectedCount() {
  const selected = $(".choice.selected")?.dataset.count;
  const value = selected === "custom" ? Number($("#customCount").value) : Number(selected);
  return Math.max(1, Math.min(100, Number.isFinite(value) ? Math.floor(value) : 1));
}

$("#winnerOptions").addEventListener("click", (event) => {
  const button = event.target.closest(".choice");
  if (!button) return;
  setError();
  document.querySelectorAll(".choice").forEach((item) => item.classList.toggle("selected", item === button));
  if (button.dataset.count === "custom") $("#customCount").focus();
  state.winnerCount = selectedCount();
});

$("#customCount").addEventListener("focus", () => {
  setError();
  document.querySelectorAll(".choice").forEach((item) => item.classList.toggle("selected", item === $("#customCount")));
  state.winnerCount = selectedCount();
});

$("#customCount").addEventListener("input", () => {
  setError();
  state.winnerCount = selectedCount();
});
$("#followersOnly").addEventListener("change", (event) => {
  setError();
  state.followersOnly = event.target.checked;
});

let messageSaveTimer;
async function saveWinnerMessage() {
  clearTimeout(messageSaveTimer);
  await chrome.storage.local.set({ winnerMessageTemplate: state.winnerMessage });
  $("#messageSaveStatus").textContent = "已保存";
}

$("#winnerMessage").addEventListener("input", (event) => {
  state.winnerMessage = event.target.value;
  $("#messageSaveStatus").textContent = "保存中…";
  clearTimeout(messageSaveTimer);
  messageSaveTimer = setTimeout(saveWinnerMessage, 350);
});
$("#winnerMessage").addEventListener("change", saveWinnerMessage);
drawButton.addEventListener("click", () => { state.winnerCount = selectedCount(); performDraw({ recollect: true }); });
$("#redrawButton").addEventListener("click", () => performDraw());
backButton.addEventListener("click", () => showView("setup"));
$("#closeButton").addEventListener("click", () => {
  window.parent.postMessage({ type: "XHS_LOTTERY_CLOSE" }, "*");
});

$("#copyButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildWinnerMessage());
    $("#copyStatusText").textContent = "中奖文案已复制到剪贴板";
  } catch {
    $("#copyStatusText").textContent = "复制失败，请重试";
  }
});

chrome.tabs.onActivated.addListener(() => { showView("setup"); identifyCurrentPost(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && changeInfo.url) { showView("setup"); identifyCurrentPost(); }
});

async function initialize() {
  const stored = await chrome.storage.local.get("winnerMessageTemplate");
  state.winnerMessage = typeof stored.winnerMessageTemplate === "string"
    ? stored.winnerMessageTemplate
    : DEFAULT_WINNER_MESSAGE;
  $("#winnerMessage").value = state.winnerMessage;
  await identifyCurrentPost();
}

initialize();
