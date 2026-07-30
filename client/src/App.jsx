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

// Emoji render differently on every platform and can't be recoloured, so the UI
// uses the line icons below. This map is only for the exported HTML index,
// which is a standalone file with no access to our components.
const TYPE_EMOJI = {
  Images: "🖼️",
  PDFs: "📄",
  Documents: "📝",
  Videos: "🎬",
  "ZIP files": "🗜️",
  Spreadsheets: "📊",
  "Design files": "🎨",
};

// 24×24 stroke icons, one hue per category so a type is recognisable by colour
// before the label is read. Hues are spaced around the wheel to stay distinct.
const TYPE_META = {
  Images: {
    color: "#38bdf8",
    paths: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-4.5-4.5L6 21" />
      </>
    ),
  },
  PDFs: {
    color: "#f87171",
    paths: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </>
    ),
  },
  Documents: {
    color: "#94a3b8",
    paths: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M9 9h2" />
        <path d="M9 13h6" />
        <path d="M9 17h6" />
      </>
    ),
  },
  Videos: {
    color: "#c084fc",
    paths: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </>
    ),
  },
  "ZIP files": {
    color: "#fbbf24",
    paths: (
      <>
        <rect x="3" y="3" width="18" height="5" rx="1" />
        <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
        <path d="M10 12h4" />
      </>
    ),
  },
  Spreadsheets: {
    color: "#4ade80",
    paths: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18" />
      </>
    ),
  },
  "Design files": {
    color: "#f472b6",
    paths: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5z" />
        <path d="m3 12 9 5 9-5" />
        <path d="m3 17 9 5 9-5" />
      </>
    ),
  },
};

function TypeIcon({ type, size = 16 }) {
  const meta = TYPE_META[type] || TYPE_META.Documents;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={meta.color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
    >
      {meta.paths}
    </svg>
  );
}

const ALL_TYPES = Object.keys(FILE_TYPES);

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

// Chrome refuses to run its built-in PDF viewer inside a sandboxed iframe, and
// this app is an iframe within Trello's — so <iframe src=…pdf> renders as
// "blocked by Chrome". PDF.js draws to a canvas instead, which has no such
// restriction.
const PDFJS_VERSION = "3.11.174";
let pdfjsPromise = null;
function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement("script");
    script.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return pdfjsPromise;
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
  const [lists, labels, members, cards] = await Promise.all([
    trelloFetch(`/boards/${boardId}/lists?fields=id,name`, key, token),
    trelloFetch(`/boards/${boardId}/labels?fields=id,name,color`, key, token),
    trelloFetch(
      `/boards/${boardId}/members?fields=id,fullName,username,initials`,
      key,
      token,
    ),
    trelloFetch(
      `/boards/${boardId}/cards?attachments=true&attachment_fields=id,name,url,bytes,mimeType,isUpload,date&fields=id,name,idList,idLabels,idMembers,due,dueComplete`,
      key,
      token,
    ),
  ]);

  const listMap = Object.fromEntries(lists.map((l) => [l.id, l.name]));
  const attachments = [];
  // Only cards that actually carry attachments are worth offering in the card
  // picker — the rest can never affect the result.
  const cardsWithAttachments = [];

  for (const card of cards) {
    if (!card.attachments?.length) continue;
    cardsWithAttachments.push({ id: card.id, name: card.name });
    for (const att of card.attachments) {
      attachments.push({
        ...att,
        cardId: card.id,
        cardName: card.name,
        listName: listMap[card.idList] || "Unknown List",
        listId: card.idList,
        // Card-level facets, copied onto each attachment so filtering stays a
        // flat pass rather than a join back to the card list.
        labelIds: card.idLabels || [],
        memberIds: card.idMembers || [],
        due: card.due || null,
        dueComplete: !!card.dueComplete,
      });
    }
  }

  return { attachments, lists, labels, members, cards: cardsWithAttachments };
}

// ─── Due date buckets ────────────────────────────────────────────────────────
// Day-based and mutually exclusive, so every card lands in exactly one bucket.
const DUE_STATUSES = [
  { value: "none", label: "No Due Date" },
  { value: "today", label: "Due Today" },
  { value: "future", label: "Due in Future" },
  { value: "overdue", label: "Overdue" },
];

function getDueStatus(due) {
  if (!due) return "none";
  const t = new Date(due);
  if (Number.isNaN(t.getTime())) return "none";
  t.setHours(0, 0, 0, 0);
  const today = startOfToday().getTime();
  if (t.getTime() === today) return "today";
  return t.getTime() > today ? "future" : "overdue";
}

// Trello label colours, mapped to the swatch shown next to each label name.
const LABEL_COLORS = {
  green: "#4bce97",
  yellow: "#e2b203",
  orange: "#fea362",
  red: "#f87168",
  purple: "#9f8fef",
  blue: "#579dff",
  sky: "#6cc3e0",
  lime: "#94c748",
  pink: "#e774bb",
  black: "#8590a2",
};

