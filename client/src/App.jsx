import { useState, useEffect, useRef } from "react";

// ─── Trello MIME → friendly category ────────────────────────────────────────
const FILE_TYPES = {
  Images:        ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
  PDFs:          ["application/pdf"],
  Documents:     ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
  Videos:        ["video/mp4", "video/quicktime", "video/webm"],
  "ZIP files":   ["application/zip", "application/x-zip-compressed"],
  Spreadsheets:  ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  "Design files":["application/octet-stream"],
};

const TYPE_ICONS = {
  Images: "🖼️", PDFs: "📄", Documents: "📝",
  Videos: "🎬", "ZIP files": "🗜️", Spreadsheets: "📊", "Design files": "🎨",
};

function getCategory(mimeType) {
  for (const [cat, types] of Object.entries(FILE_TYPES)) {
    if (types.some((t) => mimeType?.startsWith(t) || t === mimeType)) return cat;
  }
  return "Documents";
}

let jszipPromise = null;
function loadJSZip() {
  if (jszipPromise) return jszipPromise;
  jszipPromise = new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => resolve(window.JSZip);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return jszipPromise;
}

const TRELLO_BASE = "https://api.trello.com/1";
async function trelloFetch(path, key, token) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TRELLO_BASE}${path}${sep}key=${key}&token=${token}`);
  if (!res.ok) throw new Error(`Trello API error ${res.status}: ${path}`);
  return res.json();
}

async function fetchBoardAttachments(boardId, key, token) {
  const [lists, cards] = await Promise.all([
    trelloFetch(`/boards/${boardId}/lists?fields=id,name`, key, token),
    trelloFetch(`/boards/${boardId}/cards?attachments=true&attachment_fields=id,name,url,bytes,mimeType&fields=id,name,idList`, key, token),
  ]);
  const listMap = Object.fromEntries(lists.map((l) => [l.id, l.name]));
  const attachments = [];
  for (const card of cards) {
    if (!card.attachments?.length) continue;
    for (const att of card.attachments) {
      attachments.push({ ...att, cardName: card.name, listName: listMap[card.idList] || "Unknown List", listId: card.idList });
    }
  }
  return { attachments, lists };
}

// ─── Toggle component ────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange }) {
  return (
    <label style={s.toggleRow}>
      <span style={{ fontSize: 13, color: checked ? "#e2e8f0" : "#64748b", transition: "color 0.2s" }}>
        {label}
      </span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          ...s.toggleTrack,
          background: checked ? "#23B5B5" : "rgba(255,255,255,0.08)",
          borderColor: checked ? "#23B5B5" : "rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ ...s.toggleThumb, transform: checked ? "translateX(16px)" : "translateX(0px)" }} />
      </div>
    </label>
  );
}

// ─── File type breakdown pill ─────────────────────────────────────────────────
function TypePill({ icon, label, count }) {
  if (count === 0) return null;
  return (
    <div style={s.typePill}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 700, color: "#23B5B5",
        background: "rgba(35,181,181,0.12)",
        borderRadius: 5, padding: "1px 6px",
      }}>{count}</span>
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuthorize, loading }) {
  return (
    <div style={s.page}>
      <div style={s.modal}>
        <div style={s.headerBar}>
          <div style={s.headerLeft}>
            <div style={s.iconBox}>⬇</div>
            <span style={s.headerTitle}>Downloader</span>
          </div>
        </div>
        <div style={s.topAccent} />
        <div style={s.body}>
          <h2 style={{ fontSize: 20, marginBottom: 10, fontWeight: 700, color: "#f1f5f9" }}>Authorization</h2>
          <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7, margin: "0 0 6px" }}>
            We need your authorization to read this board's attachments.
          </p>
          <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.7, margin: 0 }}>
            Only read access is requested. No data is sent to any third-party server.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button style={{ ...s.downloadBtn, padding: "11px 28px", cursor: "pointer" }} onClick={onAuthorize} disabled={loading}>
              {loading ? "Authorizing…" : "⬇ Authorize"}
            </button>
            <button style={s.cancelBtn} onClick={() => window.close?.()}>Cancel</button>
          </div>
          <p style={{ color: "#334155", fontSize: 11, marginTop: 14 }}>
            By authorizing you agree to our Terms of Service.
          </p>
        </div>
        <div style={s.bottomAccent} />
      </div>
    </div>
  );
}

// ─── Downloader Screen ────────────────────────────────────────────────────────
function DownloaderScreen({ attachments, token }) {
  const [selectedTypes, setSelectedTypes] = useState(
    Object.keys(FILE_TYPES).reduce((a, k) => ({ ...a, [k]: true }), {})
  );
  const [splitByList, setSplitByList]       = useState(false);
  const [splitByCard, setSplitByCard]       = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [showFilters, setShowFilters]       = useState(false);
  const [downloading, setDownloading]       = useState(false);
  const [progress, setProgress]             = useState(0);
  const [error, setError]                   = useState(null);
  const abortRef = useRef(null);

  const filtered   = attachments.filter((att) => selectedTypes[getCategory(att.mimeType)]);
  const totalBytes = filtered.reduce((s, a) => s + (a.bytes || 0), 0);
  const totalGB    = (totalBytes / 1e9).toFixed(2);

  // Count per type for the breakdown row
  const typeCounts = Object.keys(FILE_TYPES).reduce((acc, cat) => {
    acc[cat] = filtered.filter((a) => getCategory(a.mimeType) === cat).length;
    return acc;
  }, {});

  const toggleType = (type) => setSelectedTypes((prev) => ({ ...prev, [type]: !prev[type] }));

  const handleDownload = async () => {
    if (filtered.length === 0) { setError("No attachments match the current filters."); return; }
    setError(null); setProgress(0); setDownloading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const JSZip = await loadJSZip();
      const zip   = new JSZip();
      const safe  = (name) => (name || "file").replace(/[/\\?%*:|"<>\x00]/g, "_").slice(0, 200);
      let done = 0;
      await Promise.all(filtered.map(async (att) => {
        let folder = "";
        if (splitByList) folder = safe(att.listName) + "/";
        if (splitByCard) folder += safe(att.cardName) + "/";
        const proxyUrl = `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}`;
        const res = await fetch(proxyUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch ${att.name}`);
        const blob = await res.blob();
        const filename = folder + safe(att.name || att.id);
        if (skipDuplicates && zip.files[filename]) { done++; setProgress(Math.round((done / filtered.length) * 90)); return; }
        zip.file(filename, blob);
        done++;
        setProgress(Math.round((done / filtered.length) * 90));
      }));
      setProgress(95);
      const content = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
        ({ percent }) => setProgress(95 + Math.round(percent * 0.05))
      );
      setProgress(100);
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url; a.download = "trello-attachments.zip";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err.name !== "AbortError") { console.error("Download failed:", err); setError("Download failed: " + err.message); }
    } finally {
      setDownloading(false); abortRef.current = null;
    }
  };

  const handleCancel = () => { abortRef.current?.abort(); setDownloading(false); setProgress(0); };

  return (
    <div style={s.page}>
      <div style={s.modal}>

        {/* ── Header ── */}
        <div style={s.headerBar}>
          <div style={s.headerLeft}>
            <div style={s.iconBox}>⬇</div>
            <span style={s.headerTitle}>Downloader</span>
          </div>
        </div>

        {/* ── Top teal accent border ── */}
        <div style={s.topAccent} />

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Count + filter */}
          <div style={{ marginBottom: 14 }}>
            <p style={s.superLabel}>You are about to download</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2 }}>
                {filtered.length} attachments{" "}
                <span style={{ color: "#23B5B5", fontWeight: 700 }}>({totalGB} GB)</span>
              </div>
              <button style={s.filterBtn} onClick={() => setShowFilters(!showFilters)}>
                {showFilters ? "▲" : "▼"} Filters
              </button>
            </div>
          </div>

          {/* ── File type breakdown ── */}
          <div style={s.breakdownRow}>
            {Object.entries(typeCounts).map(([cat, count]) =>
              <TypePill key={cat} icon={TYPE_ICONS[cat]} label={cat} count={count} />
            )}
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div style={s.filterPanel}>
              {Object.keys(FILE_TYPES).map((type) => (
                <label key={type} style={s.filterRow}>
                  <input type="checkbox" checked={!!selectedTypes[type]} onChange={() => toggleType(type)} style={{ accentColor: "#23B5B5", margin: 0 }} />
                  <span style={{ marginLeft: 8, fontSize: 13, color: "#cbd5e1" }}>{TYPE_ICONS[type]} {type}</span>
                </label>
              ))}
            </div>
          )}

          {/* ── Toggles ── */}
          <div style={s.toggleGroup}>
            <Toggle label="Split into list folders" checked={splitByList}    onChange={setSplitByList} />
            <Toggle label="Split into card folders" checked={splitByCard}    onChange={setSplitByCard} />
            <Toggle label="Skip duplicate files"    checked={skipDuplicates} onChange={setSkipDuplicates} />
          </div>

          {/* ── Format + size ── */}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <div style={s.formatBox}>
              <span style={{ fontSize: 16 }}>📦</span>
              <span style={{ fontSize: 13, color: "#e2e8f0" }}>ZIP File (.zip)</span>
            </div>
            <div style={s.sizeBox}>
              <div style={s.sizeLabel}>Estimated size</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}>{totalGB} GB · {filtered.length} files</div>
            </div>
          </div>

          {/* Error */}
          {error && <div style={s.errorBox}>⚠ {error}</div>}

          {/* Progress */}
          {downloading && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Downloading…</span>
                <span style={{ fontSize: 11, color: "#23B5B5", fontWeight: 700 }}>{progress}%</span>
              </div>
              <div style={s.progressWrap}>
                <div style={{ ...s.progressBar, width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom teal accent border ── */}
        <div style={s.bottomAccent} />

        {/* ── Action buttons (outside body, pinned to bottom) ── */}
        <div style={s.footer}>
          <button
            style={{
              ...s.downloadBtn,
              flex: 1,
              opacity: downloading || filtered.length === 0 ? 0.55 : 1,
              cursor: downloading || filtered.length === 0 ? "not-allowed" : "pointer",
            }}
            onClick={handleDownload}
            disabled={downloading || filtered.length === 0}
          >
            {downloading ? `⏳ Downloading… ${progress}%` : "⬇ Start download"}
          </button>
          {downloading && (
            <button style={s.cancelBtn} onClick={handleCancel}>Cancel</button>
          )}
        </div>

      </div>
      <style>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  const [authorized, setAuthorized]   = useState(false);
  const [loading, setLoading]         = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [token, setToken]             = useState(null);
  const [initLoading, setInitLoading] = useState(true);
  const tRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const trello = window.TrelloPowerUp?.iframe({ appKey: import.meta.env.VITE_TRELLO_API_KEY, appName: "Downloader" });
        if (!trello) { setAuthorized(true); setInitLoading(false); return; }
        tRef.current = trello;
        const isAuth = await trello.getRestApi().isAuthorized();
        if (isAuth) { setAuthorized(true); await loadAttachments(trello); }
        else { setAuthorized(false); }
      } catch (err) {
        console.error("[Downloader] useEffect error:", err);
        setAuthorized(false);
      } finally {
        setInitLoading(false);
      }
    })();
  }, []);

  const loadAttachments = async (trello) => {
    try {
      const key = import.meta.env.VITE_TRELLO_API_KEY;
      const tok = await trello.getRestApi().getToken();
      setToken(tok);
      const board = await trello.board("id");
      const { attachments: atts } = await fetchBoardAttachments(board.id, key, tok);
      setAttachments(atts);
    } catch (err) {
      console.error("[Downloader] Failed:", err.message, err);
    }
  };

  const handleAuthorize = async () => {
    setLoading(true);
    try {
      await tRef.current.getRestApi().authorize({ scope: "read" });
      setAuthorized(true);
      await loadAttachments(tRef.current);
    } catch (err) {
      console.error("Authorization failed:", err);
    }
    setLoading(false);
  };

  if (initLoading) {
    return (
      <div style={{ background: "#0d1829", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        <div style={{ background: "linear-gradient(135deg, #23B5B5, #1a8f8f)", width: 52, height: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 14, boxShadow: "0 0 0 1px rgba(35,181,181,0.3)" }}>⬇</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#f1f5f9", marginBottom: 6 }}>Downloader</div>
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 20 }}>Fetching your attachments…</div>
        <div style={{ width: 180, height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "#23B5B5", borderRadius: 4, animation: "slide 1.2s infinite ease-in-out" }} />
        </div>
        <style>{`@keyframes slide { 0%{transform:translateX(-200%)} 100%{transform:translateX(600%)} }`}</style>
      </div>
    );
  }

  if (!authorized) return <AuthScreen onAuthorize={handleAuthorize} loading={loading} />;
  return <DownloaderScreen attachments={attachments} token={token} />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
  page: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0d1829",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  modal: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },

  // ── Header ──
  headerBar: {
    display: "flex",
    alignItems: "center",
    padding: "13px 20px",
    background: "#0a1120",
    flexShrink: 0,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  iconBox: {
    background: "linear-gradient(135deg, #23B5B5, #1a8f8f)",
    borderRadius: 9, width: 30, height: 30,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, boxShadow: "0 0 0 1px rgba(35,181,181,0.25)",
  },
  headerTitle: { fontWeight: 700, fontSize: 14, color: "#f1f5f9", letterSpacing: "0.01em" },

  // ── Accent borders ──
  topAccent: {
    height: 2,
    background: "linear-gradient(90deg, #23B5B5, #38bdf8, transparent)",
    flexShrink: 0,
  },
  bottomAccent: {
    height: 2,
    background: "linear-gradient(90deg, #23B5B5, #38bdf8, transparent)",
    flexShrink: 0,
  },

  // ── Body ──
  body: { padding: "16px 20px 12px", flex: 1 },

  superLabel: {
    fontSize: 11, color: "#475569", margin: "0 0 4px",
    letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600,
  },

  // ── File type breakdown ──
  breakdownRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 14,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
  },
  typePill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 7,
    padding: "4px 8px",
  },

  // ── Filter ──
  filterBtn: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#64748b", padding: "5px 10px",
    borderRadius: 7, cursor: "pointer",
    fontSize: 11, fontWeight: 600,
  },
  filterPanel: {
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10, padding: "2px 12px", marginBottom: 12,
  },
  filterRow: {
    display: "flex", alignItems: "center",
    padding: "7px 0", cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },

  // ── Toggles ──
  toggleGroup: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10, overflow: "hidden",
  },
  toggleRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    padding: "9px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    cursor: "pointer",
  },
  toggleTrack: {
    width: 32, height: 18, borderRadius: 9,
    border: "1px solid", position: "relative",
    cursor: "pointer", transition: "background 0.2s, border-color 0.2s",
    flexShrink: 0,
  },
  toggleThumb: {
    position: "absolute", top: 2, left: 2,
    width: 12, height: 12, borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.2s cubic-bezier(.4,0,.2,1)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  },

  // ── Format + size ──
  formatBox: {
    flex: 1, background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 9, padding: "10px 14px",
    display: "flex", alignItems: "center", gap: 10,
  },
  sizeBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 9, padding: "10px 14px", minWidth: 148,
  },
  sizeLabel: {
    fontSize: 10, color: "#475569",
    textTransform: "uppercase", letterSpacing: "0.05em",
    fontWeight: 600, marginBottom: 2,
  },

  // ── Error ──
  errorBox: {
    marginTop: 12,
    background: "rgba(248,113,113,0.07)",
    border: "1px solid rgba(248,113,113,0.18)",
    borderRadius: 8, padding: "8px 12px",
    fontSize: 12, color: "#fca5a5",
  },

  // ── Progress ──
  progressWrap: {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 6, height: 5, overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "linear-gradient(90deg, #23B5B5, #38bdf8)",
    borderRadius: 6, transition: "width 0.25s ease",
  },

  // ── Footer (button area) ──
  // In the styles object, change footer:
footer: {
  display: "flex", gap: 8,
  padding: "14px 20px 18px",
  background: "#303134",   // ← matches Trello's top modal bar exactly
  flexShrink: 0,
},

  // ── Buttons ──
  downloadBtn: {
    background: "linear-gradient(135deg, #23B5B5, #1a9f9f)",
    color: "#fff", border: "none", borderRadius: 9,
    padding: "12px 0", fontSize: 14, fontWeight: 700,
    letterSpacing: "0.01em",
    boxShadow: "0 0 0 1px rgba(35,181,181,0.2), 0 4px 14px rgba(35,181,181,0.18)",
    transition: "opacity 0.15s",
  },
  cancelBtn: {
    background: "rgba(255,255,255,0.04)",
    color: "#64748b",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 9, padding: "10px 18px",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
};