import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://aqgzuuckcrbbiyxapmat.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxZ3p1dWNrY3JiYml5eGFwbWF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTc0MzIsImV4cCI6MjA4NDIzMzQzMn0.gu0Hyha4lkYDNASkXGQJTqBivpeiMbkxWixsjEEaIJo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== UI =====
const columnsEl = document.getElementById("columns");
const statusText = document.getElementById("statusText");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const openFormBtn = document.getElementById("openFormBtn");

const authBtn = document.getElementById("authBtn");
const signOutBtn = document.getElementById("signOutBtn");

const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");

const authModal = document.getElementById("authModal");
const authBackdrop = document.getElementById("authBackdrop");
const closeAuthBtn = document.getElementById("closeAuthBtn");
const emailEl = document.getElementById("email");
const magicLinkBtn = document.getElementById("magicLinkBtn");
const authMsg = document.getElementById("authMsg");

const entryForm = document.getElementById("entryForm");
const formMsg = document.getElementById("formMsg");

const fullNameEl = document.getElementById("fullName");
const titleEl = document.getElementById("title");
const fromLabelEl = document.getElementById("fromLabel");
const socialUrlEl = document.getElementById("socialUrl");
const imageFileEl = document.getElementById("imageFile");
const descriptionEl = document.getElementById("description");

let allEntries = [];
let renderTimer = null;

// ===== Helpers =====
function normalize(s){ return (s || "").toString().toLowerCase().trim(); }
function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function openModal(){ modal.classList.remove("hidden"); formMsg.textContent=""; }
function closeModal(){ modal.classList.add("hidden"); }
function openAuth(){ authModal.classList.remove("hidden"); authMsg.textContent=""; }
function closeAuth(){ authModal.classList.add("hidden"); }

openFormBtn.addEventListener("click", openModal);
closeModalBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

authBtn.addEventListener("click", openAuth);
closeAuthBtn.addEventListener("click", closeAuth);
authBackdrop.addEventListener("click", closeAuth);

refreshBtn.addEventListener("click", () => loadEntries());
searchInput.addEventListener("input", () => scheduleRender());

function scheduleRender(){
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderColumns, 120);
}

async function refreshAuthUI(){
  const { data } = await supabase.auth.getSession();
  const signedIn = !!data.session;
  authBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);

  statusText.textContent = signedIn ? "Loading directory…" : "Not signed in.";
  if (signedIn) await loadEntries();
  else {
    allEntries = [];
    renderColumns();
  }
}

signOutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshAuthUI();
});

magicLinkBtn.addEventListener("click", async () => {
  authMsg.textContent = "Sending link…";
  const email = emailEl.value.trim();
  if (!email) { authMsg.textContent = "Enter an email."; return; }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });

  if (error) {
    authMsg.textContent = "Failed to send link.";
    console.error(error);
    return;
  }

  authMsg.textContent = "Magic link sent. Check your email.";
});

// ===== Storage upload (private bucket recommended) =====
async function uploadImageIfAny(file){
  if (!file) return null;

  // Ensure you're using a Storage bucket named "directory-images"
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const path = `uploads/${filename}`;

  const { error: upErr } = await supabase.storage
    .from("directory-images")
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (upErr) {
    console.error(upErr);
    throw new Error("Image upload failed.");
  }

  // If bucket is PRIVATE: we’ll create a signed URL at render time.
  // Store the path in DB.
  return path;
}

async function getImageUrl(image_path){
  if (!image_path) return null;

  // Signed URL works for private buckets
  const { data, error } = await supabase.storage
    .from("directory-images")
    .createSignedUrl(image_path, 60 * 60); // 1 hour

  if (error) {
    console.warn("Signed URL failed", error);
    return null;
  }
  return data.signedUrl;
}

// ===== Data loading =====
async function loadEntries(){
  statusText.textContent = "Loading…";

  const { data, error } = await supabase
    .from("directory_cards")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    console.error(error);
    statusText.textContent = "Error loading (check Auth + RLS).";
    return;
  }

  allEntries = data || [];
  renderColumns();
  statusText.textContent = `${allEntries.length} entries`;
}

// ===== Filtering =====
function filterEntries(list){
  const q = normalize(searchInput.value);
  if (!q) return list;

  return list.filter((e) => {
    const hay = [
      e.full_name,
      e.title,
      e.from_label,
      e.description,
      e.social_url
    ].map(normalize).join(" | ");
    return hay.includes(q);
  });
}

