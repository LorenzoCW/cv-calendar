import React, { useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VISIBLE_DAYS = 7;

function formatDateKey(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

function makeDateBefore(base: Date, daysBefore: number) {
  return new Date(base.getTime() - daysBefore * MS_PER_DAY);
}

function initFirebase() {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  } as any;

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.warn("Firebase config variables are missing. Firestore operations will fail until you set VITE_FIREBASE_... env vars.");
    return null;
  }

  const win = window as any;
  if (!win.___firebase_app_initialized) {
    try {
      initializeApp(firebaseConfig);
      win.___firebase_app_initialized = true;
    } catch (e) {
      console.warn("Firebase init error:", e);
      return null;
    }
  }

  try {
    return getFirestore();
  } catch (e) {
    console.warn("getFirestore() failed:", e);
    return null;
  }
}

// Helper to read raw localStorage items
function readLocalStorageItems() {
  try {
    const raw = localStorage.getItem("infinite-calendar-items-v1");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export default function App() {
  const today = new Date();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [visibleDates, setVisibleDates] = useState<string[]>(() => {
    const arr: string[] = [];
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const d = makeDateBefore(today, i);
      arr.push(formatDateKey(d));
    }
    return arr;
  });

  // itemsMap stores arrays of items with optional `pending` boolean
  const [itemsMap, setItemsMap] = useState<Record<string, { id: string; title: string; link: string; createdAtMs: number; pending?: boolean }[]>>(() => {
    const raw = readLocalStorageItems();
    // mark local-only items (ids starting with 'local-') as pending
    const mapped: Record<string, any[]> = {};
    for (const dk of Object.keys(raw)) {
      mapped[dk] = (raw[dk] || []).map((it: any) => ({
        id: it.id || "local-" + Math.random().toString(36).slice(2),
        title: it.title || "",
        link: it.link || "",
        createdAtMs: it.createdAtMs || Date.now(),
        pending: typeof it.id === "string" && it.id.startsWith("local-"),
      }));
    }
    return mapped;
  });

  const [db, setDb] = useState<any | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    const firestore = initFirebase();
    setDb(firestore);
  }, []);

  // Fetch visible dates from Firestore and merge
  useEffect(() => {
    if (!db) return;

    async function fetchVisibleDays() {
      try {
        const q = query(
          collection(db, "items"),
          where("dateKey", "in", visibleDates),
          orderBy("createdAtMs", "asc")
        );

        const snap = await getDocs(q);
        const fromServer: Record<string, { id: string; title: string; link: string; createdAtMs: number }[]> = {};
        snap.forEach((doc) => {
          const data: any = doc.data();
          const dateKey = data.dateKey || formatDateKey(new Date((data.createdAtMs) || Date.now()));
          const rec = {
            id: doc.id,
            title: data.title || "",
            link: data.link || "",
            createdAtMs: typeof data.createdAtMs === "number" ? data.createdAtMs : Date.now(),
          };
          fromServer[dateKey] = fromServer[dateKey] || [];
          fromServer[dateKey].push(rec);
        });

        setItemsMap((prev) => {
          const newMap = { ...prev };
          for (const dk of visibleDates) {
            // start with any local items for dk
            const localArr = (newMap[dk] || []).filter((i: any) => !(i.id && !i.id.startsWith("local-")) || i.id.startsWith("local-"));
            const serverArr = fromServer[dk] || [];

            // Remove local optimistic duplicates if server has same createdAtMs + title (best-effort)
            const serverKeys = new Set(serverArr.map((s) => `${s.title}::${s.createdAtMs}`));
            const filteredLocal = localArr.filter((l: any) => !serverKeys.has(`${l.title}::${l.createdAtMs}`));

            // mark server items as not pending
            const normalizedServer = serverArr.map((s) => ({ ...s, pending: false }));

            // merge: server items (trusted) first, then leftover local pending items — already ordered by createdAtMs
            const merged = [...normalizedServer, ...filteredLocal];
            merged.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

            newMap[dk] = merged;
          }

          return newMap;
        });
      } catch (e) {
        console.warn("Error fetching items for visible days:", e);
      }
    }

    fetchVisibleDays();
  }, [db, visibleDates]);

  // persist local copy whenever itemsMap changes
  useEffect(() => {
    try {
      // Only persist the shape { dateKey: [ {id,title,link,createdAtMs} ] }
      const toSave: Record<string, any[]> = {};
      for (const dk of Object.keys(itemsMap)) {
        toSave[dk] = itemsMap[dk].map((it) => ({ id: it.id, title: it.title, link: it.link, createdAtMs: it.createdAtMs }));
      }
      localStorage.setItem("infinite-calendar-items-v1", JSON.stringify(toSave));
    } catch (e) {
      console.warn("Failed to save to localStorage:", e);
    }
  }, [itemsMap]);

  async function addItem(dateKey: string, title: string, link: string) {
    const createdAtMs = Date.now();
    const localId = "local-" + Math.random().toString(36).slice(2);
    const localRec = { id: localId, title, link, createdAtMs, pending: true };

    setItemsMap((prev) => {
      const arr = prev[dateKey] ? [...prev[dateKey]] : [];
      arr.push(localRec);
      arr.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      return { ...prev, [dateKey]: arr };
    });

    if (!db) return;

    try {
      const docRef = await addDoc(collection(db, "items"), {
        title,
        link,
        dateKey,
        createdAtMs,
        createdAtServer: serverTimestamp(),
      });

      // replace local optimistic id with server id and clear pending flag
      setItemsMap((prev) => {
        const arr = (prev[dateKey] || []).map((it) => (it.id === localId ? { ...it, id: docRef.id, pending: false } : it));
        return { ...prev, [dateKey]: arr };
      });
    } catch (e) {
      console.warn("Failed to add item to Firestore:", e);
      // keep local item with pending: true so user sees it's not yet in server
    }
  }

  function removeItem(dateKey: string, id: string) {
    setItemsMap((prev) => {
      const arr = (prev[dateKey] || []).filter((it) => it.id !== id);
      return { ...prev, [dateKey]: arr };
    });
  }

  // helper to create a debug JSON string of raw localStorage data
  function debugLocalStorageJSON() {
    const raw = localStorage.getItem("infinite-calendar-items-v1");
    try {
      return raw ? JSON.stringify(JSON.parse(raw), null, 2) : "{}";
    } catch (e) {
      return raw || "{}";
    }
  }

  return (
    <div style={{ padding: 16, height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: "0 0 12px 0" }}>Calendário — últimos {VISIBLE_DAYS} dias (novos à esquerda)</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowDebug((s) => !s)} style={{ padding: "6px 10px" }}>Debug: localStorage</button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        Itens salvos localmente que ainda não foram confirmados no Firestore aparecem com ⏳. Esta verificação acontece sempre que a página carrega.
      </div>

      {showDebug ? (
        <div style={{ marginBottom: 8 }}>
          <h3>LocalStorage (raw)</h3>
          <pre style={{ background: "#111", color: "#e6e6e6", padding: 12, borderRadius: 8, maxHeight: 200, overflow: "auto" }}>{debugLocalStorageJSON()}</pre>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="hc-container"
        style={{ overflowX: "auto", whiteSpace: "nowrap", flex: 1, border: "1px solid #ddd", padding: 12 }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-evenly" }}>
          {visibleDates.map((dateKey) => {
            const items = itemsMap[dateKey] || [];
            const count = items.length;
            return (
              <div key={dateKey} className="day-column" style={{ minWidth: 235, background: "#fafafa", borderRadius: 8, padding: 10 }}>
                <div className="day-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{dayLabel(new Date(dateKey + "T00:00:00"))}</div>
                  <div style={{ fontWeight: 700 }}>{count}/5 {count >= 5 ? "✅" : ""}</div>
                </div>

                <div style={{ minHeight: 80 }}>
                  {items.map((it) => (
                    <div key={it.id} style={{ padding: 8, border: "1px solid #eee", borderRadius: 6, marginBottom: 8, background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ fontWeight: 600 }}>{it.title}</div>
                          {it.pending ? <span title="Aguardando upload para Firestore">⏳</span> : null}
                        </div>
                        <button onClick={() => removeItem(dateKey, it.id)} title="Remover" style={{ border: "none", background: "transparent", cursor: "pointer" }}>✖</button>
                      </div>
                      {it.link ? (
                        <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, textDecoration: "underline" }}>{it.link}</a>
                      ) : null}
                      <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>{new Date(it.createdAtMs).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>

                <AddItemForm dateKey={dateKey} onAdd={addItem} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>Dados salvos localmente no seu navegador (localStorage) e enviados ao Firestore (se configurado).</div>
    </div>
  );
}

function AddItemForm({ dateKey, onAdd }: { dateKey: string; onAdd: (dateKey: string, title: string, link: string) => void }) {
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");

  function submit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!title.trim()) return;
    onAdd(dateKey, title.trim(), link.trim());
    setTitle("");
    setLink("");
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      <input
        placeholder="Título"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 6, boxSizing: "border-box", display: "flex" }}
      />
      <input
        placeholder="Link (opcional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 6, boxSizing: "border-box", display: "flex" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={{ flex: 1, padding: 8 }}>Adicionar</button>
      </div>
    </form>
  );
}