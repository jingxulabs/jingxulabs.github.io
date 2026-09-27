/* ═══════════════════════════════════════════════════════════
   Sky: a static star field with meteors arriving as observations,
   each one spending itself as a burst where it meets the horizon.
   Motion budget for the whole site is spent here and in the horizon
   curve. Nothing below the fold animates on scroll.
   ═══════════════════════════════════════════════════════════ */

(() => {
  const hero   = document.getElementById('sky');
  const canvas = document.getElementById('starfield');
  if (!hero || !canvas) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const NIGHT = '#0D1526';
  // Stars run warm, from a cream at the faint end to an amber near the
  // ochre accent at the bright end. The warmth tracks size, so the stars
  // that carry are the ones that show the colour.
  const STAR_COOL = [255, 246, 222];
  const STAR_WARM = [252, 200, 118];
  const TRAIL = '235, 180, 84';
  const HEAD  = '255, 246, 224';
  // One shell, one colour: a burst draws its three tones from a single
  // family, so it reads as a firework rather than as confetti, and the
  // family changes from hit to hit. Gold is the sky's own accent and comes
  // up most often; indigo is the page's other one. Ice and rose are the
  // two that are not in the palette, and are what make the set read as
  // colour rather than as one warm note.
  const SHELLS = [
    { hot: '255, 238, 178', mid: '255, 201,  94', low: '226, 150,  58', w: 0.34 },  // gold
    { hot: '223, 229, 255', mid: '154, 168, 250', low: '108, 121, 206', w: 0.24 },  // indigo
    { hot: '255, 255, 255', mid: '198, 228, 252', low: '128, 176, 222', w: 0.21 },  // ice
    { hot: '255, 228, 236', mid: '255, 149, 178', low: '221,  94, 136', w: 0.21 }   // rose
  ];

  // A burst is the most expensive thing on the page, so it is rationed:
  // one full one at a time, a token one for hits that land during the hold.
  const BURST_HOLD = 620;    // ms before another full burst is allowed
  const SPARK_CAP  = 620;    // live particles, a hard ceiling for slow devices
  const GRAVITY    = 0.0001;

  let W = 0, H = 0, stars = [], meteors = [], sparks = [], flashes = [];
  let raf = null, last = 0, nextSpawn = 700, onScreen = true, burstHold = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
    measureHorizon();
    if (reduced.matches) drawStatic();
  }

  /* ─── The horizon as an obstacle ───
     The curve is an SVG polyline in its own coordinates, stretched to the
     hero's width by preserveAspectRatio="none". Its points are read from
     the path in the document rather than restated here, so editing the
     curve's shape moves where meteors land without touching this file. */

  const horizonSvg  = hero.querySelector('.sky__horizon');
  const horizonPath = hero.querySelector('.horizon__curve');
  const VB_W = 1200, VB_H = 200;   // the path's viewBox

  const CURVE = (() => {
    const n = ((horizonPath && horizonPath.getAttribute('d')) || '').match(/-?\d*\.?\d+/g);
    if (!n || n.length < 4) return [];
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: +n[i], y: +n[i + 1] });
    return pts;
  })();

  let hzTop = 0, hzH = 0;

  function measureHorizon() {
    if (!horizonSvg) { hzH = 0; return; }
    const r = horizonSvg.getBoundingClientRect();
    hzTop = r.top - hero.getBoundingClientRect().top;
    hzH   = r.height;
  }

  const toCanvasY = (vy) => hzTop + (vy / VB_H) * hzH;

  // Canvas y of the curve at canvas x, or Infinity where there is no line
  // to hit — nothing then collides, and the sky behaves as it always did.
  function horizonY(x) {
    if (!CURVE.length || !hzH || !W) return Infinity;
    const vx = (x / W) * VB_W;
    if (vx <= CURVE[0].x) return toCanvasY(CURVE[0].y);
    for (let i = 1; i < CURVE.length; i++) {
      if (vx <= CURVE[i].x) {
        const a = CURVE[i - 1], b = CURVE[i];
        const t = (vx - a.x) / ((b.x - a.x) || 1);
        return toCanvasY(a.y + (b.y - a.y) * t);
      }
    }
    return toCanvasY(CURVE[CURVE.length - 1].y);
  }

  function seedStars() {
    const target = Math.min(Math.round((W * H) / 2400), 520);
    stars = Array.from({ length: target }, () => {
      // Skewed toward the small: a field needs many faint ones to read as
      // depth, and a few that carry, rather than a uniform spatter.
      const m = Math.pow(Math.random(), 1.7);
      // Warmth follows size, with enough jitter that the field is not a
      // gradient: a small star can still be amber, a large one still cream.
      const w = Math.min(1, Math.max(0, m * 0.7 + rand(0, 0.4)));
      return {
        x: Math.random() * W,
        y: Math.random() * H * 0.94,
        r: 0.55 + m * 1.5,
        a: 0.46 + m * 0.54,
        halo: m > 0.62,
        tone: STAR_COOL.map((c, i) => Math.round(c + (STAR_WARM[i] - c) * w)).join(', '),
        // Twinkle is barely perceptible by design — a field, not a light show.
        p: Math.random() * Math.PI * 2,
        s: rand(0.0004, 0.0013)
      };
    });
  }

  // Real showers radiate: every trail points away from one spot on the sky.
  // That is what gives the directions their variety and their coherence.
  const RADIANT = () => ({ x: W * 0.82, y: -H * 0.45 });

  function spawnMeteor() {
    // Scale varies per meteor: a uniform shower reads as an effect,
    // a mixed one reads as a sky.
    const scale = rand(0.55, 1.7);
    const speed = rand(0.30, 0.58) * (0.7 + scale * 0.4);

    const r = RADIANT();
    const x = rand(-W * 0.1, W * 1.1);
    const y = rand(-H * 0.12, H * 0.85);

    let dx = x - r.x, dy = y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;

    // Jitter off the true radial so the fan isn't mechanically perfect.
    const j = rand(-0.22, 0.22), cj = Math.cos(j), sj = Math.sin(j);
    return {
      x, y,
      vx: (dx * cj - dy * sj) * speed,
      vy: (dx * sj + dy * cj) * speed,
      len: rand(110, 260) * scale,
      scale,
      age: 0,
      life: rand(1900, 3200)
    };
  }

  function drawStars(t) {
    for (const s of stars) {
      const a = reduced.matches ? s.a : s.a * (0.72 + 0.28 * Math.sin(s.p + t * s.s));
      // The ones that carry get a soft halo, which is most of what makes a
      // star read as a light rather than as a dot of paint. Two fills, no
      // gradient per star: the field is redrawn every frame.
      if (s.halo) {
        ctx.fillStyle = `rgba(${s.tone}, ${(a * 0.12).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${s.tone}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMeteor(m) {
    // Quick fade in, a long bright plateau, then out. The plateau is what
    // keeps a shower looking populated rather than flickering.
    const k = m.age / m.life;
    const alpha = Math.min(k / 0.12, 1) * (1 - Math.max(0, (k - 0.65) / 0.35));
    if (alpha <= 0) return;

    const s = m.scale || 1;
    const mag = Math.hypot(m.vx, m.vy) || 1;
    const tx = m.x - (m.vx / mag) * m.len;
    const ty = m.y - (m.vy / mag) * m.len;

    const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
    g.addColorStop(0,    `rgba(${HEAD},  ${alpha.toFixed(3)})`);
    g.addColorStop(0.12, `rgba(${TRAIL}, ${alpha.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(${TRAIL}, ${(alpha * 0.42).toFixed(3)})`);
    g.addColorStop(1,    `rgba(${TRAIL}, 0)`);

    ctx.strokeStyle = g;
    ctx.lineWidth = 1.35 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // White-hot head — what actually makes a meteor read as one.
    ctx.fillStyle = `rgba(${HEAD}, ${(alpha * 0.9).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 1.15 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ─── Impact ───
     A meteor that reaches the curve is spent there: it becomes a burst
     rather than crossing onto the paper. Sparks radiate with an upward
     bias and gravity brings them back down, so the shape is a fountain
     over the horizon and not a symmetrical ball. */

  function pickShell() {
    let r = Math.random();
    for (const s of SHELLS) { r -= s.w; if (r <= 0) return s; }
    return SHELLS[0];
  }

  function burst(x, y, scale) {
    // Full bursts are rate limited. A hit arriving inside the hold still
    // registers, as a handful of sparks, so the cause stays visible.
    const full = burstHold <= 0 && sparks.length < SPARK_CAP;
    const n = full ? Math.round(rand(46, 64) * (0.7 + scale * 0.3)) : Math.round(rand(7, 11));
    const shell = pickShell();
    if (full) {
      burstHold = BURST_HOLD;
      flashes.push({ x, y, age: 0, life: 380, scale, shell });
    }

    for (let i = 0; i < n; i++) {
      const a  = rand(0, Math.PI * 2);
      // Speeds spread wide on purpose: the slow ones hold the centre bright
      // while the fast ones carry the burst out to its full width.
      const sp = rand(0.10, 0.42) * (0.75 + scale * 0.35) * (full ? 1 : 0.6);
      const t  = Math.random();
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.74 - 0.06,   // flattened, and thrown upward
        age: 0,
        life: rand(1050, 1750) * (full ? 1 : 0.65),
        r: rand(1, 2.4) * (0.8 + scale * 0.2),
        tone: t < 0.22 ? shell.hot : t < 0.74 ? shell.mid : shell.low
      });
    }
  }

  function drawFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += dt;
      if (f.age > f.life) { flashes.splice(i, 1); continue; }
      const k = f.age / f.life;
      const s = f.shell;
      const r = (16 + 86 * k) * f.scale;
      const a = (1 - k) * 0.8;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0,    `rgba(${s.hot}, ${a.toFixed(3)})`);
      g.addColorStop(0.35, `rgba(${s.mid}, ${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${s.low}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();

      // The shell edge, opening ahead of the sparks. It is what makes the
      // hit legible as one event rather than as particles appearing.
      ctx.strokeStyle = `rgba(${s.mid}, ${(a * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1.6 * (1 - k) + 0.3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * 0.86, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawSparks(dt) {
    ctx.lineCap = 'round';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age > s.life) { sparks.splice(i, 1); continue; }
      s.vy += GRAVITY * dt;
      s.x  += s.vx * dt;
      s.y  += s.vy * dt;

      // Holds its brightness, then drops away: sparks, not a slow dissolve.
      const k = s.age / s.life;
      const a = Math.pow(1 - k, 1.4);
      // Streaked along its own velocity, so fast sparks are longest and the
      // burst has the grain of the meteor that made it.
      const hx = s.x - s.vx * 56, hy2 = s.y - s.vy * 56;

      // Two passes: a wide dim one that carries against the night sky, and
      // the bright core inside it. Cheaper and steadier than a shadow blur.
      ctx.strokeStyle = `rgba(${s.tone}, ${(a * 0.22).toFixed(3)})`;
      ctx.lineWidth = s.r * 3.4;
      ctx.beginPath();
      ctx.moveTo(hx, hy2);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${s.tone}, ${a.toFixed(3)})`;
      ctx.lineWidth = s.r;
      ctx.beginPath();
      ctx.moveTo(hx, hy2);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
  }

  function frame(now) {
    const dt = Math.min(now - last, 50);
    last = now;
    if (burstHold > 0) burstHold -= dt;

    ctx.fillStyle = NIGHT;
    ctx.fillRect(0, 0, W, H);
    drawStars(now);

    nextSpawn -= dt;
    if (nextSpawn <= 0 && meteors.length < 22) {
      meteors.push(spawnMeteor());
      nextSpawn = rand(110, 420);
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.age += dt;
      const prevY = m.y;
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      // Descending across the curve, from above it, within the frame: a hit.
      // Meteors that spawn below the curve never satisfy the first test.
      if (m.vy > 0 && m.x >= 0 && m.x <= W) {
        const hy = horizonY(m.x);
        if (prevY < hy && m.y >= hy) {
          burst(m.x, hy, m.scale || 1);
          meteors.splice(i, 1);
          continue;
        }
      }

      if (m.age > m.life || m.x < -m.len || m.y > H + m.len) meteors.splice(i, 1);
      else drawMeteor(m);
    }

    drawSparks(dt);
    drawFlashes(dt);

    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    ctx.fillStyle = NIGHT;
    ctx.fillRect(0, 0, W, H);
    drawStars(0);
    // Frozen streaks: the shower is still legible without motion.
    [[0.82, 0.14, 1.4], [0.55, 0.28, 0.8], [0.93, 0.48, 1.1], [0.34, 0.52, 0.6],
     [0.68, 0.62, 1.25], [0.2, 0.2, 0.9], [0.46, 0.08, 0.7]].forEach(([fx, fy, s]) => {
      drawMeteor({ x: W * fx, y: H * fy, vx: -0.5, vy: 0.3, len: 190 * s, scale: s, age: 500, life: 2000 });
    });
  }

  function start() { if (!raf && onScreen && !reduced.matches) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  // Bursts are discarded rather than frozen: coming back to the hero should
  // not resume a shower of half-finished sparks from minutes ago.
  function stop()  { if (raf) { cancelAnimationFrame(raf); raf = null; } sparks = []; flashes = []; burstHold = 0; }

  // Costs nothing once the hero has scrolled away.
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? start() : stop(); },
                           { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  reduced.addEventListener('change', () => { stop(); reduced.matches ? drawStatic() : start(); });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); });

  resize();
  start();
})();


/* ═══════════════════════════════════════════════════════════
   Section index: marks where you are, and flips to the sky palette
   while the hero is on screen.
   ═══════════════════════════════════════════════════════════ */

(() => {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll('a'));
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));

  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute('aria-current'));
      const a = byId.get(e.target.id);
      if (a) a.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });

  // Only top-level entries drive the active marker; a nested project link
  // would fight its own section for it.
  links.filter((a) => !a.classList.contains('nav__sub')).forEach((a) => {
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) spy.observe(el);
  });

  const hero = document.getElementById('sky');
  if (hero) {
    new IntersectionObserver(
      ([e]) => nav.classList.toggle('nav--onsky', e.intersectionRatio > 0.45),
      { threshold: [0, 0.45, 1] }
    ).observe(hero);
  }

  // A link to a section the reader has collapsed should open it, otherwise
  // the jump lands on a closed header with nothing under it.
  const reveal = (id) => {
    const target = document.getElementById(id);
    if (!target) return null;
    // Open the target's own disclosure and every one it sits inside, so a
    // link to a nested project does not land on a closed section.
    const own = target.querySelector('details');
    if (own) own.open = true;
    let up = target.closest('details');
    while (up) {
      up.open = true;
      up = up.parentElement && up.parentElement.closest('details');
    }
    return target;
  };

  links.forEach((a) => a.addEventListener('click', () => reveal(a.getAttribute('href').slice(1))));

  if (location.hash.length > 1) {
    const t = reveal(decodeURIComponent(location.hash.slice(1)));
    if (t) requestAnimationFrame(() => t.scrollIntoView());
  }
})();


/* ═══════════════════════════════════════════════════════════
   Audio. Spotify's widget, displayed as supplied.

   Looping, from measured behaviour rather than assumption:
     1. At the end Spotify emits {position: duration, isPaused: false}
        and then stops emitting. It never reports a pause.
     2. Once a clip has genuinely ended, a programmatic resume is refused
        under a real browser's autoplay policy.
   So the loop PRE-EMPTS the end: it rewinds ~1.4s early, while playback
   is still live, and the ended state never occurs. A watchdog covers the
   case where updates simply stop without the pre-empt catching them.

   The rewind then holds LOOP_GAP of silence before playing again, so the
   track lands rather than seams straight back into itself. The pause is
   what buys the silence; the seek is what makes the resume legal, since
   the widget is paused mid-track and not at an ended one.

   Append ?audiodebug to the URL for a live readout of what the player
   actually reports.
   ═══════════════════════════════════════════════════════════ */

const TRACK_URI = 'spotify:track:3AJwUDP919kvQ9QcozQPxg';   // Coldplay, Yellow
const LOOP_GAP  = 2000;   // ms of silence between the last note and the first

window.onSpotifyIframeApiReady = (IFrameAPI) => {
  const mount = document.getElementById('spotifyMount');
  if (!mount) return;

  const debug = /[?&]audiodebug/.test(location.search);
  const panel = debug ? document.createElement('pre') : null;
  if (panel) { panel.className = 'audio-debug'; document.body.appendChild(panel); }

  IFrameAPI.createController(
    mount,
    { uri: TRACK_URI, width: '100%', height: 80, theme: 0 },
    (controller) => {
      let restarting = false;
      let pos = 0, dur = 0, seen = 0, events = 0, loops = 0, last = '';

      const show = () => {
        if (!panel) return;
        panel.textContent = events === 0
          ? 'audio debug\nwaiting for you to press play'
          : `pos    ${(pos / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s\n` +
            `events ${events}\n` +
            `loops  ${loops}\n` +
            `last   ${last || '-'}\n` +
            `gap    ${restarting ? `holding ${LOOP_GAP}ms` : '-'}`;
      };

      const rewind = (why) => {
        restarting = true;
        loops++; last = why;
        // Pause first so the silence starts at once, then park at zero: the
        // widget reads 0:00 through the gap instead of showing a stalled tail.
        try { controller.pause(); } catch (_) {}
        controller.seek(0);
        setTimeout(() => { try { controller.play(); } catch (_) {} }, LOOP_GAP);
        // Pausing deliberately means the resume is a start, not a continue, so
        // it is the one call that could be refused. If it was, the position is
        // still at zero a second later: try once more rather than sit silent.
        setTimeout(() => { if (pos < 600) { try { controller.play(); } catch (_) {} } }, LOOP_GAP + 1200);
        // Held past the resume so neither the pre-empt nor the watchdog can
        // fire into the gap, when no updates are arriving by design.
        setTimeout(() => { restarting = false; }, LOOP_GAP + 1500);
        show();
      };

      controller.addListener('playback_update', (e) => {
        pos = e.data.position;
        dur = e.data.duration || dur;
        seen = performance.now();
        events++;
        show();
        if (!dur || restarting) return;
        if (pos >= dur - 1400) rewind('pre-empt');
      });

      setInterval(() => {
        if (!dur || !seen || restarting) return;
        if (performance.now() - seen > 2600 && pos > dur * 0.5) rewind('watchdog');
      }, 1000);

      show();
    }
  );
};

// If Spotify's API never loads, fall back to a plain link.
setTimeout(() => {
  const frame = document.getElementById('spotifyFrame');
  if (frame && !frame.querySelector('iframe')) {
    document.getElementById('player').classList.add('player--fallback');
  }
}, 5000);
