import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://aqgzuuckcrbbiyxapmat.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxZ3p1dWNrY3JiYml5eGFwbWF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTc0MzIsImV4cCI6MjA4NDIzMzQzMn0.gu0Hyha4lkYDNASkXGQJTqBivpeiMbkxWixsjEEaIJo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== Per-device token (one vote per device; can change via upsert) ======
function getVoterToken() {
  const key = "wall_voter_token";
  let tok = localStorage.getItem(key);
  if (!tok) {
    tok = crypto.randomUUID();
    localStorage.setItem(key, tok);
  }
  return tok;
}
const VOTER_TOKEN = getVoterToken();

// ===== UI =====
const columnsEl = document.getElementById("columns");
const statusText = document.getElementById("statusText");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const openFormBtn = document.getElementById("openFormBtn");

const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");

const entryForm = document.getElementById("entryForm");
const formMsg = document.getElementById("formMsg");

const displayNameEl = document.getElementById("displayName");
const titleEl = document.getElementById("title");
const fromLabelEl = document.getElementById("fromLabel");
const socialUrlEl = document.getElementById("socialUrl");
const imageFileEl = document.getElementById("imageFile");
const descriptionEl = document.getElementById("description");

let allEntries = [];
let renderTimer = null;
let myVotes = new Map(); // entryId -> vote (+1/-1)

// ===== Helpers =====
function normalize(s){ return (s || "").toString().toLowerCase().trim(); }
function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function openModal(){ modal.classList.remove("hidden"); formMsg.textContent=""; }
function closeModal(){ modal.classList.add("hidden"); }

openFormBtn.addEventListener("click", openModal);
closeModalBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

refreshBtn.addEventListener("click", () => loadAll());
searchInput.addEventListener("input", () => scheduleRender());

function scheduleRender(){
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderColumns, 120);
}

function scoreToBoldClass(score){
  if (score >= 8) return "bold2";
  if (score >= 3) return "bold1";
  return "";
}

function filterEntries(list){
  const q = normalize(searchInput.value);
  if (!q) return list;
  return list.filter((e) => {
    const hay = [e.display_name, e.title, e.from_label, e.description, e.social_url]
      .map(normalize).join(" | ");
    return hay.includes(q);
  });
}

// ===== Storage upload (public bucket: entry-images) =====
async function uploadImageIfAny(file){
  if (!file) return null;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const filename = `${crypto.randomUUID()}.${ext}`;
  const path = `uploads/${filename}`;

  const { error: upErr } = await supabase
    .storage
    .from("entry-images")
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (upErr) {
    console.error(upErr);
    throw new Error("Image upload failed. Check Storage bucket/policies.");
  }

  // Public URL (bucket must be public)
  const { data } = supabase.storage.from("entry-images").getPublicUrl(path);
  return data.publicUrl;
}

// ===== Load data =====
async function loadEntries(){
  statusText.textContent = "Loading…";

  const { data, error } = await supabase
    .from("entries_with_votes")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    console.error(error);
    statusText.textContent = "Error loading entries (check RLS).";
    return;
  }

  allEntries = data || [];
  statusText.textContent = `${allEntries.length} entries`;
}

async function loadMyVotes(){
  // Get THIS device's votes (only for approved entries per policy)
  const { data, error } = await supabase
    .from("entry_votes")
    .select("entry_id, vote")
    .eq("voter_token", VOTER_TOKEN);

  if (error) {
    console.warn("Could not load device votes (ok if RLS blocks it):", error);
    myVotes = new Map();
    return;
  }

  myVotes = new Map((data || []).map((r) => [r.entry_id, r.vote]));
}

async function loadAll(){
  await Promise.all([loadEntries(), loadMyVotes()]);
  renderColumns();
}

// ===== Voting: True (+1) / NotTrue (-1) with UPSERT =====
async function setVote(entryId, vote){
  // Upsert: insert or update on conflict(entry_id, voter_token)
  const { error } = await supabase
    .from("entry_votes")
    .upsert(
      { entry_id: entryId, voter_token: VOTER_TOKEN, vote },
      { onConflict: "entry_id,voter_token" }
    );

  if (error) {
    alert("Vote failed. Try again.");
    console.error(error);
    return;
  }

  // Update local + reload totals
  myVotes.set(entryId, vote);
  await loadEntries();
  renderColumns();
}

