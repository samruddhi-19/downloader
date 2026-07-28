import { useState, useEffect, useRef } from "react";

// ─── Trello MIME → friendly category ────────────────────────────────────────
const FILE_TYPES = {
  Images: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
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

const TYPE_ICONS = {
  Images: "🖼️",
  PDFs: "📄",
  Documents: "📝",
  Videos: "🎬",
  "ZIP files": "🗜️",
  Spreadsheets: "📊",
  "Design files": "🎨",
};

function getCategory(mimeType) {
  for (const [cat, types] of Object.entries(FILE_TYPES)) {
    if (types.some((t) => mimeType?.startsWith(t) || t === mimeType))
      return cat;
  }
  return "Documents";
}

// ─── Upload date filtering ───────────────────────────────────────────────────
const DATE_PRESETS = [
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Past 7 Days" },
  { value: "custom", label: "Choose Date" },
];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// "YYYY-MM-DD" from an <input type="date"> is parsed as UTC by `new Date()`,
// which shifts the day for anyone behind UTC. Build it in local time instead.
function parseInputDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Returns { from, to } as a half-open interval [from, to), or null for "no limit".
function getDateRange(preset, customFrom, customTo) {
  const today = startOfToday();
  switch (preset) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "custom": {
      const from = parseInputDate(customFrom);
      const toDay = parseInputDate(customTo);
      const to = toDay ? addDays(toDay, 1) : null;
      if (!from && !to) return null;
      return { from, to };
    }
    default:
      return null;
  }
}

function matchesDateRange(att, range) {
  if (!range) return true;
  if (!att.date) return false; // undated attachments only survive "All Dates"
  const t = new Date(att.date).getTime();
  if (Number.isNaN(t)) return false;
  if (range.from && t < range.from.getTime()) return false;
  if (range.to && t >= range.to.getTime()) return false;
  return true;
}

function formatSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let jszipPromise = null;
function loadJSZip() {
  if (jszipPromise) return jszipPromise;
  jszipPromise = new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => resolve(window.JSZip);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return jszipPromise;
}

let jspdfPromise = null;
function loadJsPDF() {
  if (jspdfPromise) return jspdfPromise;
  jspdfPromise = new Promise((resolve, reject) => {
    if (window.jspdf?.jsPDF) return resolve(window.jspdf.jsPDF);
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return jspdfPromise;
}

// Reads an image blob and returns { dataUrl, width, height } for placing on a PDF page.
function blobToImageData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () =>
        resolve({
          dataUrl: reader.result,
          width: img.width,
          height: img.height,
        });
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const TRELLO_BASE = "https://api.trello.com/1";
async function trelloFetch(path, key, token) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${TRELLO_BASE}${path}${sep}key=${key}&token=${token}`,
  );
  if (!res.ok) {
    // Trello explains itself in the body ("invalid token", "invalid value for
    // attachment_fields", …). Without it a failure is just a bare status code.
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Trello API ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`,
    );
  }
  return res.json();
}

