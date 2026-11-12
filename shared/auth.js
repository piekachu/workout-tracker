// Shared sign-in for every page. Load AFTER the supabase-js CDN script:
//
//   <script src=".../supabase.js"></script>
//   <script src="../shared/auth.js"></script>
//   <script>const sb = Auth.client;</script>   // or `Auth.client` in app.js
//
// Sign-in is an emailed link (no password to store or leak). Open the link on
// the device you want signed in; the session then persists there until
// "Sign out", so it's one link per new phone or laptop. Data access is enforced by row-level security in the
// database (supabase/migrations/0006_lock_down.sql), not by this overlay --
// the overlay only stops a signed-out visitor from staring at a broken page.
//
// The anon key below is public by design. It identifies the project; it does
// not grant access to anything once the 0006 policies are in place.
(function () {
  const URL = "https://xxcwyttfhqnhuelkkimu.supabase.co";
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4Y3d5dHRmaHFuaHVlbGtraW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4ODc3NzIsImV4cCI6MjEwMzQ2Mzc3Mn0.t7EgPug7NaRkRBjLjtCc-opcRHd0MaIE-r3CsYexAsc";
  const SITE_ROOT = "https://piekachu.github.io/workout-tracker/";
  const STORAGE_KEY = "sb-xxcwyttfhqnhuelkkimu-auth-token";

  // Old per-page globals, kept so nothing that still reads them breaks.
  window.SUPABASE_URL = URL;
  window.SUPABASE_ANON_KEY = ANON_KEY;

  const client = window.supabase.createClient(URL, ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let accessToken = null;
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  // Hide page content until we know whether there is a session, so a signed-in
  // reload doesn't flash the login card (or a signed-out visit flash the app).
  const style = document.createElement("style");
  style.textContent = `
    html[data-auth="pending"] body > *:not(#auth-overlay),
    html[data-auth="out"] body > *:not(#auth-overlay) { visibility: hidden !important; }
    #auth-overlay { position: fixed; inset: 0; z-index: 2147483000; display: none; align-items: center;
      justify-content: center; padding: 20px; background: var(--bg, #F6F5F1); color: var(--text, #1A1B1F);
      font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    html[data-auth="out"] #auth-overlay { display: flex; }
    #auth-overlay .card { width: 100%; max-width: 360px; background: var(--surface, #fff);
      border: 1px solid var(--border, #DEDBD2); border-radius: 14px; padding: 28px 22px 24px;
      box-shadow: 0 2px 20px rgba(26,27,31,.08); }
    #auth-overlay h1 { margin: 0 0 6px; font-family: var(--font-display, Georgia, serif); font-size: 26px; font-weight: 600; }
    #auth-overlay p { margin: 0 0 18px; color: var(--text-dim, #6B6C72); font-size: 14px; line-height: 1.45; }
    #auth-overlay input { width: 100%; box-sizing: border-box; height: 52px; padding: 0 14px; font-size: 16px;
      border: 1px solid var(--border, #DEDBD2); border-radius: 10px; background: var(--bg, #F6F5F1);
      color: inherit; margin-bottom: 12px; }
    #auth-overlay button.primary { width: 100%; height: 52px; font-size: 16px; font-weight: 600; border: 0;
      border-radius: 10px; background: var(--accent, #3457D5); color: #fff; cursor: pointer; }
    #auth-overlay button.primary:disabled { opacity: .55; cursor: default; }
    #auth-overlay button.link { background: none; border: 0; padding: 12px 0 0; color: var(--text-dim, #6B6C72);
      font-size: 14px; text-decoration: underline; cursor: pointer; min-height: 44px; }
    #auth-overlay .msg { min-height: 20px; margin: 4px 0 0; font-size: 13px; color: var(--danger, #D64545); }
    #auth-overlay .msg.ok { color: var(--text-dim, #6B6C72); }
    .auth-signout { margin-left: auto; font: inherit; font-size: 13px; color: var(--text-dim, #6B6C72);
      background: none; border: 0; padding: 6px 10px; cursor: pointer; min-height: 32px; }
    .auth-signout:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);

  // A sign-in link lands here with the tokens (or an error) in the URL hash.
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const linkError = hash.get("error_description");
  const hasCachedSession = () => {
    try { return !!localStorage.getItem(STORAGE_KEY) || hash.has("access_token"); } catch { return false; }
  };
  const setState = (s) => { document.documentElement.dataset.auth = s; };

  // ---- login card ----
  const HELP = "This site is private. Enter your email and we'll send you a sign-in link.";
  let overlay;
  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.id = "auth-overlay";
    overlay.innerHTML = `
      <div class="card">
        <h1>Sign in</h1>
        <p id="auth-help">${HELP}</p>
        <form id="auth-email-form">
          <input id="auth-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off"
                 placeholder="you@example.com" required>
          <button class="primary" type="submit">Email me a sign-in link</button>
        </form>
        <div id="auth-sent" hidden>
          <button class="link" type="button" id="auth-back">Use a different email</button>
        </div>
        <div class="msg" id="auth-msg" role="status"></div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = (id) => overlay.querySelector("#" + id);
    const emailForm = $("auth-email-form"), sent = $("auth-sent");
    const msg = (t, ok) => { $("auth-msg").textContent = t || ""; $("auth-msg").className = "msg" + (ok ? " ok" : ""); };
    if (linkError) msg(linkError.replace(/\+/g, " ") + " Request a new link.");

    emailForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("auth-email").value.trim();
      const btn = emailForm.querySelector("button"); btn.disabled = true; msg("");
      const { error } = await client.auth.signInWithOtp({
        email, options: { shouldCreateUser: true, emailRedirectTo: SITE_ROOT },
      });
      btn.disabled = false;
      if (error) { msg(error.message); return; }
      emailForm.hidden = true; sent.hidden = false;
      $("auth-help").textContent = `Check ${email} and tap the link, on this device. It can take a minute.`;
    });

    $("auth-back").addEventListener("click", () => {
      sent.hidden = true; emailForm.hidden = false; msg("");
      $("auth-help").textContent = HELP;
    });
  }

  // ---- sign-out button, dropped into the shared nav where one exists ----
  function addSignOut() {
    const nav = document.querySelector(".site-nav-in") || document.querySelector(".site-nav");
    if (!nav || nav.querySelector(".auth-signout")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "auth-signout"; b.textContent = "Sign out";
    b.addEventListener("click", () => Auth.signOut());
    nav.appendChild(b);
  }

  client.auth.onAuthStateChange((_event, session) => { accessToken = session ? session.access_token : null; });

  setState(hasCachedSession() ? "pending" : "out");

  function boot() {
    buildOverlay();
    client.auth.getSession().then(({ data }) => {
      const session = data && data.session;
      accessToken = session ? session.access_token : null;
      if (session) { setState("in"); addSignOut(); resolveReady(session); }
      else setState("out");
    });
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);

  window.Auth = {
    client,
    // Resolves with the session once signed in; never resolves while signed out.
    ready,
    // Current access token for code that talks to PostgREST with raw fetch().
    token: () => accessToken,
    async signOut() {
      await client.auth.signOut();
      location.reload();
    },
  };
})();