function labelColor(color) {
  if (!color) return "#8590a2";
  // Trello returns shade-qualified names like "green_dark" / "subtle_blue".
  const base = Object.keys(LABEL_COLORS).find((c) => color.includes(c));
  return LABEL_COLORS[base] || "#8590a2";
}

function memberInitials(member) {
  if (member.initials) return member.initials.slice(0, 2).toUpperCase();
  const source = member.fullName || member.username || "?";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
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
// positioned. This dropdown sits near the bottom of a fixed-height scrolling
// panel, where an overlay menu gets clipped by the scroll container. Expanding
// in flow extends the scrollable content instead, so the menu is always
// reachable — paired with the scrollIntoView below that brings it into view.
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

// ─── Read-only breakdown pill (always-visible summary of what's included) ────
// Every selected type gets a pill, including ones the board has none of. A pill
// that vanishes at zero makes ticking a type look like it did nothing.
function TypePill({ type, label, count }) {
  const empty = count === 0;
  return (
    <div style={{ ...s.typePill, ...(empty ? s.typePillEmpty : null) }}>
      <span style={{ opacity: empty ? 0.45 : 1, display: "flex" }}>
        <TypeIcon type={type} size={14} />
      </span>
      <span style={{ fontSize: 12, color: empty ? "#64748b" : "#94a3b8" }}>
        {label}
      </span>
      <span
        style={{
          ...s.typePillCount,
          ...(empty ? s.typePillCountEmpty : null),
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ─── One row of the file-type filter list ────────────────────────────────────
function TypeCheckRow({ type, label, count, checked, onChange }) {
  return (
    <label className="dl-row" style={s.filterRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: "#23B5B5", margin: 0 }}
      />
      <span style={s.typeRowIcon}>
        <TypeIcon type={type} size={16} />
      </span>
      <span style={{ fontSize: 13, color: "#cbd5e1", flex: 1 }}>{label}</span>
      <span style={{ ...s.chipCount, opacity: count === 0 ? 0.45 : 1 }}>
        {count}
      </span>
    </label>
  );
}

// ─── Advanced filter sub-section ─────────────────────────────────────────────
function FacetGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={s.facetLabel}>{title}</div>
      <div style={s.chipRow}>{children}</div>
    </div>
  );
}

function LabelChip({ label, selected, onClick }) {
  const color = labelColor(label.color);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        ...s.chip,
        ...(selected
          ? { background: `${color}22`, borderColor: color, color: "#e2e8f0" }
          : null),
      }}
    >
      <span style={{ ...s.labelSwatch, background: color }} />
      {/* Trello allows unnamed labels — fall back to the colour name. */}
      <span>{label.name || label.color || "Unnamed label"}</span>
    </button>
  );
}

function MemberChip({ member, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{ ...s.chip, ...(selected ? s.chipSelected : null) }}
    >
      <span style={s.memberAvatar}>{memberInitials(member)}</span>
      <span>{member.fullName || member.username}</span>
    </button>
  );
}

// Only Trello-hosted files can be fetched through the proxy; external links
// (Drive, Dropbox, …) can't be authorized this way, so they can't be previewed.
function isProxyable(url) {
  return (
    url?.startsWith("https://trello.com") ||
    url?.startsWith("https://attachments.trello.com")
  );
}

// `mime` lets the proxy label the response with something the browser can
// render — Trello hands everything back as application/octet-stream, which a
// preview frame can only download.
function proxyUrlFor(att, token) {
  const mime = att.mimeType ? `&mime=${encodeURIComponent(att.mimeType)}` : "";
  return `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}${mime}`;
}

// ─── PDF preview, rendered to a canvas via PDF.js ────────────────────────────
// Renders its own `fallback` on failure rather than calling back to the parent,
// which keeps the load effect from re-running on every parent render.
function PdfPreview({ att, token, fallback }) {
  const canvasRef = useRef(null);
  const docRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        const res = await fetch(proxyUrlFor(att, token));
        if (!res.ok) throw new Error(`proxy returned ${res.status}`);
        const data = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setPages(doc.numPages);
        setPage(1);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
    };
  }, [att, token]);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    (async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas) return;
      const pg = await doc.getPage(page);
      if (cancelled) return;
      const base = pg.getViewport({ scale: 1 });
      const available = canvas.parentElement?.clientWidth || 420;
      // Render above CSS size so the page stays sharp on high-DPI screens.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (available / base.width) * dpr;
      const viewport = pg.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      await pg.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  if (status === "failed") return fallback;

  return (
    <>
      <div style={s.pdfStage}>
        {status === "loading" ? (
          <div style={s.pdfLoading}>Rendering PDF…</div>
        ) : (
          <div className="dl-scroll" style={s.pdfCanvasWrap}>
            <canvas ref={canvasRef} style={{ display: "block" }} />
          </div>
        )}
      </div>
      {pages > 1 && (
        <div style={s.pdfPager}>
          <button
            className="dl-ghost"
            style={s.backBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ‹ Prev
          </button>
          <span style={s.pdfPageLabel}>
            Page {page} of {pages}
          </span>
          <button
            className="dl-ghost"
            style={s.backBtn}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
          >
            Next ›
          </button>
        </div>
      )}
    </>
  );
}

