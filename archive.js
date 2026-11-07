(function (global) {
  "use strict";
  let opening;
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("clean-chapter-archive", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "sessionId" });
        if (!db.objectStoreNames.contains("chapters")) {
          const chapters = db.createObjectStore("chapters", { keyPath: ["sessionId", "chapterNumber"] });
          chapters.createIndex("sessionId", "sessionId");
        }
        if (!db.objectStoreNames.contains("timings")) {
          const timings = db.createObjectStore("timings", {keyPath:"id",autoIncrement:true});
          timings.createIndex("sessionId","sessionId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(request.error); };
    });
    return opening;
  }
  async function transact(stores, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Archive write aborted."));
      action(transaction);
    });
  }
  async function saveJob(job) {
    await transact(["jobs"], tx => tx.objectStore("jobs").put(job));
  }
  async function saveChapter(job, candidate) {
    await transact(["jobs", "chapters"], tx => {
      tx.objectStore("jobs").put(job);
      tx.objectStore("chapters").put({ ...candidate, sessionId: job.sessionId });
    });
  }
  async function read(store, query, index) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const source = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
      const request = source.getAll(query);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  global.ChapterArchive = {
    saveJob, saveChapter,
    addTiming: async event => transact(["timings"], tx => tx.objectStore("timings").add(event)),
    timings: async sessionId => read("timings",sessionId,"sessionId"),
    list: async () => (await read("jobs")).sort((a, b) => b.startedAt - a.startedAt),
    chapters: async sessionId => (await read("chapters", sessionId, "sessionId")).sort((a, b) => a.chapterNumber - b.chapterNumber)
  };
})(globalThis);
