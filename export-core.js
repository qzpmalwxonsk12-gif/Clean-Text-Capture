(function (global) {
  "use strict";
  function filename(title, format = "pdf") {
    if (!["pdf", "txt", "json"].includes(format)) throw new Error("Unsupported export format.");
    // Keep human-readable Unicode titles, but no punctuation/path separators,
    // control characters, Windows device names, or excessively long basenames.
    let name = String(title || "").normalize("NFKC")
      .replace(/['’]/g, "").replace(/[^\p{L}\p{N}\p{M} _-]+/gu, " ")
      .replace(/\s+/g, " ").trim();
    let shortened = "";
    for (const character of name) {
      if (shortened.length + character.length > 160) break;
      shortened += character;
    }
    name = shortened.trim() || "Novel";
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) name = `Novel ${name}`;
    return `${name}.${format}`;
  }
  function select(chapters, copiedNumbers) {
    const allowed = copiedNumbers ? new Set(copiedNumbers) : null;
    const selected = chapters.filter(chapter => (!allowed || allowed.has(chapter.chapterNumber)) && chapter.cleanText?.trim())
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
    if (!selected.length) throw new Error("This collection has no chapter text to export yet.");
    return selected;
  }
  function text(chapters, copiedNumbers) {
    return select(chapters, copiedNumbers).map(chapter => chapter.cleanText).join("\n\n") + "\n";
  }
  global.ChapterExport = {filename, text, select};
  if (typeof module !== "undefined" && module.exports) module.exports = global.ChapterExport;
})(globalThis);
