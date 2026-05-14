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

function getCategory(mimeType) {
  for (const [cat, types] of Object.entries(FILE_TYPES)) {
    if (types.includes(mimeType)) return cat;
  }
  return "Documents";
}

export default function App() {
  const [attachments, setAttachments] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState(
    Object.keys(FILE_TYPES).reduce((a, k) => ({ ...a, [k]: true }), {})
  );
  const [splitByList, setSplitByList] = useState(true);
  const [splitByCard, setSplitByCard] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [downloadAs, setDownloadAs] = useState("ZIP File (.zip)");
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    // We'll connect Trello here later
    setLoading(false);
  }, []);

  const filtered = attachments.filter((att) =>
    selectedTypes[getCategory(att.mimeType)]
  );

  const totalGB = (
    filtered.reduce((s, a) => s + (a.bytes || 0), 0) / 1e9
  ).toFixed(1);

  const toggleType = (type) =>
    setSelectedTypes((prev) => ({ ...prev, [type]: !prev[type] }));

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

        {/* Title */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>
            <strong>{filtered.length} attachments</strong>{" "}
            <span style={{ color: "#7c6af7" }}>({totalGB} GB)</span>
          </h2>
          <button style={s.filterBtn} onClick={() => setShowFilters(!showFilters)}>
            ▼ Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div style={s.filterPanel}>
            {Object.keys(FILE_TYPES).map((type) => (
              <label key={type} style={s.filterRow}>
                <input
                  type="checkbox"
                  checked={!!selectedTypes[type]}
                  onChange={() => toggleType(type)}
                  style={{ accentColor: "#7c6af7" }}
                />
                <span style={{ marginLeft: 8 }}>{type}</span>
              </label>
            ))}
          </div>
        )}

        {/* Options */}
        {[
          ["Split into list folders", splitByList, setSplitByList],
          ["Split into card folders", splitByCard, setSplitByCard],
        ].map(([label, val, setter]) => (
          <div key={label} style={s.optionRow}>
            <input
              type="checkbox"
              checked={val}
              onChange={(e) => setter(e.target.checked)}
              style={{ accentColor: "#7c6af7" }}
            />
            <span style={{ marginLeft: 10 }}>{label}</span>
          </div>
        ))}

        {/* Download Row */}
        <div style={{ display: "flex", gap: 16, marginTop: 24, position: "relative" }}>
          <div style={{ flex: 1 }}>
            <button style={s.selectBtn} onClick={() => setShowDropdown(!showDropdown)}>
              📦 {downloadAs} ▼
            </button>
            {showDropdown && (
              <div style={s.dropdown}>
                {["ZIP File (.zip)", "Google Drive", "Dropbox", "OneDrive"].map((opt) => (
                  <div key={opt} style={s.dropdownItem}
                    onClick={() => { setDownloadAs(opt); setShowDropdown(false); }}>
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={s.sizeBox}>
            <div style={{ fontSize: 11, color: "#8b9cb8" }}>Estimated size</div>
            <div style={{ fontWeight: 700 }}>{totalGB} GB · {filtered.length} files</div>
          </div>
        </div>

        {/* Download Button */}
        <button style={s.downloadBtn}>⬇ Start download</button>
      </div>
    </div>
  );
}

const s = {
  page: { background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" },
  modal: { background: "#1e2540", borderRadius: 12, padding: 28, width: 500, color: "#fff" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  icon: { background: "#7c6af7", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" },
  sub: { color: "#8b9cb8", fontSize: 13, marginBottom: 8 },
  filterBtn: { background: "#2a3150", border: "1px solid #3a4170", color: "#ccc", padding: "6px 12px", borderRadius: 8, cursor: "pointer" },
  filterPanel: { background: "#16193a", border: "1px solid #2a3150", borderRadius: 10, padding: 16, marginBottom: 16 },
  filterRow: { display: "flex", alignItems: "center", padding: "8px 0", cursor: "pointer", borderBottom: "1px solid #2a3150" },
  optionRow: { display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #2a3150", fontSize: 14 },
  selectBtn: { width: "100%", background: "#2a3150", border: "1px solid #3a4170", color: "#fff", padding: "10px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left" },
  dropdown: { position: "absolute", top: "110%", left: 0, right: 0, background: "#1e2540", border: "1px solid #3a4170", borderRadius: 8, zIndex: 10 },
  dropdownItem: { padding: "10px 14px", cursor: "pointer", fontSize: 14, borderBottom: "1px solid #2a3150", color: "#fff" },
  sizeBox: { background: "#2a3150", borderRadius: 8, padding: "8px 14px", minWidth: 160 },
  downloadBtn: { width: "100%", background: "#7c6af7", color: "#fff", border: "none", borderRadius: 10, padding: "14px 0", marginTop: 20, fontSize: 16, fontWeight: 700, cursor: "pointer" },
};