// ─── Single-file preview shown inside the popup ──────────────────────────────
function FilePreview({ att, token, onBack }) {
  const [failed, setFailed] = useState(false);
  const category = getCategory(att.mimeType);
  const src = proxyUrlFor(att, token);

  // Rendered inline: images as an <img>, PDFs in an <iframe>. Everything else
  // has no in-browser renderer, so it gets a description instead of a blank box.
  const proxyable = isProxyable(att.url);
  const isImage = category === "Images" && att.mimeType !== "image/svg+xml";
  const isPdf = att.mimeType === "application/pdf";

  const fallback = (
    <div style={s.previewStage}>
      <div style={s.previewFallback}>
        <TypeIcon type={category} size={40} />
        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>
          {att.name || att.id}
        </div>
        <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.6 }}>
          {!proxyable
            ? "This file is stored outside Trello, so it can't be previewed here — or included in the download."
            : failed
              ? "This file couldn't be loaded for preview."
              : `${category} files have no in-browser preview. It will still be included in the download.`}
        </div>
        <a
          href={att.url}
          target="_blank"
          rel="noopener noreferrer"
          style={s.previewOpenLink}
        >
          Open on Trello ↗
        </a>
      </div>
    </div>
  );

  let content = fallback;
  if (proxyable && !failed) {
    if (isImage) {
      content = (
        <div style={s.previewStage}>
          <img
            src={src}
            alt={att.name || "attachment"}
            style={s.previewImage}
            onError={() => setFailed(true)}
          />
        </div>
      );
    } else if (isPdf) {
      content = <PdfPreview att={att} token={token} fallback={fallback} />;
    }
  }

  return (
    <>
      <div style={s.popupSubHeader}>
        <button
          type="button"
          className="dl-ghost"
          style={s.backBtn}
          onClick={onBack}
        >
          ← Back to list
        </button>
        <span style={s.previewSize}>{formatSize(att.bytes)}</span>
      </div>

      {content}

      <div style={s.previewCaption} title={att.name || att.id}>
        {att.name || att.id}
        <span style={s.previewCaptionMeta}>
          {att.listName} · {att.cardName}
        </span>
      </div>
    </>
  );
}

