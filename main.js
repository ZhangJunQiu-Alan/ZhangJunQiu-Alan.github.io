(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const stage = $("#stage");
  const scroller = $("#scroller");
  const bar = $("#bar");
  const countNow = $("#count-now");
  const panels = $$(":scope > .panel", stage);
  const N = panels.length;
  const TRANSITION = 1; // viewport heights per split
  const wantsSplit = () => !reduce && innerWidth >= 900 && innerHeight >= 600;

  let mode = root.classList.contains("split") ? "split" : "flow";
  let vh = innerHeight;
  let starts = [];
  let introDone = false;
  let scrollY = 0;
  let direction = 1;
  let velocity = 0;
  let active = -1;
  let flowObserver = null;

  history.scrollRestoration = "manual";
  scrollTo(0, 0);

  /* ---------- line splitting for [data-lines] ---------- */
  function splitLines() {
    for (const el of $$(".panel > .panel-inner [data-lines]")) {
      const text = el.dataset.text ?? (el.dataset.text = el.textContent.trim().replace(/\s+/g, " "));
      el.textContent = "";
      const tokens = [];
      text.split(" ").forEach((w, k, all) => {
        const sp = k < all.length - 1 ? " " : "";
        const g = /[㐀-鿿]/.test(w) ? w.match(/[^㐀-鿿]*[㐀-鿿][，。、：；！？）」』》”’…—]*|[^㐀-鿿]+/g) : [w];
        g[g.length - 1] += sp;
        tokens.push(...g);
      });
      const words = tokens.map((w) => {
        const s = document.createElement("span");
        s.textContent = w;
        el.append(s);
        return s;
      });
      const lines = [];
      let top = null;
      for (const w of words) {
        if (w.offsetTop !== top) { lines.push([]); top = w.offsetTop; }
        lines.at(-1).push(w.textContent);
      }
      el.textContent = "";
      lines.forEach((ws, i) => {
        const line = document.createElement("span");
        line.className = "line";
        const inner = document.createElement("span");
        inner.className = "line-in";
        inner.style.setProperty("--i", i);
        inner.textContent = ws.join("").trimEnd();
        line.append(inner);
        el.append(line);
      });
    }
  }

  /* ---------- tear clones ---------- */
  function buildTears() {
    panels.forEach((p, i) => {
      p.querySelector(":scope > .tear")?.remove();
      p._inner = p.querySelector(":scope > .panel-inner");
      if (mode !== "split" || i === N - 1) return;
      const tear = document.createElement("div");
      tear.className = "tear";
      tear.setAttribute("aria-hidden", "true");
      tear.inert = true;
      for (const side of ["top", "bot"]) {
        const half = document.createElement("div");
        half.className = `half ${side}`;
        const copy = p._inner.cloneNode(true);
        copy.removeAttribute("id");
        for (const e of copy.querySelectorAll("[id]")) e.removeAttribute("id");
        for (const e of copy.querySelectorAll("a, button")) e.tabIndex = -1;
        half.append(copy);
        tear.append(half);
        p[side === "top" ? "_top" : "_bot"] = half;
      }
      p.append(tear);
    });
    for (const p of panels) {
      p._items = $$(".c[data-from]", p).map((el) => {
        const [x, y, r, s] = el.dataset.from.split(" ").map(Number);
        const siblings = [...el.parentElement.querySelectorAll(":scope > .c[data-from]")];
        return { el, x, y, r, s, j: siblings.indexOf(el) };
      });
      p._strips = $$(".film-strip", p);
      p._marquees = $$(".marquee-track", p);
    }
  }

  function layout() {
    vh = innerHeight;
    if (mode !== "split") { scroller.style.height = "0px"; return; }
    let y = 0;
    starts = [];
    panels.forEach((p, i) => {
      starts.push(y);
      p._dwell = (parseFloat(p.dataset.dwell) || 0) * vh;
      y += p._dwell + (i < N - 1 ? TRANSITION * vh : 0);
      const strip = p._strips[0];
      p._stripMax = strip ? Math.max(0, strip.scrollWidth - innerWidth) : 0;
    });
    scroller.style.height = `${y + vh}px`;
  }

  /* ---------- per-panel progress (collage + film strip) ---------- */
  function setProgress(p, q) {
    for (const it of p._items) {
      const k = easeOut(clamp((q - it.j * 0.07) / 0.62));
      const drift = (0.5 - q) * (3 + it.j * 2.2);
      const inv = 1 - k;
      it.el.style.transform =
        `translate3d(${it.x * inv}vw, calc(${it.y * inv}vh + ${drift}vh), 0) rotate(${it.r * inv}deg) scale(${1 + (it.s - 1) * inv})`;
    }
    for (const strip of p._strips) {
      const x = 6 - q * 6;
      strip.style.transform = `translate3d(calc(${x}vw - ${q * p._stripMax}px), 0, 0)`;
    }
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    countNow.textContent = String(i + 1).padStart(2, "0");
  }

  /* ---------- the split renderer ---------- */
  function render() {
    if (mode !== "split") return;
    const y = scrollY;
    let i = N - 1;
    for (let k = 0; k < N - 1; k++) if (y < starts[k + 1]) { i = k; break; }
    const p = panels[i];
    const local = y - starts[i];
    const q = p._dwell ? clamp(local / p._dwell) : 1;
    const t = i < N - 1 ? clamp((local - p._dwell) / (TRANSITION * vh)) : 0;
    const next = panels[i + 1];

    panels.forEach((el, k) => {
      el.classList.toggle("is-vis", k === i || (k === i + 1 && t > 0));
      el.style.zIndex = String(N - k);
      if (k !== i) el.classList.remove("tearing");
      if (k !== i + 1 && el._inner.style.transform) el._inner.style.transform = "";
    });

    const tearing = t > 0;
    p.classList.toggle("tearing", tearing);
    const e = easeInOut(t);
    if (tearing) {
      p._top.style.transform = `translate3d(0, ${-e * 50}vh, 0)`;
      p._bot.style.transform = `translate3d(0, ${e * 50}vh, 0)`;
    }
    if (next) next._inner.style.transform = tearing && t < 1 ? `scale(${1.07 - 0.07 * easeOut(t)})` : "";

    setProgress(p, q);
    if (next && tearing) setProgress(next, 0);
    for (const m of p._marquees) m.style.transform = `translate3d(${marqueeX}px, 0, 0)`;

    if (introDone) {
      p.classList.add("is-in");
      if (next && t > 0.08) next.classList.add("is-in");
    }

    setActive(next && t > 0.5 ? i + 1 : i);
    const edge = tearing ? (1 - e) * vh / 2 : vh;
    const theme = next && edge < bar.offsetHeight * 0.6 ? next.dataset.theme : p.dataset.theme;
    if (bar.dataset.theme !== theme) bar.dataset.theme = theme;
  }

  /* ---------- flow mode ---------- */
  function setupFlow() {
    for (const p of panels) {
      p.classList.add("is-vis");
      p.classList.remove("tearing");
      p.style.zIndex = "";
      p._inner.style.transform = "";
      for (const it of p._items) it.el.style.transform = "";
    }
    flowObserver?.disconnect();
    flowObserver = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting && introDone) en.target.classList.add("is-in");
    }, { threshold: 0.2 });
    panels.forEach((p) => flowObserver.observe(p));
  }

  function flowTheme() {
    if (mode !== "flow") return;
    const probe = bar.offsetHeight / 2;
    let i = 0;
    panels.forEach((p, k) => { if (p.getBoundingClientRect().top <= probe) i = k; });
    if (bar.dataset.theme !== panels[i].dataset.theme) bar.dataset.theme = panels[i].dataset.theme;
    setActive(i);
  }

  /* ---------- marquee ---------- */
  let marqueeX = 0;
  let marqueeW = 0;
  function measureMarquee() {
    const first = $(".panel > .panel-inner .marquee-track > span");
    marqueeW = first ? first.offsetWidth : 0;
  }
  function tickMarquee(dt) {
    if (!marqueeW) return;
    const heroVisible = mode === "flow" ? panels[0].getBoundingClientRect().bottom > 0 : panels[0].classList.contains("is-vis");
    if (!heroVisible) return;
    const speed = (0.045 + Math.min(Math.abs(velocity), 60) * 0.004) * dt;
    marqueeX -= speed * direction;
    if (marqueeX <= -marqueeW) marqueeX += marqueeW;
    if (marqueeX > 0) marqueeX -= marqueeW;
    for (const m of panels[0]._marquees) m.style.transform = `translate3d(${marqueeX}px, 0, 0)`;
  }

  /* ---------- magnetic buttons ---------- */
  function setupMagnets() {
    if (!finePointer) return;
    for (const el of $$(".panel > .panel-inner .magnet")) {
      const inner = el.querySelector(".magnet-in");
      el.addEventListener("mousemove", (ev) => {
        const r = el.getBoundingClientRect();
        const x = ev.clientX - (r.left + r.width / 2);
        const y = ev.clientY - (r.top + r.height / 2);
        el.classList.add("is-hover");
        el.style.transform = `translate(${x * 0.32}px, ${y * 0.32}px)`;
        inner.style.transform = `translate(${x * 0.16}px, ${y * 0.16}px)`;
      });
      el.addEventListener("mouseleave", () => {
        el.classList.remove("is-hover");
        el.style.transform = "";
        inner.style.transform = "";
      });
    }
  }

  /* ---------- hover preview on the "more work" list ---------- */
  const preview = $("#preview");
  const pv = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  function setupPreview() {
    const rows = $(".panel > .panel-inner #rows");
    if (!finePointer || !rows) return;
    const strip = preview.querySelector(".preview-strip");
    rows.addEventListener("mouseenter", (ev) => {
      pv.x = pv.tx = ev.clientX; pv.y = pv.ty = ev.clientY;
      pv.on = true; preview.classList.add("on");
    });
    rows.addEventListener("mouseleave", () => { pv.on = false; preview.classList.remove("on"); });
    for (const row of rows.querySelectorAll(".row")) {
      row.addEventListener("mouseenter", () => { strip.style.transform = `translateY(${-Number(row.dataset.preview) * 100}%)`; });
    }
    addEventListener("mousemove", (ev) => { pv.tx = ev.clientX; pv.ty = ev.clientY; }, { passive: true });
  }
  function tickPreview() {
    if (!pv.on && !preview.classList.contains("on")) return;
    pv.x += (pv.tx - pv.x) * 0.14;
    pv.y += (pv.ty - pv.y) * 0.14;
    preview.style.transform = `translate3d(${pv.x}px, ${pv.y}px, 0)`;
  }

  /* ---------- navigation ---------- */
  let lenis = null;
  function goTo(n) {
    if (mode === "split") {
      const y = starts[n] ?? 0;
      lenis ? lenis.scrollTo(y, { duration: Math.min(3.2, 1 + Math.abs(y - scrollY) / vh * 0.35) }) : scrollTo(0, y);
    } else {
      const top = panels[n].getBoundingClientRect().top + scrollY;
      lenis ? lenis.scrollTo(top, { duration: 1.4 }) : scrollTo({ top, behavior: "smooth" });
    }
  }
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-goto]");
    if (!a) return;
    ev.preventDefault();
    goTo(Number(a.dataset.goto));
  });

  /* ---------- clock ---------- */
  const clock = $("#clock");
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit" });
  const tickClock = () => { if (clock) clock.textContent = fmt.format(new Date()); };
  tickClock();
  setInterval(tickClock, 15000);

  /* ---------- build / rebuild ---------- */
  function build() {
    mode = wantsSplit() ? "split" : "flow";
    root.classList.toggle("split", mode === "split");
    root.classList.toggle("flow", mode === "flow");
    splitLines();
    buildTears();
    layout();
    measureMarquee();
    if (mode === "split") {
      flowObserver?.disconnect();
      if (scrollY > starts.at(-1) + vh) scrollTo(0, starts.at(-1));
      render();
    } else {
      setupFlow();
      flowTheme();
    }
  }

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const atPanel = active;
      build();
      if (mode === "split" && atPanel >= 0) scrollTo(0, starts[atPanel]);
    }, 160);
  });

  function onScroll(y, dir, vel) {
    if (dir) direction = dir;
    velocity = vel || 0;
    scrollY = y;
    render();
    flowTheme();
  }

  /* ---------- intro ---------- */
  function runIntro(done) {
    const intro = $("#intro");
    if (reduce || !root.classList.contains("intro-on")) { intro.remove(); root.classList.remove("intro-on"); done(); return; }
    lenis?.stop();
    const counts = $$(".intro-count", intro);
    let ready = false;
    Promise.all([document.fonts.ready, ...$$(".panel:first-child img")]).then(() => { ready = true; });
    setTimeout(() => { ready = true; }, 3500);
    const t0 = performance.now();
    let n = 0;
    const step = (now) => {
      const k = clamp((now - t0) / 1500);
      n += ((ready ? k : Math.min(k, 0.88)) * 100 - n) * 0.1;
      const label = String(Math.min(100, Math.round(n))).padStart(3, "0");
      for (const c of counts) c.textContent = label;
      if (ready && k >= 1 && n > 99.4) {
        for (const c of counts) c.textContent = "100";
        intro.classList.add("cut");
        setTimeout(() => {
          intro.classList.add("done");
          setTimeout(done, 350);
          setTimeout(() => { intro.remove(); root.classList.remove("intro-on"); lenis?.start(); }, 1300);
        }, 420);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- start ---------- */
  build();
  setupMagnets();
  setupPreview();

  if (window.Lenis && !reduce) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
    lenis.on("scroll", (l) => onScroll(l.animatedScroll, l.direction, l.velocity));
  } else {
    let last = 0;
    addEventListener("scroll", () => { const y = window.scrollY; onScroll(y, y > last ? 1 : y < last ? -1 : 0, y - last); last = y; }, { passive: true });
  }

  let prev = performance.now();
  const frame = (now) => {
    const dt = Math.min(64, now - prev);
    prev = now;
    lenis?.raf(now);
    tickMarquee(dt);
    tickPreview();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  runIntro(() => {
    introDone = true;
    if (mode === "split") render();
    else for (const p of panels) if (p.getBoundingClientRect().top < innerHeight * 0.8) p.classList.add("is-in");
  });
})();