// ===== Render =====
async function buildCard(e){
  const card = document.createElement("div");
  card.className = `card ${scoreToBoldClass(e.score)}`;

  const created = new Date(e.created_at).toLocaleString();
  const fromLine = e.from_label ? `<span class="badge">From: ${escapeHtml(e.from_label)}</span>` : "";
  const desc = e.description ? `<div class="desc">${escapeHtml(e.description)}</div>` : "";
  const social = e.social_url
    ? `<a class="link" href="${e.social_url}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`
    : "";

  const avatar = e.image_path
    ? `<img class="avatar" src="${e.image_path}" alt="evidence" />`
    : `<div class="avatar" style="display:grid;place-items:center;color:rgba(170,182,232,.9);font-size:12px;">IMG</div>`;

  const my = myVotes.get(e.id); // +1 or -1

  card.innerHTML = `
    <div class="rowTop">
      ${avatar}
      <div style="min-width:0;flex:1;">
        <div class="name">${escapeHtml(e.display_name)}</div>
        <div style="color:rgba(170,182,232,.9);font-size:11px;margin-top:2px;">${created}</div>
        <div class="meta">
          <span class="badge">${escapeHtml(e.title)}</span>
          ${fromLine}
          <span class="badge">True: <b>${e.true_count}</b> · NotTrue: <b>${e.nottrue_count}</b></span>
        </div>
      </div>
    </div>

    ${desc}
    ${social}

    <div class="actions">
      <span>Score: <b>${e.score}</b></span>
      <div class="voteBtns">
        <button class="voteBtn good ${my === 1 ? "active" : ""}" data-id="${e.id}" data-vote="1">True</button>
        <button class="voteBtn bad ${my === -1 ? "active" : ""}" data-id="${e.id}" data-vote="-1">Not True</button>
      </div>
    </div>
  `;

  card.querySelectorAll(".voteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const vote = Number(btn.getAttribute("data-vote"));
      await setVote(id, vote);
    });
  });

  return card;
}

async function renderColumns(){
  const cols = Array.from(columnsEl.querySelectorAll(".col"));
  cols.forEach((c) => (c.innerHTML = ""));

  const filtered = filterEntries(allEntries);

  const buckets = cols.map(() => []);
  filtered.forEach((e, idx) => buckets[idx % buckets.length].push(e));

  for (let i = 0; i < buckets.length; i++){
    const items = buckets[i];
    const col = cols[i];

    const track = document.createElement("div");
    track.className = "track";

    // Only loop if enough items; else show once without duplication
    const MIN_FOR_LOOP = 6;
    const listToRender = items.length >= MIN_FOR_LOOP ? items.concat(items) : items;

    const dur = 28 + i * 6 + Math.max(0, 30 - items.length) * 0.35;
    track.style.setProperty("--dur", `${dur}s`);

    if (items.length < MIN_FOR_LOOP){
      track.style.animation = "none";
      track.style.position = "static";
      col.style.overflow = "auto";
    } else {
      col.style.overflow = "hidden";
    }

    for (const e of listToRender){
      track.appendChild(await buildCard(e));
    }

    col.appendChild(track);
  }

  if (!filtered.length) statusText.textContent = "No approved entries to display yet.";
}

// ===== Submit =====
entryForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  formMsg.textContent = "Submitting…";

  const display_name = displayNameEl.value.trim();
  const title = titleEl.value.trim();
  const from_label = fromLabelEl.value.trim() || null;
  const social_url = socialUrlEl.value.trim() || null;
  const description = descriptionEl.value.trim() || null;

  if (!display_name || !title) {
    formMsg.textContent = "Name and Title are required.";
    return;
  }

  try{
    const file = imageFileEl.files?.[0] || null;
    const image_path = await uploadImageIfAny(file); // returns public URL or null

    const { error } = await supabase.from("entries").insert({
      display_name,
      title,
      from_label,
      social_url,
      image_path,
      description,
      status: "pending"
    });

    if (error) {
      console.error(error);
      formMsg.textContent = "Submit failed. Check RLS/Storage bucket.";
      return;
    }

    entryForm.reset();
    formMsg.textContent = "Submitted! Pending moderation.";
    setTimeout(() => closeModal(), 600);
  } catch (err){
    console.error(err);
    formMsg.textContent = err.message || "Submit failed.";
  }
});

// Start
loadAll();
