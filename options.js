(function () {
  "use strict";

  const settings = globalThis.ChapterSettings;
  const fields = {
    textSettleSeconds:document.getElementById("text-settle-seconds"),
    chapterDelaySeconds:document.getElementById("chapter-delay-seconds"),
    nextFallbackSeconds:document.getElementById("next-fallback-seconds"),
    securityRetrySeconds:document.getElementById("security-retry-seconds")
  };
  const fastMode = document.getElementById("fast-mode");
  const saveButton = document.getElementById("save");
  const status = document.getElementById("status");

  function read() {
    return settings.normalize({fastMode:fastMode.checked,...Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value]))});
  }
  function show(values) {
    const normalized = settings.normalize(values);
    fastMode.checked = normalized.fastMode;
    for (const [key,input] of Object.entries(fields)) input.value = String(normalized[key]);
  }
  function save() {
    const values = read();
    show(values);
    chrome.storage.local.set(values, () => {
      status.textContent = chrome.runtime.lastError ? chrome.runtime.lastError.message :
        `Saved. ${values.fastMode ? "Fast" : "Standard"} navigation; settling ${values.textSettleSeconds}s, after-copy ${values.chapterDelaySeconds}s, fallback ${values.nextFallbackSeconds}s. Changes apply to the running collection.`;
    });
  }
  chrome.storage.local.get(settings.defaults, values => {
    if (chrome.runtime.lastError) { status.textContent = chrome.runtime.lastError.message; return; }
    show(values);
  });
  saveButton.addEventListener("click", save);
  for (const [id,preset] of [["fast-preset",settings.fastPreset],["standard-preset",settings.standardPreset]]) {
    document.getElementById(id).addEventListener("click", () => { show({...read(),...preset}); save(); });
  }
})();
