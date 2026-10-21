// Shared app chrome (sidebar, top bar, phone tab bar) for every signed-in
// page. Runs synchronously before the page's own script, so elements the page
// looks up by id (#whoami, #logout) already exist. <body data-page data-role>
// says which nav item is current and which nav to show; data-role="auto"
// waits for the page to call StayCrew.setRole() once it knows.

(function () {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M8 7h4M8 11h4M8 15h4"/><path d="M2 21h20"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13h.01M15 13h.01"/><path d="M9.5 16.5h5"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9 17h6v4H9z"/>',
  };

  function icon(name, cls) {
    return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  }

  const LOGO =
    '<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="var(--green-900)"/>' +
    '<path d="M9 20.5 20 11l11 9.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M26.5 13.2V10h2.6v5.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<path d="M20 17.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="var(--gold-400)"/></svg>';

  const NAV = {
    admin: [
      ["admin", "/admin.html", "Dashboard", "sliders"],
      ["cleaners", "/cleaners.html", "Cleaners", "users"],
      ["properties", "/properties.html", "Properties", "building"],
      ["reviews", "/reviews.html", "Reviews", "star"],
      ["home", "/home.html", "Assistant", "chat"],
    ],
    cleaner: [
      ["cleaner", "/cleaner.html", "My properties", "building"],
      ["home", "/home.html", "Assistant", "chat"],
    ],
  };

  const CAPS = { legend: 5, awesome: 3, normal: 0 };

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  function initials(name) {
    const parts = String(name ?? "?").trim().split(/[\s._-]+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
    return letters.toUpperCase();
  }

  function avatar(name, opts = {}) {
    return `<span class="avatar${opts.me ? " me" : ""}${opts.size ? " " + opts.size : ""}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
  }

  function tierBadge(rank) {
    const r = ["legend", "awesome", "normal"].includes(rank) ? rank : "normal";
    const star = r === "legend" ? icon("star", "fill") : "";
    return `<span class="pill ${r}">${star}${escapeHtml(r)}</span>`;
  }

  function slotDots(used, cap) {
    if (!cap) return `<span class="slot-dots none">No slots</span>`;
    let dots = "";
    for (let i = 0; i < cap; i++) dots += `<i class="${i < used ? "on" : ""}"></i>`;
    return `<span class="slot-dots${used >= cap ? " full" : ""}" title="${used} of ${cap} slots used"><span class="dots">${dots}</span><span class="frac">${used}/${cap}</span></span>`;
  }

  const page = document.body.dataset.page ?? "";
  let role = document.body.dataset.role ?? "auto";

  const app = document.createElement("div");
  app.className = "app";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <a class="brand" href="/home.html" aria-label="StayCrew home">${LOGO}
      <span class="brand-text"><strong>StayCrew</strong><small>Field operations</small></span>
    </a>
    <div class="meter-card" id="shell-meter" hidden>
      <div class="meter-head"><span id="shell-meter-label"></span><span class="meter-note" id="shell-meter-note"></span></div>
      <div class="meter-row"><span class="segments" id="shell-meter-bar"></span><span class="meter-frac" id="shell-meter-frac"></span></div>
    </div>
    <nav class="side-nav" id="shell-nav" aria-label="Main"></nav>
    <a class="about-card" href="/readme/">${icon("shield")}<span><small>How it works</small>About this app</span>${icon("info", "trail")}</a>
  `;

  const main = document.createElement("div");
  main.className = "main";

  const topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div class="top-left">
      <span class="live-chip" id="shell-live" hidden><span class="dot"></span><span id="shell-live-text">Live</span></span>
      <span class="top-crumb">${icon("pin")}<span id="shell-crumb"></span></span>
    </div>
    <div class="top-right">
      <span id="shell-tier"></span>
      <span class="user-chip"><span class="user-text"><span id="whoami">loading…</span><small id="shell-role"></small></span><span id="shell-avatar">${avatar("?")}</span></span>
      <button id="logout" type="button" class="ghost icon-text">${icon("logout")}<span>Sign out</span></button>
    </div>
  `;

  const content = document.createElement("main");
  content.className = "content";
  content.id = "content";

  const mobileNav = document.createElement("nav");
  mobileNav.className = "mobile-nav";
  mobileNav.setAttribute("aria-label", "Main");

  // Move the page's own markup into the content column, keeping scripts in body.
  const pageNodes = [...document.body.childNodes].filter((n) => n.nodeName !== "SCRIPT");
  for (const node of pageNodes) content.appendChild(node);

  main.append(topbar, content);
  app.append(sidebar, main);
  document.body.prepend(app, mobileNav);

  function renderNav() {
    const items = NAV[role] ?? [];
    const html = items
      .map(
        ([key, href, label, ic]) =>
          `<a href="${href}"${key === page ? ' aria-current="page"' : ""}>${icon(ic)}<span>${escapeHtml(label)}</span></a>`,
      )
      .join("");
    document.getElementById("shell-nav").innerHTML = html;
    mobileNav.innerHTML = html;
    mobileNav.hidden = items.length === 0;
    const current = items.find(([key]) => key === page);
    document.getElementById("shell-crumb").textContent = current ? current[2] : "";
  }

  renderNav();

  window.StayCrew = {
    icon,
    avatar,
    initials,
    tierBadge,
    slotDots,
    escapeHtml,
    capFor: (rank) => CAPS[rank] ?? 0,

    setRole(next) {
      role = next;
      document.body.dataset.role = next;
      renderNav();
    },

    setUser(name, userRole, rank) {
      document.getElementById("whoami").textContent = name;
      document.getElementById("shell-role").textContent = userRole === "admin" ? "Admin" : "Cleaner";
      document.getElementById("shell-avatar").innerHTML = avatar(name, { me: true });
      document.getElementById("shell-tier").innerHTML = rank ? tierBadge(rank).replace('class="pill', 'class="pill lg') : "";
    },

    setMeter({ label, used, total, note }) {
      const meter = document.getElementById("shell-meter");
      meter.hidden = false;
      document.getElementById("shell-meter-label").textContent = label;
      document.getElementById("shell-meter-note").textContent = note ?? "";
      document.getElementById("shell-meter-frac").textContent = `${used}/${total}`;
      const count = Math.max(1, Math.min(total, 10));
      const filled = total ? Math.round((used / total) * count) : 0;
      let segs = "";
      for (let i = 0; i < count; i++) segs += `<i class="${i < filled ? "on" : ""}"></i>`;
      document.getElementById("shell-meter-bar").innerHTML = segs;
    },
  };

  // Connection state from realtime.js, on pages that load it.
  if (typeof window.onRealtimeStatus === "function") {
    const chip = document.getElementById("shell-live");
    const text = document.getElementById("shell-live-text");
    window.onRealtimeStatus((connected) => {
      chip.hidden = false;
      chip.classList.toggle("off", !connected);
      text.textContent = connected ? "Live" : "Reconnecting";
    });
  }
})();