// ─── One file row in the download preview ────────────────────────────────────
function PreviewRow({ att, checked, onToggle, onPreview }) {
  const category = getCategory(att.mimeType);
  return (
    <div
      className="dl-row"
      style={{ ...s.previewRow, opacity: checked ? 1 : 0.4 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ accentColor: "#23B5B5", margin: 0, flexShrink: 0 }}
      />
      <span style={s.previewIconTile}>
        <TypeIcon type={category} size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.previewName} title={att.name || att.id}>
          {att.name || att.id}
        </div>
        <div style={s.previewMeta}>
          <span style={s.previewListBadge}>{att.listName}</span>
          <span style={s.previewCard} title={att.cardName}>
            {att.cardName}
          </span>
        </div>
      </div>
      <span style={s.previewSize}>{formatSize(att.bytes)}</span>
      <button
        type="button"
        className="dl-eye"
        onClick={onPreview}
        style={s.previewEye}
        title="Preview this file"
        aria-label={`Preview ${att.name || "file"}`}
      >
        👁
      </button>
    </div>
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
      <GlobalStyles />
      <div style={s.modal}>
        <div style={s.headerBar}>
          <div style={s.headerLeft}>
            <div style={s.iconBox}>⬇</div>
            <span style={s.headerTitle}>Downloader</span>
          </div>
        </div>
        <div style={s.topAccent} />
        <div className="dl-scroll" style={s.body}>
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
          ${isImage ? `<img src="${escapeHtml(a.url)}" loading="lazy" alt="${escapeHtml(a.name)}" />` : `<span class="file-icon">${TYPE_EMOJI[getCategory(a.mimeType)] || "📄"}</span>`}
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
function DownloaderScreen({ attachments, board, token, loadError }) {
  // The list of types included in the download. Every type starts included and
  // each checkbox independently adds or removes its own type, so any
  // combination stays visibly checked — no entry can shadow another.
  const [selectedTypes, setSelectedTypes] = useState(ALL_TYPES);
  const [showFilters, setShowFilters] = useState(false);
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Advanced facets. Unlike the file-type checkboxes these are opt-in: an empty
  // selection means "don't filter on this facet at all", which is what lets a
  // board with dozens of lists or labels stay usable.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [excludedIds, setExcludedIds] = useState([]);
  const [selectedLists, setSelectedLists] = useState([]);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedDue, setSelectedDue] = useState([]);
  const [splitByList, setSplitByList] = useState(false);
  const [splitByCard, setSplitByCard] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [formatChoice, setFormatChoice] = useState("zip");
  const abortRef = useRef(null);

  const dateRange = getDateRange(datePreset, customFrom, customTo);

  // An empty selection means the facet isn't filtering at all.
  const matchesAdvanced = (a) => {
    if (selectedCard && a.cardId !== selectedCard) return false;
    if (selectedLists.length && !selectedLists.includes(a.listId)) return false;
    // Labels and members are many-per-card, so a card qualifies if it carries
    // *any* of the selected ones.
    if (
      selectedLabels.length &&
      !a.labelIds?.some((id) => selectedLabels.includes(id))
    )
      return false;
    if (
      selectedMembers.length &&
      !a.memberIds?.some((id) => selectedMembers.includes(id))
    )
      return false;
    if (selectedDue.length && !selectedDue.includes(getDueStatus(a.due)))
      return false;
    return true;
  };

  // Date and advanced facets first, so the per-type counts in the filter list
  // reflect everything else that is already narrowing the result.
  const dateFiltered = attachments.filter(
    (a) => matchesDateRange(a, dateRange) && matchesAdvanced(a),
  );
  const filtered = dateFiltered.filter((a) =>
    selectedTypes.includes(getCategory(a.mimeType)),
  );

  // The preview tracks what the user has *removed* rather than what they kept,
  // so files newly matching a widened filter are included by default instead of
  // silently sitting there unticked.
  const selected = filtered.filter((a) => !excludedIds.includes(a.id));
  const excludedInView = filtered.length - selected.length;

  const totalBytes = selected.reduce((s, a) => s + (a.bytes || 0), 0);

  const imagesOnly = selected.filter(
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
  const outputItems = outputFormat === "images-pdf" ? imagesOnly : selected;
  const outputBytes = outputItems.reduce((s, a) => s + (a.bytes || 0), 0);

  // Counts for the filter list are taken within the current date range, so they
  // show what each type would actually contribute.
  const typeCounts = ALL_TYPES.reduce((acc, cat) => {
    acc[cat] = dateFiltered.filter(
      (a) => getCategory(a.mimeType) === cat,
    ).length;
    return acc;
  }, {});

  // Counts for the always-visible summary reflect the final selection.
  const includedCounts = ALL_TYPES.reduce((acc, cat) => {
    acc[cat] = selected.filter((a) => getCategory(a.mimeType) === cat).length;
    return acc;
  }, {});

  const toggleType = (type) =>
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );

  const advancedCount =
    selectedLists.length +
    selectedLabels.length +
    selectedMembers.length +
    selectedDue.length +
    (selectedCard ? 1 : 0);

  const filtersActive =
    selectedTypes.length !== ALL_TYPES.length ||
    datePreset !== "all" ||
    advancedCount > 0;

  const resetFilters = () => {
    setSelectedTypes(ALL_TYPES);
    setDatePreset("all");
    setCustomFrom("");
    setCustomTo("");
    setSelectedLists([]);
    setSelectedLabels([]);
    setSelectedMembers([]);
    setSelectedCard("");
    setSelectedDue([]);
  };

  // Shared add/remove for the multi-select facets.
  const toggleIn = (setter) => (id) =>
    setter((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );

  // ── Preview selection ──
  const toggleFile = (id) =>
    setExcludedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );

  // Only clears exclusions for what's currently in view, so files hidden by a
  // filter keep whatever the user decided about them earlier.
  const selectAllInView = () =>
    setExcludedIds((prev) => prev.filter((id) => !filtered.some((a) => a.id === id)));

  const clearAllInView = () =>
    setExcludedIds((prev) => [
      ...prev,
      ...filtered.filter((a) => !prev.includes(a.id)).map((a) => a.id),
    ]);

  const allInViewSelected = filtered.length > 0 && excludedInView === 0;

  const closePreview = () => {
    setShowPreview(false);
    setPreviewFile(null);
  };

  // Escape steps back out of a single file first, then closes the popup — so it
  // never discards more context than the user expects.
  useEffect(() => {
    if (!showPreview) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setPreviewFile((file) => {
        if (!file) setShowPreview(false);
        return null;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showPreview]);

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
    if (selected.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }
    setError(null);
    const csv = buildManifestCsv(selected);
    downloadBlob(csv, "trello-attachments-manifest.csv", "text/csv;charset=utf-8");
  };

  const handleDownloadIndex = () => {
    if (selected.length === 0) {
      setError("No attachments match the current filters.");
      return;
    }
    setError(null);
    const html = buildIndexHtml(selected);
    downloadBlob(html, "trello-attachments-index.html", "text/html;charset=utf-8");
  };

  const handleDownload = async () => {
    if (outputFormat === "images-pdf") return handleDownloadImagesAsPdf();
    if (outputFormat === "csv-manifest") return handleDownloadManifest();
    if (outputFormat === "html-index") return handleDownloadIndex();
    if (selected.length === 0) {
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
        selected.map(async (att) => {
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
            setProgress(Math.round((done / selected.length) * 90));
            return;
          }

          try {
            const proxyUrl = `/api/proxy?token=${token}&url=${encodeURIComponent(att.url)}`;
            const res = await fetch(proxyUrl, { signal: controller.signal });
            if (!res.ok) {
              skippedCount++;
              done++;
              setProgress(Math.round((done / selected.length) * 90));
              return;
            }
            const blob = await res.blob();
            const filename = folder + safe(att.name || att.id);
            if (skipDuplicates && zip.files[filename]) {
              done++;
              setProgress(Math.round((done / selected.length) * 90));
              return;
            }
            zip.file(filename, blob);
            done++;
            setProgress(Math.round((done / selected.length) * 90));
          } catch (err) {
            if (err.name !== "AbortError") {
              skippedCount++;
              done++;
              setProgress(Math.round((done / selected.length) * 90));
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
        <div className="dl-scroll" style={s.body}>
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
                {selected.length} attachments{" "}
                <span style={{ color: "#23B5B5", fontWeight: 700 }}>
                  ({formatSize(totalBytes)})
                </span>
              </div>
              <button
                style={{
                  ...s.filterBtn,
                  ...(showFilters || filtersActive ? s.filterBtnActive : null),
                }}
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                {showFilters ? "▲" : "▼"} Filters
                {filtersActive && <span style={s.filterDot} />}
              </button>
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

          {/* ── Always-visible breakdown: one pill per selected type ── */}
          <div style={s.breakdownRow}>
            {selectedTypes.length === 0 ? (
              <span style={{ fontSize: 12, color: "#475569" }}>
                No file types selected — open Filters to choose some.
              </span>
            ) : (
              ALL_TYPES.filter((cat) => selectedTypes.includes(cat)).map(
                (cat) => (
                  <TypePill
                    key={cat}
                    type={cat}
                    label={cat}
                    count={includedCounts[cat]}
                  />
                ),
              )
            )}
          </div>

          {/* ── Collapsible file type list ── */}
          {showFilters && (
            <div style={s.filterPanel}>
              <div style={{ ...s.sectionLabel, padding: "10px 2px 4px" }}>
                Filter by file type
              </div>
              {ALL_TYPES.map((cat) => (
                <TypeCheckRow
                  key={cat}
                  type={cat}
                  label={cat}
                  count={typeCounts[cat]}
                  checked={selectedTypes.includes(cat)}
                  onChange={() => toggleType(cat)}
                />
              ))}
              <div style={s.filterPanelFooter}>
                <button
                  style={s.resetBtn}
                  onClick={resetFilters}
                  disabled={!filtersActive}
                >
                  Reset all filters
                </button>
              </div>
            </div>
          )}

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

          {/* ── Advanced filters ── */}
          <div style={{ marginBottom: 14 }}>
            <button
              type="button"
              style={{
                ...s.advancedTrigger,
                borderColor:
                  showAdvanced || advancedCount
                    ? "rgba(35,181,181,0.45)"
                    : "rgba(255,255,255,0.09)",
              }}
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <span style={s.advancedIcon}>⚙</span>
              <span style={{ flex: 1, textAlign: "left" }}>
                Advanced filters (lists, labels, members, cards)
              </span>
              {advancedCount > 0 && (
                <span style={s.advancedBadge}>{advancedCount}</span>
              )}
              <span
                style={{
                  ...s.formatCaret,
                  transform: showAdvanced ? "rotate(180deg)" : "none",
                }}
              >
                ▾
              </span>
            </button>

            {showAdvanced && (
              <div style={s.advancedPanel}>
                {board.lists.length > 0 && (
                  <FacetGroup title="Filter by list">
                    {board.lists.map((l) => (
                      <Chip
                        key={l.id}
                        label={l.name}
                        selected={selectedLists.includes(l.id)}
                        onClick={() => toggleIn(setSelectedLists)(l.id)}
                      />
                    ))}
                  </FacetGroup>
                )}

                {board.labels.length > 0 && (
                  <FacetGroup title="Filter by label">
                    {board.labels.map((l) => (
                      <LabelChip
                        key={l.id}
                        label={l}
                        selected={selectedLabels.includes(l.id)}
                        onClick={() => toggleIn(setSelectedLabels)(l.id)}
                      />
                    ))}
                  </FacetGroup>
                )}

                {board.members.length > 0 && (
                  <FacetGroup title="Filter by assigned member">
                    {board.members.map((m) => (
                      <MemberChip
                        key={m.id}
                        member={m}
                        selected={selectedMembers.includes(m.id)}
                        onClick={() => toggleIn(setSelectedMembers)(m.id)}
                      />
                    ))}
                  </FacetGroup>
                )}

                <div style={{ marginBottom: 12 }}>
                  <div style={s.facetLabel}>Filter by card</div>
                  <select
                    value={selectedCard}
                    onChange={(e) => setSelectedCard(e.target.value)}
                    style={s.cardSelect}
                  >
                    <option value="">
                      -- Select specific card ({board.cards.length} card
                      {board.cards.length === 1 ? "" : "s"} with attachments) --
                    </option>
                    {board.cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <FacetGroup title="Filter by due date status">
                  {DUE_STATUSES.map((d) => (
                    <Chip
                      key={d.value}
                      label={d.label}
                      selected={selectedDue.includes(d.value)}
                      onClick={() => toggleIn(setSelectedDue)(d.value)}
                    />
                  ))}
                </FacetGroup>

                <div style={s.filterPanelFooter}>
                  <button
                    style={s.resetBtn}
                    onClick={resetFilters}
                    disabled={!filtersActive}
                  >
                    Reset all filters
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Downloader preview ── */}
          <div style={{ marginBottom: 14 }}>
            <button
              type="button"
              style={{
                ...s.advancedTrigger,
                borderColor: showPreview
                  ? "rgba(35,181,181,0.45)"
                  : "rgba(255,255,255,0.09)",
              }}
              onClick={() => setShowPreview(true)}
              aria-haspopup="dialog"
            >
              <span style={s.advancedIcon}>👁</span>
              <span style={{ flex: 1, textAlign: "left" }}>
                Downloader preview
                <span style={s.previewTriggerHint}>
                  {selected.length} of {filtered.length} files selected
                </span>
              </span>
              {excludedInView > 0 && (
                <span style={s.advancedBadge}>{excludedInView} removed</span>
              )}
              <span style={s.formatCaret}>▾</span>
            </button>
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
              opacity: downloading || selected.length === 0 ? 0.55 : 1,
              cursor:
                downloading || selected.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
            onClick={handleDownload}
            disabled={downloading || selected.length === 0}
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

      {/* ── Preview popup ── overlays the panel rather than expanding it, so a
          long file list never pushes the download controls out of reach. */}
      {showPreview && (
        <div className="dl-overlay" style={s.overlay} onClick={closePreview}>
          <div
            className="dl-popup"
            style={s.popup}
            role="dialog"
            aria-modal="true"
            aria-label="Downloader preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={s.popupHeader}>
              <div>
                <div style={s.popupTitle}>Downloader preview</div>
                <div style={s.previewSub}>
                  Review, deselect or quick-preview files before downloading.
                </div>
              </div>
              <button
                className="dl-ghost"
                style={s.popupClose}
                onClick={closePreview}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>

            {previewFile ? (
              <FilePreview
                att={previewFile}
                token={token}
                onBack={() => setPreviewFile(null)}
              />
            ) : (
              <>
                <div style={s.previewToolbar}>
                  <label style={s.previewSelectAll}>
                    <input
                      type="checkbox"
                      checked={allInViewSelected}
                      onChange={() =>
                        allInViewSelected ? clearAllInView() : selectAllInView()
                      }
                      disabled={filtered.length === 0}
                      style={{ accentColor: "#23B5B5", margin: 0 }}
                    />
                    <span style={{ marginLeft: 8 }}>
                      Select all ({selected.length}/{filtered.length})
                    </span>
                  </label>
                  <button
                    className="dl-ghost"
                    style={s.resetBtn}
                    onClick={clearAllInView}
                    disabled={selected.length === 0}
                  >
                    Clear all
                  </button>
                </div>

                {filtered.length === 0 ? (
                  <div style={{ ...s.dateHint, marginTop: 0 }}>
                    Nothing matches the current filters.
                  </div>
                ) : (
                  <div className="dl-scroll" style={s.previewList}>
                    {filtered.map((att) => (
                      <PreviewRow
                        key={att.id}
                        att={att}
                        checked={!excludedIds.includes(att.id)}
                        onToggle={() => toggleFile(att.id)}
                        onPreview={() => setPreviewFile(att)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={s.popupFooter}>
              <div>
                <div style={s.sizeLabel}>Estimated size</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}>
                  {formatSize(outputBytes)} · {outputItems.length} files
                </div>
              </div>
              <button
                className="dl-btn"
                style={s.popupDone}
                onClick={closePreview}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// The iframe is a fixed height, so the page itself must never scroll — only the
// body region does, with a scrollbar styled to match the panel instead of the
// browser default sitting on top of a dark UI.
const GLOBAL_CSS = `
  * { box-sizing: border-box; }
  /* Native popups (select lists, date pickers) are drawn by the browser, not by
     our CSS. Without a dark color-scheme they open white, and the light option
     text we set becomes unreadable against it. */
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; overflow: hidden; }
  #root { height: 100%; }

  select option { background-color: #132038; color: #e2e8f0; }
  select option:checked { background-color: #1a3a4a; }

  input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }

  /* Interaction states live here because inline styles can't express :hover. */
  .dl-row { transition: background 0.15s ease; }
  .dl-row:hover { background: rgba(255,255,255,0.035); }
  .dl-row:last-child { border-bottom: none; }

  .dl-eye { transition: background 0.15s, color 0.15s, border-color 0.15s; }
  .dl-eye:hover { background: rgba(35,181,181,0.16); border-color: rgba(35,181,181,0.5); color: #5eead4; }

  .dl-btn { transition: filter 0.15s, opacity 0.15s; }
  .dl-btn:hover:not(:disabled) { filter: brightness(1.12); }
  .dl-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .dl-ghost { transition: background 0.15s, color 0.15s, border-color 0.15s; }
  .dl-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .dl-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  .dl-popup { animation: popIn 0.16s cubic-bezier(.2,.8,.3,1); }
  @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; } }
  .dl-overlay { animation: fadeIn 0.14s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .dl-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.28) transparent; }
  .dl-scroll::-webkit-scrollbar { width: 8px; }
  .dl-scroll::-webkit-scrollbar-track { background: transparent; }
  .dl-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.28); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
  .dl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(35,181,181,0.65); background-clip: content-box; }
  @keyframes slide { 0% { transform: translateX(-200%); } 100% { transform: translateX(600%); } }
`;

function GlobalStyles() {
  return <style>{GLOBAL_CSS}</style>;
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  // Board facets backing the advanced filters (lists, labels, members, cards).
  const [board, setBoard] = useState({
    lists: [],
    labels: [],
    members: [],
    cards: [],
  });
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

  // Deliberately no `sizeTo(document.body)` here. Growing the iframe to fit the
  // content is what forced Trello to scroll the whole modal — its scrollbar,
  // outside our styling, and it moved the header and download button off-screen.
  // The iframe now stays at the modal's height and the body scrolls internally.

  const loadAttachments = async (trello) => {
    try {
      const key = import.meta.env.VITE_TRELLO_API_KEY;
      const tok = await trello.getRestApi().getToken();
      setToken(tok);
      const boardRef = await trello.board("id");
      const { attachments: atts, lists, labels, members, cards } =
        await fetchBoardAttachments(boardRef.id, key, tok);
      setAttachments(atts);
      setBoard({ lists, labels, members, cards });
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
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        <GlobalStyles />
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
      board={board}
      token={token}
      loadError={error}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
  // Fills the iframe exactly and never scrolls itself — see GLOBAL_CSS.
  page: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0d1829",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  modal: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0, // lets the scrollable body shrink instead of overflowing
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

  // ── Body ── the only scrolling region; `.dl-scroll` supplies overflow-y
  body: { padding: "16px 20px 12px", flex: 1, minHeight: 0 },

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

  // ── Filters toggle + panel ──
  filterBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#64748b",
    padding: "5px 10px",
    borderRadius: 7,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    flexShrink: 0,
    transition: "color 0.15s, border-color 0.15s",
  },
  filterBtnActive: {
    color: "#5eead4",
    borderColor: "rgba(35,181,181,0.45)",
  },
  // Marks that a filter is narrowing the results while the panel is closed.
  filterDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#23B5B5",
  },
  filterPanel: {
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: "2px 12px 10px",
    marginBottom: 14,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 6px",
    marginInline: -6,
    borderRadius: 7,
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  // Fixed-width slot keeps every label starting on the same x, whatever the
  // icon's shape.
  typeRowIcon: {
    width: 22,
    marginLeft: 9,
    display: "flex",
    justifyContent: "center",
  },
  filterPanelFooter: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: 10,
  },

  // ── Breakdown summary ──
  breakdownRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
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
  typePillCount: {
    fontSize: 11,
    fontWeight: 700,
    color: "#23B5B5",
    background: "rgba(35,181,181,0.12)",
    borderRadius: 5,
    padding: "1px 6px",
  },
  // Selected but empty: still listed, just visually recessed so the types that
  // actually contribute files stay dominant.
  typePillEmpty: {
    background: "rgba(255,255,255,0.02)",
    borderColor: "rgba(255,255,255,0.05)",
  },
  typePillCountEmpty: {
    color: "#64748b",
    background: "rgba(255,255,255,0.05)",
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

  // ── Advanced filters ──
  advancedTrigger: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid",
    borderRadius: 10,
    padding: "11px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#cbd5e1",
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  advancedIcon: {
    fontSize: 13,
    color: "#23B5B5",
  },
  advancedBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#0d1829",
    background: "#5eead4",
    borderRadius: 999,
    padding: "1px 7px",
  },
  advancedPanel: {
    marginTop: 8,
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(35,181,181,0.25)",
    borderRadius: 10,
    padding: "14px 14px 10px",
  },
  facetLabel: {
    fontSize: 9.5,
    color: "#64748b",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontWeight: 700,
    marginBottom: 7,
  },
  labelSwatch: {
    width: 8,
    height: 8,
    borderRadius: 3,
    flexShrink: 0,
  },
  memberAvatar: {
    width: 17,
    height: 17,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #23B5B5, #1a8f8f)",
    color: "#0d1829",
    fontSize: 8.5,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardSelect: {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    color: "#e2e8f0",
    padding: "9px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    colorScheme: "dark",
    cursor: "pointer",
  },

  // ── Preview popup ──
  // Fixed to the iframe viewport, which is exactly the modal area Trello gives
  // us, so the overlay covers the panel and nothing else.
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(3,7,18,0.72)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    zIndex: 50,
  },
  popup: {
    width: "100%",
    maxWidth: 540,
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    background:
      "linear-gradient(168deg, #13233d 0%, #0d1a2e 62%, #0b1626 100%)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 16,
    boxShadow:
      "0 32px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(35,181,181,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
    padding: "18px 20px 16px",
  },
  popupHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  popupTitle: {
    fontSize: 16.5,
    fontWeight: 800,
    color: "#f8fafc",
    letterSpacing: "-0.01em",
  },
  popupClose: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    color: "#94a3b8",
    borderRadius: 8,
    width: 28,
    height: 28,
    fontSize: 12,
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "inherit",
  },
  popupSubHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  backBtn: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    color: "#cbd5e1",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  popupFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.07)",
  },
  popupDone: {
    background: "linear-gradient(135deg, #2ad0cf, #1a9f9f)",
    color: "#04141a",
    border: "none",
    borderRadius: 10,
    padding: "10px 26px",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.01em",
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow:
      "0 6px 18px rgba(35,181,181,0.28), inset 0 1px 0 rgba(255,255,255,0.25)",
  },

  // ── Single-file preview stage ──
  previewStage: {
    flex: 1,
    minHeight: 180,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    overflow: "hidden",
    padding: 8,
  },
  previewImage: {
    maxWidth: "100%",
    maxHeight: 300,
    objectFit: "contain",
    borderRadius: 6,
  },
  // ── PDF canvas preview ──
  pdfStage: {
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    overflow: "hidden",
    minHeight: 180,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  pdfCanvasWrap: {
    width: "100%",
    maxHeight: 300,
    borderRadius: 6,
    background: "#fff",
  },
  pdfLoading: { fontSize: 12, color: "#64748b", padding: "60px 0" },
  pdfPager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 10,
  },
  pdfPageLabel: {
    fontSize: 11.5,
    color: "#94a3b8",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  previewFallback: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 9,
    textAlign: "center",
    padding: "22px 18px",
    maxWidth: 340,
  },
  previewOpenLink: {
    fontSize: 11.5,
    color: "#5eead4",
    textDecoration: "none",
    fontWeight: 600,
  },
  previewCaption: {
    marginTop: 10,
    fontSize: 12.5,
    fontWeight: 600,
    color: "#e2e8f0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  previewCaptionMeta: {
    display: "block",
    fontSize: 10.5,
    fontWeight: 500,
    color: "#64748b",
    marginTop: 2,
  },
  previewTriggerHint: {
    display: "block",
    fontSize: 10.5,
    fontWeight: 500,
    color: "#64748b",
    marginTop: 2,
  },

  // ── Download preview ──
  previewSub: {
    fontSize: 11.5,
    color: "#64748b",
    lineHeight: 1.5,
    marginBottom: 10,
  },
  previewToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    padding: "8px 11px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 9,
  },
  previewSelectAll: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "#cbd5e1",
    cursor: "pointer",
  },
  // Takes the space the popup has and scrolls inside it, so the toolbar above
  // and the size/Done row below stay put with any number of files.
  previewList: {
    flex: 1,
    minHeight: 0,
    maxHeight: 320,
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    background: "rgba(0,0,0,0.22)",
    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
  },
  previewRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 11px",
    borderBottom: "1px solid rgba(255,255,255,0.045)",
  },
  previewIconTile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.07)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    flexShrink: 0,
  },
  previewName: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#e8eef7",
    letterSpacing: "-0.005em",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  previewMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    minWidth: 0,
  },
  previewListBadge: {
    fontSize: 9.5,
    fontWeight: 700,
    color: "#5eead4",
    background: "rgba(35,181,181,0.12)",
    borderRadius: 4,
    padding: "1px 5px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  previewCard: {
    fontSize: 10.5,
    color: "#64748b",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  previewSize: {
    fontSize: 10.5,
    color: "#7c8ba1",
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums", // keeps sizes aligned down the column
  },
  previewEye: {
    fontSize: 11,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 7,
    color: "#94a3b8",
    cursor: "pointer",
    flexShrink: 0,
    width: 26,
    height: 26,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },

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
