// script.js (module)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/**
 * 1) Put your Supabase values here:
 * Supabase Dashboard -> Settings -> API
 */
const SUPABASE_URL = "https://aqgzuuckcrbbiyxapmat.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxZ3p1dWNrY3JiYml5eGFwbWF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTc0MzIsImV4cCI6MjA4NDIzMzQzMn0.gu0Hyha4lkYDNASkXGQJTqBivpeiMbkxWixsjEEaIJo";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Simple per-device token (privacy-friendly alternative to IP tracking).
 * Not perfect (user can clear storage), but avoids collecting IPs.
 */
function getVoterToken() {
  const key = "reportwall_voter_token";
  let tok = localStorage.getItem(key);
  if (!tok) {
    tok = crypto.randomUUID();
    localStorage.setItem(key, tok);
  }
  return tok;
}
const VOTER_TOKEN = getVoterToken();

// UI elements
const columnsEl = document.getElementById("columns");
const statusText = document.getElementById("statusText");
const searchInput = document.getElementById("searchInput");
const platformFilter = document.getElementById("platformFilter");
const refreshBtn = document.getElementById("refreshBtn");
const openFormBtn = document.getElementById("openFormBtn");

const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");
const reportForm = document.getElementById("reportForm");
const formMsg = document.getElementById("formMsg");

// Form fields
const platformEl = document.getElementById("platform");
const urlEl = document.getElementById("url");
const reportTypeEl = document.getElementById("reportType");
const descriptionEl = document.getElementById("description");
const severityEl = document.getElementById("severity");
const tagsEl = document.getElementById("tags");

let allReports = [];
let renderTimer = null;

function openModal() {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  formMsg.textContent = "";
}
function closeModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

openFormBtn.addEventListener("click", openModal);
closeModalBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

refreshBtn.addEventListener("click", () => loadApprovedReports());

searchInput.addEventListener("input", () => scheduleRender());
platformFilter.addEventListener("change", () => scheduleRender());

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderColumns, 120);
}

function normalize(s) {
  return (s || "").toString().toLowerCase().trim();
}

function filterReports(reports) {
  const q = normalize(searchInput.value);
  const pf = normalize(platformFilter.value);

  return reports.filter((r) => {
    if (pf && normalize(r.platform) !== pf) return false;

    if (!q) return true;

    const hay = [
      r.platform,
      r.report_type,
      r.description,
      (r.tags || []).join(" "),
      r.url,
    ]
      .map(normalize)
      .join(" | ");

    return hay.includes(q);
  });
}

function scoreToBoldClass(score) {
  // Make higher confirmation appear bolder
  if (score >= 5) return "bold2";
  if (score >= 2) return "bold1";
  return "";
}

function safeText(s) {
  return (s ?? "").toString();
}

function tagify(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return arr
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildCard(r) {
  const card = document.createElement("div");
  card.className = `card ${scoreToBoldClass(r.score)}`;

  const created = new Date(r.created_at).toLocaleString();

  const tags = tagify(r.tags);

  card.innerHTML = `
    <div class="cardTop">
      <div class="meta">
        <div class="line1">
          <span class="badge">${safeText(r.platform)}</span>
          <span class="badge type">${safeText(r.report_type)}</span>
          <span class="badge sev">Severity ${r.severity}</span>
        </div>
        <div class="small" style="margin-top:4px;color:rgba(170,182,232,.9);font-size:11px;">
          ${created}
        </div>
      </div>
    </div>

    <div class="desc">${escapeHtml(safeText(r.description))}</div>

    <a class="link" href="${safeAttr(r.url)}" target="_blank" rel="noopener noreferrer">
      Open link ↗
    </a>

    <div class="tags">
      ${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
    </div>

    <div class="actions">
      <div class="votes">
        <span>Score: <b>${r.score}</b></span>
        <span>✅ ${r.confirms}</span>
        <span>⚠️ ${r.disputes}</span>
      </div>
      <div class="voteBtns">
        <button class="voteBtn good" data-id="${r.id}" data-vote="1">Confirm</button>
        <button class="voteBtn bad" data-id="${r.id}" data-vote="-1">Dispute</button>
      </div>
    </div>
  `;

  // vote handlers
  card.querySelectorAll(".voteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reportId = btn.getAttribute("data-id");
      const vote = Number(btn.getAttribute("data-vote"));
      await submitVote(reportId, vote);
    });
  });

  return card;
}

function renderColumns() {
  const filtered = filterReports(allReports);

  // Clear columns
  const cols = Array.from(columnsEl.querySelectorAll(".col"));
  cols.forEach((c) => (c.innerHTML = ""));

  // Distribute items across columns
  const buckets = cols.map(() => []);
  filtered.forEach((r, idx) => {
    buckets[idx % buckets.length].push(r);
  });

  // Create scrolling tracks
  buckets.forEach((items, colIdx) => {
    const col = cols[colIdx];

    // If few items, still show without weird loop
    const dur = 28 + colIdx * 6 + Math.max(0, 30 - items.length) * 0.35;

    const track = document.createElement("div");
    track.className = "track";
    track.style.setProperty("--dur", `${dur}s`);

    // Duplicate list for seamless loop (A + A)
    const doubled = items.concat(items);

    doubled.forEach((r) => track.appendChild(buildCard(r)));

    col.appendChild(track);
  });

  statusText.textContent = `${filtered.length} approved reports showing`;
}

async function loadApprovedReports() {
  statusText.textContent = "Loading…";

  const { data, error } = await supabase
    .from("report_scores") // view
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    console.error(error);
    statusText.textContent = "Error loading reports (check Supabase keys & RLS).";
    return;
  }

  allReports = data || [];
  renderColumns();
}

async function submitVote(reportId, vote) {
  // Insert vote; unique(report_id, voter_token) prevents multiple votes per device
  const { error } = await supabase.from("report_votes").insert({
    report_id: reportId,
    voter_token: VOTER_TOKEN,
    vote,
  });

  if (error) {
    // Most common: duplicate vote
    const msg =
      (error.message || "").toLowerCase().includes("duplicate") ||
      (error.details || "").toLowerCase().includes("duplicate")
        ? "You already voted on this report (one vote per device)."
        : "Vote failed. Please try again.";
    alert(msg);
    return;
  }

  // Refresh to update scores
  await loadApprovedReports();
}

reportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg.textContent = "Submitting…";

  const platform = platformEl.value.trim();
  const url = urlEl.value.trim();
  const report_type = reportTypeEl.value.trim();
  const description = descriptionEl.value.trim();
  const severity = Number(severityEl.value);

  const tags = tagsEl.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (!platform || !url || !report_type || !description) {
    formMsg.textContent = "Please fill in all required fields.";
    return;
  }

  const { error } = await supabase.from("reports").insert({
    platform,
    url,
    report_type,
    description,
    severity: Number.isFinite(severity) ? severity : 3,
    tags,
    status: "pending",
  });

  if (error) {
    console.error(error);
    formMsg.textContent = "Submit failed. Check Supabase config/RLS.";
    return;
  }

  formMsg.textContent = "Submitted! Your report is pending moderation.";
  reportForm.reset();
  severityEl.value = "3";

  // Keep modal open briefly, then close
  setTimeout(() => {
    closeModal();
  }, 700);
});

// Basic HTML escaping
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[m] || m
    );
  });
}
function safeAttr(url) {
  // Basic guard; still rely on browser + rel=noopener
  return url;
}

// Start
loadApprovedReports();