async function fetchBoardAttachments(boardId, key, token) {
  const [lists, cards] = await Promise.all([
    trelloFetch(`/boards/${boardId}/lists?fields=id,name`, key, token),
    trelloFetch(
      `/boards/${boardId}/cards?attachments=true&attachment_fields=id,name,url,bytes,mimeType,isUpload,date&fields=id,name,idList`,
      key,
      token,
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

// ─── Output formats ──────────────────────────────────────────────────────────
const FORMAT_OPTIONS = [
  {
    value: "zip",
    icon: "📦",
    label: "ZIP archive (.zip)",
    sublabel: "All matching files, foldered",
    action: "Start download",
  },
  {
    value: "images-pdf",
    icon: "🖼️",
    label: "PDF (images only)",
    sublabel: "One image per page",
    action: "Generate PDF",
    imagesRequired: true,
  },
  {
    value: "csv-manifest",
    icon: "📊",
    label: "CSV manifest",
    sublabel: "File list only, no downloads",
    action: "Generate CSV",
  },
  {
    value: "html-index",
    icon: "🗂️",
    label: "HTML index page",
    sublabel: "Browsable page of links",
    action: "Generate HTML index",
  },
];

// ─── Format dropdown (custom, since native <select> can't be themed) ─────────
// The option list renders *in the document flow* rather than absolutely
// positioned: the Power-Up iframe is sized with `sizeTo(document.body)`, so an
// overlay menu doesn't grow the body and gets clipped by the Trello modal
// whenever the dropdown sits near the bottom. Expanding in flow makes the
// iframe grow with it, so the menu is always fully visible.
function FormatDropdown({ value, onChange, imagesAvailable, aside }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    // The Trello modal is a fixed-height scroll container, so an expanded list
    // can land below the fold. Pull it into view rather than leaving the user
    // to guess that it opened.
    menuRef.current?.scrollIntoView({ block: "nearest" });
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = FORMAT_OPTIONS.map((opt) =>
    opt.imagesRequired && !imagesAvailable
      ? { ...opt, disabled: true, sublabel: "No images match the filters" }
      : opt,
  );
  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={rootRef}>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          style={{
            ...s.formatTrigger,
            borderColor: open ? "rgba(35,181,181,0.45)" : "rgba(255,255,255,0.07)",
          }}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span style={{ fontSize: 16 }}>{current.icon}</span>
          <span
            style={{
              fontSize: 13,
              color: "#e2e8f0",
              flex: 1,
              textAlign: "left",
            }}
          >
            {current.label}
          </span>
          <span
            style={{
              ...s.formatCaret,
              transform: open ? "rotate(180deg)" : "none",
            }}
          >
            ▾
          </span>
        </button>
        {aside}
      </div>

      {open && (
        <div ref={menuRef} style={s.formatMenu} role="listbox">
          {options.map((opt) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              aria-disabled={!!opt.disabled}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                ...s.formatMenuItem,
                ...(opt.value === value ? s.formatMenuItemActive : {}),
                ...(opt.disabled ? s.formatMenuItemDisabled : {}),
              }}
            >
              <span style={{ fontSize: 15 }}>{opt.icon}</span>
              <span style={{ flex: 1 }}>
                <div>{opt.label}</div>
                {opt.sublabel && (
                  <div style={s.formatMenuSublabel}>{opt.sublabel}</div>
                )}
              </span>
              {opt.value === value && (
                <span style={{ color: "#23B5B5", fontSize: 13 }}>✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={s.toggleRow}>
      <span
        style={{
          fontSize: 13,
          color: checked ? "#e2e8f0" : "#64748b",
          transition: "color 0.2s",
        }}
      >
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
        <div
          style={{
            ...s.toggleThumb,
            transform: checked ? "translateX(16px)" : "translateX(0px)",
          }}
        />
      </div>
    </label>
  );
}

// ─── Selectable filter chip (file types + date presets) ──────────────────────
function Chip({ icon, label, count, selected, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        ...s.chip,
        ...(selected ? s.chipSelected : null),
        ...(disabled ? s.chipDisabled : null),
      }}
    >
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
      <span>{label}</span>
      {count !== undefined && (
        <span
          style={{
            ...s.chipCount,
            ...(selected ? s.chipCountSelected : null),
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children, action }) {
  return (
    <div style={s.sectionLabelRow}>
      <span style={s.sectionLabel}>{children}</span>
      {action}
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuthorize, loading, message }) {
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
          <h2
            style={{
              fontSize: 20,
              marginBottom: 10,
              fontWeight: 700,
              color: "#f1f5f9",
            }}
          >
            Authorization
          </h2>
          <p
            style={{
              color: "#94a3b8",
              fontSize: 13,
              lineHeight: 1.7,
              margin: "0 0 6px",
            }}
          >
            We need your authorization to read this board's attachments.
          </p>
          <p
            style={{
              color: "#64748b",
              fontSize: 12,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            Only read access is requested. No data is sent to any third-party
            server.
          </p>
          {message && <div style={s.errorBox}>⚠ {message}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button
              style={{
                ...s.downloadBtn,
                padding: "11px 28px",
                cursor: "pointer",
              }}
              onClick={onAuthorize}
              disabled={loading}
            >
              {loading ? "Authorizing…" : "⬇ Authorize"}
            </button>
            <button style={s.cancelBtn} onClick={() => window.close?.()}>
              Cancel
            </button>
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

// ─── CSV / HTML export helpers ────────────────────────────────────────────────
function csvField(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildManifestCsv(attachments) {
  const headers = [
    "File Name",
    "List",
    "Card",
    "Type",
    "Size (bytes)",
    "Uploaded to Trello",
    "URL",
  ];
  const rows = attachments.map((a) => [
    a.name || a.id,
    a.listName || "",
    a.cardName || "",
    a.mimeType || "unknown",
    a.bytes || 0,
    a.isUpload ? "Yes" : "No",
    a.url || "",
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function buildIndexHtml(attachments) {
  // Group by list → card so the page mirrors the board's structure.
  const byList = new Map();
  for (const a of attachments) {
    const listKey = a.listName || "Unknown List";
    if (!byList.has(listKey)) byList.set(listKey, new Map());
    const byCard = byList.get(listKey);
    const cardKey = a.cardName || "Unknown Card";
    if (!byCard.has(cardKey)) byCard.set(cardKey, []);
    byCard.get(cardKey).push(a);
  }

  let body = "";
  for (const [listName, cards] of byList) {
    body += `<h2>${escapeHtml(listName)}</h2>`;
    for (const [cardName, atts] of cards) {
      body += `<h3>${escapeHtml(cardName)}</h3><ul class="att-list">`;
      for (const a of atts) {
        const isImage =
          getCategory(a.mimeType) === "Images" &&
          a.mimeType !== "image/svg+xml";
        const sizeKb = a.bytes ? `${(a.bytes / 1024).toFixed(1)} KB` : "";
        body += `<li>
          ${isImage ? `<img src="${escapeHtml(a.url)}" loading="lazy" alt="${escapeHtml(a.name)}" />` : `<span class="file-icon">${TYPE_ICONS[getCategory(a.mimeType)] || "📄"}</span>`}
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.name || a.id)}</a>
          <span class="meta">${sizeKb}</span>
        </li>`;
      }
      body += `</ul>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Trello Attachments Index</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1829; color: #e2e8f0; padding: 24px 32px; }
  h1 { color: #23B5B5; }
  h2 { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-top: 32px; }
  h3 { color: #94a3b8; font-size: 14px; margin: 16px 0 8px; }
  ul.att-list { list-style: none; padding: 0; margin: 0 0 8px; }
  ul.att-list li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  ul.att-list img { width: 36px; height: 36px; object-fit: cover; border-radius: 4px; }
  .file-icon { font-size: 20px; width: 36px; text-align: center; }
  a { color: #38bdf8; text-decoration: none; flex: 1; }
  a:hover { text-decoration: underline; }
  .meta { color: #64748b; font-size: 12px; }
  .note { color: #64748b; font-size: 12px; margin-bottom: 20px; }
</style>
</head>
<body>
  <h1>⬇ Trello Attachments Index</h1>
  <p class="note">Generated ${new Date().toLocaleString()} · ${attachments.length} attachments · Links open on Trello, so you may need to be logged in.</p>
  ${body}
</body>
</html>`;
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Downloader Screen ────────────────────────────────────────────────────────
function DownloaderScreen({ attachments, token, loadError }) {
  // Selected file types are a list, so any number of them can be active at
  // once. An empty list means "no type filter" — every type is included.
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [splitByList, setSplitByList] = useState(false);
  const [splitByCard, setSplitByCard] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [formatChoice, setFormatChoice] = useState("zip");
  const abortRef = useRef(null);

  const dateRange = getDateRange(datePreset, customFrom, customTo);

  // Date first, so the per-type counts on the chips reflect the chosen period.
  const dateFiltered = attachments.filter((a) => matchesDateRange(a, dateRange));
  const filtered = dateFiltered.filter(
    (a) =>
      selectedTypes.length === 0 ||
      selectedTypes.includes(getCategory(a.mimeType)),
  );

  const totalBytes = filtered.reduce((s, a) => s + (a.bytes || 0), 0);

  const imagesOnly = filtered.filter(
    (a) => getCategory(a.mimeType) === "Images",
  );

  // A chosen format can become unavailable while it is selected (e.g. the
  // filters stop matching any image while "PDF (images only)" is picked), so
  // fall back to ZIP rather than offering an action that can't run.
  const outputFormat =
    formatChoice === "images-pdf" && imagesOnly.length === 0
      ? "zip"
      : formatChoice;

  // Attachments that would actually go into the output for the selected format.
  const outputItems = outputFormat === "images-pdf" ? imagesOnly : filtered;
  const outputBytes = outputItems.reduce((s, a) => s + (a.bytes || 0), 0);

  // Count per type within the current date range.
  const typeCounts = Object.keys(FILE_TYPES).reduce((acc, cat) => {
    acc[cat] = dateFiltered.filter(
      (a) => getCategory(a.mimeType) === cat,
    ).length;
    return acc;
  }, {});

  // Keep an emptied-out type chip visible so it can be switched back off.
  const visibleTypes = Object.keys(FILE_TYPES).filter(
    (cat) => typeCounts[cat] > 0 || selectedTypes.includes(cat),
  );

  const toggleType = (type) =>
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );

  const filtersActive = selectedTypes.length > 0 || datePreset !== "all";
  const resetFilters = () => {
    setSelectedTypes([]);
    setDatePreset("all");
    setCustomFrom("");
    setCustomTo("");
  };

  const currentFormat =
    FORMAT_OPTIONS.find((o) => o.value === outputFormat) || FORMAT_OPTIONS[0];

  // Fetches one attachment through the proxy and returns its blob, or null if it should be skipped.
  const fetchAttachmentBlob = async (att, controller) => {
    if (
      !att.url?.startsWith("https://trello.com") &&
      !att.url?.startsWith("https://attachments.trello.com")
    ) {
      return null; // external link (Drive/Dropbox/etc.) — can't be proxied
    }
    const proxyUrl = `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}`;
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return res.blob();
  };

  const handleDownloadImagesAsPdf = async () => {
    if (imagesOnly.length === 0) {
      setError("No images match the current filters.");
      return;
    }
    setError(null);
    setProgress(0);
    setDownloading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const jsPDF = await loadJsPDF();
      const pdf = new jsPDF({ unit: "pt" });
      let done = 0;
      let addedCount = 0;

      for (const att of imagesOnly) {
        if (att.mimeType === "image/svg+xml") {
          done++;
          setProgress(Math.round((done / imagesOnly.length) * 90));
          continue;
        } // jsPDF can't embed SVG directly
        try {
          const blob = await fetchAttachmentBlob(att, controller);
          if (!blob) {
            done++;
            setProgress(Math.round((done / imagesOnly.length) * 90));
            continue;
          }
          const { dataUrl, width, height } = await blobToImageData(blob);

          if (addedCount > 0) pdf.addPage();
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const scale = Math.min(pageW / width, pageH / height);
          const w = width * scale,
            h = height * scale;
          const format = att.mimeType === "image/png" ? "PNG" : "JPEG";
          pdf.addImage(dataUrl, format, (pageW - w) / 2, (pageH - h) / 2, w, h);
          addedCount++;
        } catch (err) {
          if (err.name === "AbortError") throw err;
          // skip images that fail to load/convert
        }
        done++;
        setProgress(Math.round((done / imagesOnly.length) * 90));
      }

      if (addedCount === 0) {
        setError("None of the selected images could be converted.");
        setDownloading(false);
        abortRef.current = null;
        return;
      }

      setProgress(100);
      pdf.save("trello-images.pdf");
    } catch (err) {
      if (err.name !== "AbortError")
        setError("PDF creation failed: " + err.message);
    } finally {
      setDownloading(false);
      abortRef.current = null;
    }
  };

 const handleDownloadManifest = () => {
    if (filtered.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }
    setError(null);
    const csv = buildManifestCsv(filtered);
    downloadBlob(csv, "trello-attachments-manifest.csv", "text/csv;charset=utf-8");
  };

  const handleDownloadIndex = () => {
    if (filtered.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }
    setError(null);
    const html = buildIndexHtml(filtered);
    downloadBlob(html, "trello-attachments-index.html", "text/html;charset=utf-8");
  };

  const handleDownload = async () => {
    if (outputFormat === "images-pdf") return handleDownloadImagesAsPdf();
    if (outputFormat === "csv-manifest") return handleDownloadManifest();
    if (outputFormat === "html-index") return handleDownloadIndex();
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
      const safe = (name) =>
        (name || "file").replace(/[/\\?%*:|"<>\x00]/g, "_").slice(0, 200);
      let done = 0;
      let skippedCount = 0;
      await Promise.all(
        filtered.map(async (att) => {
          let folder = "";
          if (splitByList) folder = safe(att.listName) + "/";
          if (splitByCard) folder += safe(att.cardName) + "/";

          // Only Trello-hosted attachments can be fetched through the proxy.
          // External links (Drive, Dropbox, etc.) can't be authorized this way.
          if (
            !att.url?.startsWith("https://trello.com") &&
            !att.url?.startsWith("https://attachments.trello.com")
          ) {
            skippedCount++;
            done++;
            setProgress(Math.round((done / filtered.length) * 90));
            return;
          }

          try {
            const proxyUrl = `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}`;
            const res = await fetch(proxyUrl, { signal: controller.signal });
            if (!res.ok) {
              skippedCount++;
              done++;
              setProgress(Math.round((done / filtered.length) * 90));
              return;
            }
            const blob = await res.blob();
            const filename = folder + safe(att.name || att.id);
            if (skipDuplicates && zip.files[filename]) {
              done++;
              setProgress(Math.round((done / filtered.length) * 90));
              return;
            }
            zip.file(filename, blob);
            done++;
            setProgress(Math.round((done / filtered.length) * 90));
          } catch (err) {
            if (err.name !== "AbortError") {
              skippedCount++;
              done++;
              setProgress(Math.round((done / filtered.length) * 90));
            } else {
              throw err; // let cancel still propagate
            }
          }
        }),
      );

      if (skippedCount > 0) {
        console.log(
          `Skipped ${skippedCount} attachment(s) that couldn't be downloaded.`,
        );
      }
      setProgress(95);
      const content = await zip.generateAsync(
        {
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        },
        ({ percent }) => setProgress(95 + Math.round(percent * 0.05)),
      );
      setProgress(100);
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
          {/* Count */}
          <div style={{ marginBottom: 16 }}>
            <p style={s.superLabel}>You are about to download</p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#f1f5f9",
                  lineHeight: 1.2,
                }}
              >
                {filtered.length} attachments{" "}
                <span style={{ color: "#23B5B5", fontWeight: 700 }}>
                  ({formatSize(totalBytes)})
                </span>
              </div>
              {filtersActive && (
                <button style={s.resetBtn} onClick={resetFilters}>
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {/* A failed board fetch used to be indistinguishable from an empty
              board — both just rendered "0 attachments". */}
          {loadError && (
            <div style={{ ...s.errorBox, marginTop: 0, marginBottom: 14 }}>
              ⚠ {loadError}
            </div>
          )}
          {!loadError && attachments.length === 0 && (
            <div style={{ ...s.dateHint, marginTop: 0, marginBottom: 14 }}>
              This board has no attachments yet.
            </div>
          )}

          {/* ── Filter by file type ── */}
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Filter by file type</SectionLabel>
            <div style={s.chipRow}>
              <Chip
                label="All types"
                count={dateFiltered.length}
                selected={selectedTypes.length === 0}
                onClick={() => setSelectedTypes([])}
              />
              {visibleTypes.map((cat) => (
                <Chip
                  key={cat}
                  icon={TYPE_ICONS[cat]}
                  label={cat}
                  count={typeCounts[cat]}
                  selected={selectedTypes.includes(cat)}
                  onClick={() => toggleType(cat)}
                />
              ))}
              {visibleTypes.length === 0 && (
                <span style={s.emptyHint}>
                  No attachments in the selected period.
                </span>
              )}
            </div>
          </div>

          {/* ── Filter by upload date ── */}
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Filter by upload date</SectionLabel>
            <div style={s.chipRow}>
              {DATE_PRESETS.map((p) => (
                <Chip
                  key={p.value}
                  label={p.label}
                  selected={datePreset === p.value}
                  onClick={() => setDatePreset(p.value)}
                />
              ))}
            </div>

            {datePreset === "custom" && (
              <div style={s.dateRangePanel}>
                <label style={s.dateField}>
                  <span style={s.dateFieldLabel}>From</span>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    style={s.dateInput}
                  />
                </label>
                <label style={s.dateField}>
                  <span style={s.dateFieldLabel}>To</span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                    style={s.dateInput}
                  />
                </label>
              </div>
            )}

            {datePreset === "custom" && !customFrom && !customTo && (
              <div style={s.dateHint}>
                Pick a start date, an end date, or both. Leaving one blank keeps
                that side open-ended.
              </div>
            )}
          </div>

          {/* ── Toggles ── */}
          <SectionLabel>Archive &amp; folder configuration</SectionLabel>
          <div style={s.toggleGroup}>
            <Toggle
              label="Split into list folders"
              checked={splitByList}
              onChange={setSplitByList}
            />
            <Toggle
              label="Split into card folders"
              checked={splitByCard}
              onChange={setSplitByCard}
            />
            <Toggle
              label="Skip duplicate files"
              checked={skipDuplicates}
              onChange={setSkipDuplicates}
            />
          </div>

          {/* ── Format + size ── */}
          <div style={{ marginTop: 16 }}>
            <SectionLabel>Archive file format</SectionLabel>
            <FormatDropdown
              value={outputFormat}
              onChange={setFormatChoice}
              imagesAvailable={imagesOnly.length > 0}
              aside={
                <div style={s.sizeBox}>
                  <div style={s.sizeLabel}>Estimated size</div>
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}
                  >
                    {formatSize(outputBytes)} · {outputItems.length} files
                  </div>
                </div>
              }
            />
          </div>

          {/* Error */}
          {error && <div style={s.errorBox}>⚠ {error}</div>}

          {/* Progress */}
          {downloading && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 5,
                }}
              >
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  Downloading…
                </span>
                <span
                  style={{ fontSize: 11, color: "#23B5B5", fontWeight: 700 }}
                >
                  {progress}%
                </span>
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
              cursor:
                downloading || filtered.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
            onClick={handleDownload}
            disabled={downloading || filtered.length === 0}
          >
            {downloading
              ? `⏳ Downloading… ${progress}%`
              : `⬇ ${currentFormat.action}`}
          </button>
          {downloading && (
            <button style={s.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      <style>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>
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
  const [error, setError] = useState(null);
  const tRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const trello = window.TrelloPowerUp?.iframe({
          appKey: import.meta.env.VITE_TRELLO_API_KEY,
          appName: "Downloader",
        });
        if (!trello) {
          setAuthorized(true);
          setInitLoading(false);
          return;
        }
        tRef.current = trello;
        const isAuth = await trello.getRestApi().isAuthorized();
        if (isAuth) {
          setAuthorized(true);
          await loadAttachments(trello);
        } else {
          setAuthorized(false);
        }
      } catch (err) {
        setAuthorized(false);
      } finally {
        setInitLoading(false);
      }
    })();
  }, []);

  // Keep the Trello modal sized to whatever is actually rendered, instead of a
  // fixed height that leaves dead space (short content) or clips content (long).
  useEffect(() => {
    if (!tRef.current) return;
    const resize = () => tRef.current?.sizeTo(document.body);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [authorized, initLoading, attachments]);

  const loadAttachments = async (trello) => {
    try {
      const key = import.meta.env.VITE_TRELLO_API_KEY;
      const tok = await trello.getRestApi().getToken();
      setToken(tok);
      const board = await trello.board("id");
      const { attachments: atts } = await fetchBoardAttachments(
        board.id,
        key,
        tok,
      );
      setAttachments(atts);
      setError(null);
    } catch (err) {
      // A stored token stays "authorized" even after it stops working — most
      // often because it was issued under a previous API key. Left alone the
      // app skips the auth screen and fails on every load, so drop the dead
      // token and send the user back to re-authorize.
      if (/\b401\b/.test(err.message)) {
        try {
          await trello.getRestApi().clearToken();
        } catch {
          // clearing is best-effort; the re-auth prompt matters more
        }
        setAuthorized(false);
        setError(
          "Your Trello authorization expired or was issued for a different app key. Please authorize again.",
        );
        return;
      }
      setError(`Couldn't load attachments — ${err.message}`);
    }
  };

  const handleAuthorize = async () => {
    setLoading(true);
    try {
      await tRef.current.getRestApi().authorize({ scope: "read" });
      setAuthorized(true);
      await loadAttachments(tRef.current);
    } catch (err) {
      setError("Authorization failed");
    }
    setLoading(false);
  };

  if (initLoading) {
    return (
      <div
        style={{
          background: "#0d1829",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #23B5B5, #1a8f8f)",
            width: 52,
            height: 52,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            marginBottom: 14,
            boxShadow: "0 0 0 1px rgba(35,181,181,0.3)",
          }}
        >
          ⬇
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 18,
            color: "#f1f5f9",
            marginBottom: 6,
          }}
        >
          Downloader
        </div>
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 20 }}>
          Fetching your attachments…
        </div>
        <div
          style={{
            width: 180,
            height: 3,
            background: "rgba(255,255,255,0.07)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "40%",
              background: "#23B5B5",
              borderRadius: 4,
              animation: "slide 1.2s infinite ease-in-out",
            }}
          />
        </div>
        <style>{`@keyframes slide { 0%{transform:translateX(-200%)} 100%{transform:translateX(600%)} }`}</style>
      </div>
    );
  }

  if (!authorized)
    return (
      <AuthScreen
        onAuthorize={handleAuthorize}
        loading={loading}
        message={error}
      />
    );
  return (
    <DownloaderScreen
      attachments={attachments}
      token={token}
      loadError={error}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
  page: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0d1829",
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
    borderRadius: 9,
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    boxShadow: "0 0 0 1px rgba(35,181,181,0.25)",
  },
  headerTitle: {
    fontWeight: 700,
    fontSize: 14,
    color: "#f1f5f9",
    letterSpacing: "0.01em",
  },

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
    fontSize: 11,
    color: "#475569",
    margin: "0 0 4px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontWeight: 600,
  },

  // ── Section labels ──
  sectionLabelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  sectionLabel: {
    fontSize: 10,
    color: "#475569",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  resetBtn: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#94a3b8",
    padding: "5px 10px",
    borderRadius: 7,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    flexShrink: 0,
  },

  // ── Filter chips ──
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.09)",
    color: "#94a3b8",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  },
  chipSelected: {
    background: "rgba(35,181,181,0.14)",
    borderColor: "rgba(35,181,181,0.55)",
    color: "#5eead4",
  },
  chipDisabled: { opacity: 0.4, cursor: "not-allowed" },
  chipCount: {
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 5,
    padding: "1px 5px",
  },
  chipCountSelected: {
    color: "#0d1829",
    background: "#5eead4",
  },
  emptyHint: { fontSize: 12, color: "#475569", padding: "6px 2px" },

  // ── Custom date range ──
  dateRangePanel: {
    display: "flex",
    gap: 8,
    marginTop: 8,
  },
  dateField: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  dateFieldLabel: {
    fontSize: 10,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 700,
  },
  dateInput: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    color: "#e2e8f0",
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    colorScheme: "dark",
    width: "100%",
  },
  dateHint: {
    fontSize: 11,
    color: "#475569",
    marginTop: 6,
    lineHeight: 1.5,
  },

  // ── Toggles ──
  toggleGroup: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    overflow: "hidden",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "9px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    cursor: "pointer",
  },
  toggleTrack: {
    width: 32,
    height: 18,
    borderRadius: 9,
    border: "1px solid",
    position: "relative",
    cursor: "pointer",
    transition: "background 0.2s, border-color 0.2s",
    flexShrink: 0,
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.2s cubic-bezier(.4,0,.2,1)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  },

  // ── Format + size ──
  formatTrigger: {
    flex: 1,
    minWidth: 0,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 9,
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  formatCaret: {
    fontSize: 11,
    color: "#64748b",
    transition: "transform 0.15s ease",
  },
  // Rendered in flow (not absolutely positioned) so the Power-Up iframe grows
  // with it instead of clipping the options — see FormatDropdown.
  formatMenu: {
    marginTop: 6,
    background: "#132038",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 9,
    padding: 4,
    boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
  },
  formatMenuItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: 13,
    color: "#e2e8f0",
    cursor: "pointer",
  },
  formatMenuItemActive: {
    background: "rgba(35,181,181,0.12)",
  },
  formatMenuItemDisabled: {
    color: "#475569",
    cursor: "not-allowed",
  },
  formatMenuSublabel: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 1,
  },
  sizeBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 9,
    padding: "10px 14px",
    minWidth: 148,
  },
  sizeLabel: {
    fontSize: 10,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 600,
    marginBottom: 2,
  },

  // ── Error ──
  errorBox: {
    marginTop: 12,
    background: "rgba(248,113,113,0.07)",
    border: "1px solid rgba(248,113,113,0.18)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    color: "#fca5a5",
  },

  // ── Progress ──
  progressWrap: {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 6,
    height: 5,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "linear-gradient(90deg, #23B5B5, #38bdf8)",
    borderRadius: 6,
    transition: "width 0.25s ease",
  },

  // ── Footer (button area) ──
  // In the styles object, change footer:
  footer: {
    display: "flex",
    gap: 8,
    padding: "14px 20px 18px",
    background: "#303134", // ← matches Trello's top modal bar exactly
    flexShrink: 0,
  },

  // ── Buttons ──
  downloadBtn: {
    background: "linear-gradient(135deg, #23B5B5, #1a9f9f)",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.01em",
    boxShadow:
      "0 0 0 1px rgba(35,181,181,0.2), 0 4px 14px rgba(35,181,181,0.18)",
    transition: "opacity 0.15s",
  },
  cancelBtn: {
    background: "rgba(255,255,255,0.04)",
    color: "#64748b",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 9,
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
