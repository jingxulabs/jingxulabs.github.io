/* ═══════════════════════════════════════════════════════════
   Sky: a static star field with meteors arriving as observations.
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
  const STAR  = '242, 239, 230';
  const TRAIL = '235, 180, 84';
  const HEAD  = '255, 246, 224';

  let W = 0, H = 0, stars = [], meteors = [];
  let raf = null, last = 0, nextSpawn = 700, onScreen = true;

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
    if (reduced.matches) drawStatic();
  }

  function seedStars() {
    const target = Math.min(Math.round((W * H) / 3000), 380);
    stars = Array.from({ length: target }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.94,
      r: rand(0.3, 1.35),
      a: rand(0.28, 0.88),
      // Twinkle is barely perceptible by design — a field, not a light show.
      p: Math.random() * Math.PI * 2,
      s: rand(0.0004, 0.0013)
    }));
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
      ctx.fillStyle = `rgba(${STAR}, ${a.toFixed(3)})`;
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

  function frame(now) {
    const dt = Math.min(now - last, 50);
    last = now;

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
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age > m.life || m.x < -m.len || m.y > H + m.len) meteors.splice(i, 1);
      else drawMeteor(m);
    }

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
  function stop()  { if (raf) { cancelAnimationFrame(raf); raf = null; } }

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

  byId.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  });

  const hero = document.getElementById('sky');
  if (hero) {
    new IntersectionObserver(
      ([e]) => nav.classList.toggle('nav--onsky', e.intersectionRatio > 0.45),
      { threshold: [0, 0.45, 1] }
    ).observe(hero);
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

   Append ?audiodebug to the URL for a live readout of what the player
   actually reports.
   ═══════════════════════════════════════════════════════════ */

const TRACK_URI = 'spotify:track:3AJwUDP919kvQ9QcozQPxg';   // Coldplay, Yellow

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
            `last   ${last || '-'}`;
      };

      const rewind = (why) => {
        restarting = true;
        loops++; last = why;
        controller.seek(0);
        setTimeout(() => { try { controller.play(); } catch (_) {} }, 120);
        setTimeout(() => { restarting = false; }, 2500);
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
