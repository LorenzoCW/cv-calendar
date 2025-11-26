import React, { useEffect, useRef, useState } from "react";

// Infinite-calendar-app (updated)
// Now: shows only the LAST 7 days (newest on the LEFT, older to the RIGHT),
// but still persists and keeps items for all dates in localStorage.
// Drop this file in src/App.tsx.

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

export default function App() {
  const today = new Date();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // visibleDates: newest (today) on the left, older to the right
  const [visibleDates, setVisibleDates] = useState<string[]>(() => {
    const arr: string[] = [];
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const d = makeDateBefore(today, i);
      arr.push(formatDateKey(d));
    }
    return arr;
  });

  // itemsMap persists all items for all dates (not limited to visibleDates)
  const [itemsMap, setItemsMap] = useState<Record<string, { id: string; title: string; link: string }[]>>(() => {
    try {
      const raw = localStorage.getItem("infinite-calendar-items-v1");
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("infinite-calendar-items-v1", JSON.stringify(itemsMap));
  }, [itemsMap]);

  function addItem(dateKey: string, title: string, link: string) {
    setItemsMap((prev) => {
      const arr = prev[dateKey] ? [...prev[dateKey]] : [];
      arr.push({ id: Math.random().toString(36).slice(2), title, link });
      return { ...prev, [dateKey]: arr };
    });
  }

  function removeItem(dateKey: string, id: string) {
    setItemsMap((prev) => {
      const arr = (prev[dateKey] || []).filter((it) => it.id !== id);
      return { ...prev, [dateKey]: arr };
    });
  }

  return (
    <div style={{ padding: 16, height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <h1 style={{ margin: "0 0 12px 0" }}>Calendário — últimos {VISIBLE_DAYS} dias (novos à esquerda)</h1>
      <div style={{ marginBottom: 8 }}>Apenas os últimos {VISIBLE_DAYS} dias são mostrados, mas todos os dados são salvos localmente.</div>

      <div
        ref={containerRef}
        className="hc-container"
        style={{ overflowX: "auto", whiteSpace: "nowrap", flex: 1, border: "1px solid #ddd", padding: 12 }}
      >
        {/* newest (today) at index 0 -> rendered first (left) */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-evenly" }}>
          {visibleDates.map((dateKey) => {
            const items = itemsMap[dateKey] || [];
            const count = items.length;
            return (
              <div key={dateKey} className="day-column" style={{ minWidth: 230, background: "#fafafa", borderRadius: 8, padding: 10 }}>
                <div className="day-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{dayLabel(new Date(dateKey + "T00:00:00"))}</div>
                  <div style={{ fontWeight: 700 }}>{count}/5 {count >= 5 ? "✅" : ""}</div>
                </div>

                <div style={{ minHeight: 80 }}>
                  {items.map((it) => (
                    <div key={it.id} style={{ padding: 8, border: "1px solid #eee", borderRadius: 6, marginBottom: 8, background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 600 }}>{it.title}</div>
                        <button onClick={() => removeItem(dateKey, it.id)} title="Remover" style={{ border: "none", background: "transparent", cursor: "pointer" }}>✖</button>
                      </div>
                      {it.link ? (
                        <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, textDecoration: "underline" }}>{it.link}</a>
                      ) : null}
                    </div>
                  ))}
                </div>

                <AddItemForm dateKey={dateKey} onAdd={addItem} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>Dados salvos localmente no seu navegador (localStorage). Objetos para outras datas permanecem no armazenamento mesmo quando não exibidos.</div>
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