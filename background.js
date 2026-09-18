chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https:\/\/(www\.)?xiaohongshu\.com\//.test(tab.url || "")) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["overlay.js"] });
  } catch (error) {
    console.error("Unable to toggle lottery panel", error);
  }
});
