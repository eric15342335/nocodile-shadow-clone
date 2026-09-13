import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
test("IndexedDB harness supports committed records after close and reopen", async () => {
  const indexedDB = new IDBFactory();
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("nocodile-test", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("samples");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("samples", "readwrite");
    tx.objectStore("samples").put({ clip: "fixture", values: [0, 1] }, "test");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const reopened = await open();
  const value = await new Promise((resolve, reject) => {
    const request = reopened.transaction("samples").objectStore("samples").get("test");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(value).toEqual({ clip: "fixture", values: [0, 1] });
  reopened.close();
});