function scoreToBoldClass(score){
  if (score >= 5) return "bold2";
  if (score >= 2) return "bold1";
  return "";
}

// ===== Render cards =====
async function buildCard(e){
  const card = document.createElement("div");
  card.className = `card ${scoreToBoldClass(e.score)}`;

  const imgUrl = await getImageUrl(e.image_path);

  const created = new Date(e.created_at).toLocaleString();
  const fromLine = e.from_label ? `<span class="badge">From: ${escapeHtml(e.from_label)}</span>` : "";
  const desc = e.description ? `<div class="desc">${escapeHtml(e.description)}</div>` : "";

  const avatar = imgUrl
    ? `<img class="avatar" src="${imgUrl}" alt="photo" />`
    : `<div class="avatar" style="display:grid;place-items:center;color:rgba(170,182,232,.9);font-size:12px;">IMG</div>`;

  const social = e.social_url
    ? `<a class="link" href="${e.social_url}" target="_blank" rel="noopener noreferrer">Social ↗</a>`
    : "";

  card.innerHTML = `
    <div class="rowTop">
      ${avatar}
      <div style="min-width:0;flex:1;">
        <div class="name">${escapeHtml(e.full_name)}</div>
        <div style="color:rgba(170,182,232,.9);font-size:11px;margin-top:2px;">${created}</div>
        <div class="meta">
          <span class="badge">${escapeHtml(e.title)}</span>
          ${fromLine}
          <span class="badge">Score: <b>${e.score}</b> (👍 ${e.upvotes} / 👎 ${e.downvotes})</span>
        </div>
      </div>
    </div>

    ${desc}
    ${social}

    <div class="actions">
      <span></span>
      <div class="voteBtns">
        <button class="voteBtn good" data-id="${e.id}" data-vote="1">Upvote</button>
        <button class="voteBtn bad" data-id="${e.id}" data-vote="-1">Downvote</button>
      </div>
    </div>
  `;

  card.querySelectorAll(".voteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const vote = Number(btn.getAttribute("data-vote"));
      await submitVote(id, vote);
    });
  });

  return card;
}

async function renderColumns(){
  const cols = Array.from(columnsEl.querySelectorAll(".col"));
  cols.forEach((c) => (c.innerHTML = ""));

  const filtered = filterEntries(allEntries);

  // Distribute
  const buckets = cols.map(() => []);
  filtered.forEach((e, idx) => buckets[idx % buckets.length].push(e));

  // Render each column track
  for (let i = 0; i < buckets.length; i++){
    const items = buckets[i];
    const col = cols[i];

    const track = document.createElement("div");
    track.className = "track";

    // Only loop if enough items; else show once and stop animation
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

  if (!filtered.length) statusText.textContent = "No entries to display.";
}

// ===== Voting =====
async function submitVote(entryId, vote){
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) { alert("Please sign in to vote."); return; }

  const { error } = await supabase.from("directory_votes").insert({
    entry_id: entryId,
    user_id: user.id,
    vote
  });

  if (error) {
    const msg = (error.message || "").toLowerCase().includes("duplicate")
      ? "You already voted on this entry."
      : "Vote failed.";
    alert(msg);
    console.error(error);
    return;
  }

  await loadEntries();
}

// ===== Submit entry =====
entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const { data } = await supabase.auth.getSession();
  if (!data.session) { formMsg.textContent = "Please sign in first."; return; }

  formMsg.textContent = "Saving…";

  const full_name = fullNameEl.value.trim();
  const title = titleEl.value.trim();
  const from_label = fromLabelEl.value.trim() || null;
  const social_url = socialUrlEl.value.trim() || null;
  const description = descriptionEl.value.trim() || null;

  if (!full_name || !title){
    formMsg.textContent = "Full name + title are required.";
    return;
  }

  try{
    const imageFile = imageFileEl.files?.[0] || null;
    const image_path = await uploadImageIfAny(imageFile);

    const { error } = await supabase.from("directory_entries").insert({
      full_name,
      title,
      from_label,
      social_url,
      image_path,
      description
    });

    if (error){
      console.error(error);
      formMsg.textContent = "Save failed (check RLS/Storage).";
      return;
    }

    entryForm.reset();
    formMsg.textContent = "Saved!";
    setTimeout(() => closeModal(), 500);
    await loadEntries();
  } catch (err){
    console.error(err);
    formMsg.textContent = err.message || "Save failed.";
  }
});

// ===== Init =====
supabase.auth.onAuthStateChange(() => refreshAuthUI());
refreshAuthUI();
