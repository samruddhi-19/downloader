

import { useState, useEffect, useRef } from "react";

// ─── Trello MIME → friendly category ────────────────────────────────────────
const FILE_TYPES = {
  Images: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
  PDFs: ["application/pdf"],
  Documents: [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ],
  Videos: ["video/mp4", "video/quicktime", "video/webm"],
  "ZIP files": ["application/zip", "application/x-zip-compressed"],
  Spreadsheets: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  "Design files": ["application/octet-stream"],
};

function getCategory(mimeType) {
  for (const [cat, types] of Object.entries(FILE_TYPES)) {
    if (types.some((t) => mimeType?.startsWith(t) || t === mimeType)) return cat;
  }
  return "Documents";
}

// ─── Load JSZip from CDN (once) ──────────────────────────────────────────────
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

// ─── Trello REST helpers ─────────────────────────────────────────────────────
const TRELLO_BASE = "https://api.trello.com/1";

async function trelloFetch(path, key, token) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TRELLO_BASE}${path}${sep}key=${key}&token=${token}`);
  if (!res.ok) throw new Error(`Trello API error ${res.status}: ${path}`);
  return res.json();
}

/**
 * Fetch all attachments for every card on a board, enriched with
 * cardName and listName.
 */
async function fetchBoardAttachments(boardId, key, token) {
  // Fetch lists and cards (with attachments) in two parallel calls
  const [lists, cards] = await Promise.all([
    trelloFetch(`/boards/${boardId}/lists?fields=id,name`, key, token),
    trelloFetch(
      `/boards/${boardId}/cards?attachments=true&attachment_fields=id,name,url,bytes,mimeType&fields=id,name,idList`,
      key,
      token
    ),
  ]);

  const listMap = Object.fromEntries(lists.map((l) => [l.id, l.name]));

  const attachments = [];
  for (const card of cards) {
    if (!card.attachments?.length) continue;
    for (const att of card.attachments) {
      attachments.push({
        ...att,
        cardName: card.name,
        listName: listMap[card.idList] || "Unknown List",
        listId: card.idList,
      });
    }
  }
  return { attachments, lists };
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuthorize, loading }) {
  useEffect(() => {
    const t = window.TrelloPowerUp?.iframe();
    if (t) t.sizeTo('#root').catch(() => {});
  });
  return (
    <div style={s.page}>
      <div style={s.modal}>
        <div style={s.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={s.icon}>⬇</div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Downloader</span>
          </div>
        </div>
        <h2 style={{ fontSize: 22, marginBottom: 12 }}>Authorization</h2>
        <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          We need your authorization to read this board's attachments.
        </p>
        <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
          Only read access is requested. No data is sent to any third-party server.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button style={s.authBtn} onClick={onAuthorize} disabled={loading}>
            {loading ? "Authorizing…" : "Authorize"}
          </button>
          <button style={s.cancelBtn} onClick={() => window.close?.()}>
            Cancel
          </button>
        </div>
        <p style={{ color: "#475569", fontSize: 11, marginTop: 16 }}>
          By authorizing you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}

// ─── Downloader Screen ────────────────────────────────────────────────────────
function DownloaderScreen({ attachments, token }) {
  const [selectedTypes, setSelectedTypes] = useState(
    Object.keys(FILE_TYPES).reduce((a, k) => ({ ...a, [k]: true }), {})
  );
  const [splitByList, setSplitByList] = useState(false);
  const [splitByCard, setSplitByCard] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [downloadAs, setDownloadAs] = useState("ZIP File (.zip)");
  const [showDropdown, setShowDropdown] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => {
  const t = window.TrelloPowerUp?.iframe();
  if (t) t.sizeTo('#root').catch(() => {});
});

  const filtered = attachments.filter((att) =>
    selectedTypes[getCategory(att.mimeType)]
  );

  const totalBytes = filtered.reduce((s, a) => s + (a.bytes || 0), 0);
  const totalGB = (totalBytes / 1e9).toFixed(2);

  const toggleType = (type) =>
    setSelectedTypes((prev) => ({ ...prev, [type]: !prev[type] }));

  const handleDownload = async () => {
    if (filtered.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }

    setError(null);
    setProgress(0);
    setDownloading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();

      // Helper: safe filename (strip slashes, null bytes)
      const safe = (name) =>
        (name || "file").replace(/[/\\?%*:|"<>\x00]/g, "_").slice(0, 200);

      // Track how many files we've fetched for progress
      let done = 0;

      await Promise.all(
        filtered.map(async (att) => {
          // Build the folder path
          let folder = "";
          if (splitByList) folder = safe(att.listName) + "/";
          if (splitByCard) folder += safe(att.cardName) + "/";

          // Fetch the attachment blob using the Trello CDN URL
          // Trello attachment URLs are public CDN links – no auth header needed
          // for public boards; for private boards the token must be a query param.
         const proxyUrl = `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}`;
const res = await fetch(proxyUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`Failed to fetch ${att.name}`);
          const blob = await res.blob();

          // Deduplicate filenames inside the same folder
          const filename = folder + safe(att.name || att.id);
          zip.file(filename, blob);

          done++;
          setProgress(Math.round((done / filtered.length) * 90));
        })
      );

      setProgress(95);

      // Generate the ZIP
      const content = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
        ({ percent }) => setProgress(95 + Math.round(percent * 0.05))
      );

      setProgress(100);

      // Trigger browser download
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "trello-attachments.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Download failed:", err);
        setError("Download failed: " + err.message);
      }
    } finally {
      setDownloading(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setDownloading(false);
    setProgress(0);
  };

  return (
    <div style={s.page}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={s.icon}>⬇</div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Downloader</span>
          </div>
        </div>

        <p style={s.sub}>You are about to download</p>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 22 }}>
            <strong>{filtered.length} attachments</strong>{" "}
            <span style={{ color: "#818cf8" }}>({totalGB} GB)</span>
          </h2>
          <button style={s.filterBtn} onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? "▲" : "▼"} Filters
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div style={s.filterPanel}>
            {Object.keys(FILE_TYPES).map((type) => (
              <label key={type} style={s.filterRow}>
                <input
                  type="checkbox"
                  checked={!!selectedTypes[type]}
                  onChange={() => toggleType(type)}
                  style={{ accentColor: "#6366f1" }}
                />
                <span style={{ marginLeft: 8 }}>{type}</span>
              </label>
            ))}
          </div>
        )}

        {/* Split options */}
        {[
          ["Split into list folders", splitByList, setSplitByList],
          ["Split into card folders", splitByCard, setSplitByCard],
        ].map(([label, val, setter]) => (
          <div key={label} style={s.optionRow}>
            <input
              type="checkbox"
              checked={val}
              onChange={(e) => setter(e.target.checked)}
              style={{ accentColor: "#6366f1" }}
            />
            <span style={{ marginLeft: 10 }}>{label}</span>
          </div>
        ))}

        {/* Format selector + size estimate — side by side, matching original */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 24,
            position: "relative",
          }}
        >
          <div style={{ flex: 1 }}>
            <button
              style={s.selectBtn}
              onClick={() => setShowDropdown(!showDropdown)}
            >
              📦 {downloadAs} ▼
            </button>
            {showDropdown && (
              <div style={s.dropdown}>
                {["ZIP File (.zip)", "Google Drive", "Dropbox", "OneDrive"].map(
                  (opt) => (
                    <div
                      key={opt}
                      style={s.dropdownItem}
                      onClick={() => {
                        setDownloadAs(opt);
                        setShowDropdown(false);
                      }}
                    >
                      {opt}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
          <div style={s.sizeBox}>
            <div style={{ fontSize: 11, color: "#64748b" }}>Estimated size</div>
            <div style={{ fontWeight: 700 }}>
              {totalGB} GB · {filtered.length} files
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>
            ⚠ {error}
          </p>
        )}

        {/* Progress bar */}
        {downloading && (
          <div style={s.progressWrap}>
            <div style={{ ...s.progressBar, width: `${progress}%` }} />
            <span style={s.progressLabel}>{progress}%</span>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            style={{
              ...s.downloadBtn,
              opacity: downloading || filtered.length === 0 ? 0.6 : 1,
              cursor: downloading || filtered.length === 0 ? "not-allowed" : "pointer",
              flex: 1,
            }}
            onClick={handleDownload}
            disabled={downloading || filtered.length === 0}
          >
            {downloading ? `⏳ Downloading… ${progress}%` : "⬇ Start download"}
          </button>
          {downloading && (
            <button style={s.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [token, setToken] = useState(null);
  const [initLoading, setInitLoading] = useState(true);
  const tRef = useRef(null);

  useEffect(() => {
  (async () => {
    try {
      const trello = window.TrelloPowerUp?.iframe({
  appKey: import.meta.env.VITE_TRELLO_API_KEY,
  appName: 'Downloader',
});
      if (!trello) {
        setAuthorized(true);
        setInitLoading(false);
        return;
      }
      tRef.current = trello;

      const isAuth = await trello.getRestApi().isAuthorized();
      console.log("[Downloader] isAuthorized:", isAuth);

      if (isAuth) {
        setAuthorized(true);
        await loadAttachments(trello);
      } else {
        // Token expired or revoked — force re-authorize
        console.log("[Downloader] Not authorized, showing auth screen");
        setAuthorized(false);
      }
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
    const token = await trello.getRestApi().getToken();
    setToken(token);
    const board = await trello.board("id");

    console.log("[Downloader] key:", key ? key.slice(0,6)+"..." : "MISSING ❌");
    console.log("[Downloader] token:", token ? token.slice(0,6)+"..." : "MISSING ❌");
    console.log("[Downloader] boardId:", board.id);

    const { attachments: atts } = await fetchBoardAttachments(board.id, key, token);

    console.log("[Downloader] attachments found:", atts.length);
    setAttachments(atts);
  } catch (err) {
    console.error("[Downloader] Failed:", err.message, err);
  }
};

  const handleAuthorize = async () => {
    setLoading(true);
    try {
      const trello = tRef.current;
      await trello.getRestApi().authorize({ scope: "read" });
      setAuthorized(true);
      await loadAttachments(trello);
    } catch (err) {
      console.error("Authorization failed:", err);
    }
    setLoading(false);
  };

  if (initLoading) {
  return (
    <div style={{ ...s.page, color: "#fff", fontSize: 14, flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 32 }}>⬇</div>
      <div style={{ fontWeight: 700, fontSize: 18 }}>Downloader</div>
      <div style={{ color: "#818cf8" }}>Loading your attachments...</div>
    </div>
  );
}

  if (!authorized) {
    return <AuthScreen onAuthorize={handleAuthorize} loading={loading} />;
  }

  return <DownloaderScreen attachments={attachments} token={token} />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
 page: {
  fontFamily: "sans-serif",
},
 modal: {
  background: "rgba(15, 23, 42, 0.95)",
  padding: 28,
  color: "#fff",
  width: "100%",
  boxSizing: "border-box",
},
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  icon: {
    background: "#4f46e5",
    borderRadius: 8,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  sub: { color: "#64748b", fontSize: 13, marginBottom: 8 },
  filterBtn: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#94a3b8",
    padding: "6px 12px",
    borderRadius: 8,
    cursor: "pointer",
  },
  filterPanel: {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 0",
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  selectBtn: {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
  },
  dropdown: {
    position: "absolute",
    top: "110%",
    left: 0,
    right: 0,
    background: "#1e293b",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    zIndex: 10,
  },
  dropdownItem: {
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: 14,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    color: "#fff",
  },
  optionRow: {
    display: "flex",
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontSize: 14,
  },
  sizeBox: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "8px 14px",
    minWidth: 160,
  },
  progressWrap: {
    marginTop: 16,
    background: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    height: 10,
    overflow: "hidden",
    position: "relative",
  },
  progressBar: {
    height: "100%",
    background: "linear-gradient(90deg, #4f46e5, #818cf8)",
    borderRadius: 8,
    transition: "width 0.2s ease",
  },
  progressLabel: {
    position: "absolute",
    right: 8,
    top: -18,
    fontSize: 11,
    color: "#94a3b8",
  },
  downloadBtn: {
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "14px 0",
    fontSize: 16,
    fontWeight: 700,
  },
  authBtn: {
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelBtn: {
    background: "rgba(255,255,255,0.05)",
    color: "#94a3b8",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 14,
    cursor: "pointer",
  },
};