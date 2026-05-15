import { useState, useEffect } from "react";

const FILE_TYPES = {
  Images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  PDFs: ["application/pdf"],
  Documents: ["application/msword", "text/plain"],
  Videos: ["video/mp4", "video/quicktime"],
  "ZIP files": ["application/zip"],
  Spreadsheets: ["application/vnd.ms-excel"],
  "Design files": ["application/octet-stream"],
};

// ── YOUR SERVER BASE URL ────────────────────────────────────────────────────
// Change this to your deployed server URL in production.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

function getCategory(mimeType) {
  for (const [cat, types] of Object.entries(FILE_TYPES)) {
    if (types.includes(mimeType)) return cat;
  }
  return "Documents";
}

// ── AUTH SCREEN ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuthorize, loading }) {
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
          We need your authorization for our Power-Up to work properly.
        </p>
        <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
          We may send you occasional product updates, Trello tips, and offers.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button style={s.authBtn} onClick={onAuthorize} disabled={loading}>
            {loading ? "Authorizing..." : "Authorize"}
          </button>
          <button style={s.cancelBtn}>Cancel</button>
        </div>
        <p style={{ color: "#475569", fontSize: 11, marginTop: 16 }}>
          By authorizing you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}

// ── DOWNLOADER SCREEN ────────────────────────────────────────────────────────
function DownloaderScreen({ attachments }) {
  const [selectedTypes, setSelectedTypes] = useState(
    Object.keys(FILE_TYPES).reduce((a, k) => ({ ...a, [k]: true }), {})
  );
  const [splitByList, setSplitByList] = useState(false);
  const [splitByCard, setSplitByCard] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [downloadAs, setDownloadAs] = useState("ZIP File (.zip)");
  const [showDropdown, setShowDropdown] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  // Filter attachments by selected file types
  const filtered = attachments.filter((att) =>
    selectedTypes[getCategory(att.mimeType)]
  );

  const totalGB = (
    filtered.reduce((sum, a) => sum + (a.bytes || 0), 0) / 1e9
  ).toFixed(1);

  const toggleType = (type) =>
    setSelectedTypes((prev) => ({ ...prev, [type]: !prev[type] }));

  // Determine folder mode from the two checkboxes
  // splitByList takes priority if both are checked
  const getFolderMode = () => {
    if (splitByList) return "list";
    if (splitByCard) return "card";
    return "none";
  };

  const handleDownload = async () => {
    if (filtered.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }

    setError(null);
    setDownloading(true);

    try {
      const folderMode = getFolderMode();

      const response = await fetch(`${SERVER_URL}/api/download/zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachments: filtered, // includes cardName, listName, url, name
          folderMode,            // "list" | "card" | "none"
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Stream the ZIP blob and trigger browser download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "trello-attachments.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
      setError("Download failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.modal}>
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
          <button
            style={s.filterBtn}
            onClick={() => setShowFilters(!showFilters)}
          >
            ▼ Filters
          </button>
        </div>

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

        {/* ── Split options ── */}
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

        {/* ── Format selector + size estimate ── */}
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
            {/* FIX: filtered.length used here so it updates with filters */}
            <div style={{ fontWeight: 700 }}>
              {totalGB} GB · {filtered.length} files
            </div>
          </div>
        </div>

        {error && (
          <p style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>
            ⚠ {error}
          </p>
        )}

        {/* FIX: onClick wired to handleDownload */}
        <button
          style={{
            ...s.downloadBtn,
            opacity: downloading || filtered.length === 0 ? 0.6 : 1,
            cursor: downloading || filtered.length === 0 ? "not-allowed" : "pointer",
          }}
          onClick={handleDownload}
          disabled={downloading || filtered.length === 0}
        >
          {downloading ? "⏳ Downloading…" : "⬇ Start download"}
        </button>
      </div>
    </div>
  );
}

// ── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [t, setT] = useState(null);

  useEffect(() => {
    try {
      const trello = window.TrelloPowerUp?.iframe();
      if (trello) {
        setT(trello);
        trello.getRestApi().isAuthorized().then(async (isAuth) => {
          if (isAuth) {
            setAuthorized(true);
            await fetchAttachments(trello);
          }
        });
      } else {
        setAuthorized(true);
      }
    } catch (err) {
      setAuthorized(true);
    }
  }, []);

  // FIX: Use the server-side /api/attachments endpoint so we get
  // listName mapped onto every attachment (needed for "split by list")
  const fetchAttachments = async (trello) => {
    try {
      const token = await trello.getRestApi().getToken();
      const board = await trello.board("id");
      const key = import.meta.env.VITE_TRELLO_API_KEY;

      // Call our own server which also fetches lists and maps listName
      const res = await fetch(
        `${SERVER_URL}/api/attachments?boardId=${board.id}&key=${key}&token=${token}`
      );
      const { attachments: serverAtts, lists } = await res.json();

      // Build a quick id→name map for lists
      const listMap = Object.fromEntries(lists.map((l) => [l.id, l.name]));

      // Attach listName to every attachment
      const enriched = serverAtts.map((att) => ({
        ...att,
        listName: listMap[att.listId] || "Unknown list",
      }));

      setAttachments(enriched);
    } catch (err) {
      console.error("Failed to fetch attachments", err);
    }
  };

  const handleAuthorize = async () => {
    setLoading(true);
    try {
      await t.getRestApi().authorize({ scope: "read" });
      setAuthorized(true);
      await fetchAttachments(t);
    } catch (err) {
      console.error("Authorization failed", err);
    }
    setLoading(false);
  };

  if (!authorized) {
    return <AuthScreen onAuthorize={handleAuthorize} loading={loading} />;
  }

  return <DownloaderScreen attachments={attachments} />;
}

// ── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  page: {
    background: "transparent",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "sans-serif",
  },
  modal: {
    background: "rgba(15, 23, 42, 0.95)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
    borderRadius: 12,
    padding: 28,
    width: 500,
    color: "#fff",
    backdropFilter: "blur(10px)",
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
  optionRow: {
    display: "flex",
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontSize: 14,
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
  sizeBox: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "8px 14px",
    minWidth: 160,
  },
  downloadBtn: {
    width: "100%",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "14px 0",
    marginTop: 20,
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