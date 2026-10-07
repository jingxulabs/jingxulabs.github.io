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
  const STAR  = '242, 239, 230';
  const TRAIL = '235, 180, 84';
  const HEAD  = '255, 246, 224';
  const SPARK = '255, 212, 106';   // the ochre accent, pushed toward yellow

  // A burst is the most expensive thing on the page, so it is rationed:
  // one full one at a time, a token one for hits that land during the hold.
  const BURST_HOLD = 620;    // ms before another full burst is allowed
  const SPARK_CAP  = 340;    // live particles, a hard ceiling for slow devices
  const GRAVITY    = 0.00012;

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

  /* ─── Impact ───
     A meteor that reaches the curve is spent there: it becomes a burst
     rather than crossing onto the paper. Sparks radiate with an upward
     bias and gravity brings them back down, so the shape is a fountain
     over the horizon and not a symmetrical ball. */

  function burst(x, y, scale) {
    // Full bursts are rate limited. A hit arriving inside the hold still
    // registers, as a handful of sparks, so the cause stays visible.
    const full = burstHold <= 0 && sparks.length < SPARK_CAP;
    const n = full ? Math.round(rand(26, 38) * (0.7 + scale * 0.3)) : Math.round(rand(5, 9));
    if (full) {
      burstHold = BURST_HOLD;
      flashes.push({ x, y, age: 0, life: 300, scale });
    }

    for (let i = 0; i < n; i++) {
      const a  = rand(0, Math.PI * 2);
      const sp = rand(0.08, 0.23) * (0.75 + scale * 0.35) * (full ? 1 : 0.65);
      const t  = Math.random();
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.72 - 0.05,   // flattened, and thrown upward
        age: 0,
        life: rand(780, 1250) * (full ? 1 : 0.7),
        r: rand(0.7, 1.7) * (0.8 + scale * 0.2),
        tone: t < 0.18 ? HEAD : t < 0.8 ? SPARK : TRAIL
      });
    }
  }

  function drawFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += dt;
      if (f.age > f.life) { flashes.splice(i, 1); continue; }
      const k = f.age / f.life;
      const r = (10 + 46 * k) * f.scale;
      const a = (1 - k) * 0.62;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0,    `rgba(${HEAD},  ${a.toFixed(3)})`);
      g.addColorStop(0.45, `rgba(${SPARK}, ${(a * 0.55).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${SPARK}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
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
      const a = Math.pow(1 - k, 1.5);
      // Streaked along its own velocity, so fast sparks are longest and the
      // burst has the grain of the meteor that made it.
      ctx.strokeStyle = `rgba(${s.tone}, ${a.toFixed(3)})`;
      ctx.lineWidth = s.r;
      ctx.beginPath();
      ctx.moveTo(s.x - s.vx * 44, s.y - s.vy * 44);
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


/* ═══════════════════════════════════════════════════════════
   ToolSelection figures, read from the experiment repository.

   Every measured number in #toolselection carries a data-eval key
   instead of being transcribed into the prose. The keys resolve against
   the eval JSON that the pipeline itself wrote, fetched from the repo at
   read time, so the page cannot drift from the data it describes.

   Two deliberate constraints:
     1. The static HTML holds the last known value. A failed fetch leaves
        the page exactly as published rather than showing holes, so this
        degrades to the old behaviour offline.
     2. Nothing is fetched until the section is near the viewport. A
        reader who never scrolls to it pays nothing.

   The derivations below are the page's claims stated as code. Where a
   figure is a macro-average over the five generated splits, that is what
   GEN encodes — the same pooling DATA.md reports, not a re-aggregation.
   ═══════════════════════════════════════════════════════════ */

(() => {
  const section = document.getElementById('toolselection');
  if (!section || !('fetch' in window)) return;

  const REPO = 'jingxulabs/ToolSelection';
  const REF  = 'main';            // tracks the repo; pin to a SHA to freeze
  const BASE = `https://raw.githubusercontent.com/${REPO}/${REF}/`;

  // Only files the derivations actually read. rerank_sweep carries the same
  // depth-100 numbers as fusion_sweep at a hundredth of the size, so the
  // 197 KB sweep is deliberately not fetched.
  const FILES = {
    corpus:   'data/corpus/corpus_stats.json',
    baseline: 'data/eval/retrieval_baseline.json',
    encoder:  'data/eval/encoder_sweep.json',
    rerank:   'data/eval/rerank_sweep.json',
    sig:      'data/eval/significance_backfill.json',
    bm25:     'data/eval/bm25_fusion.json',
    headroom: 'data/eval/doc_quality_headroom.json',
  };

  // The five generated splits the section macro-averages over. dev_A is the
  // MetaTool anchor and is excluded on purpose: pooling it in would mix a
  // benchmark-labelled split into a generated-split mean.
  const GEN = ['standard_L2', 'standard_L3', 'standard_L4',
               'splitD_separable', 'splitD_inseparable'];

  const RERANKER = 'BAAI/bge-reranker-large';
  const DEPTH    = 'depth_100';   // the depth every reranking row is measured at

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  /* ─── Formatters ───
     Each key declares how it reads, so a ratio never renders as a count. */
  const fmt = {
    int:  (v) => v.toLocaleString('en-US'),
    f1:   (v) => v.toFixed(1),
    f3:   (v) => v.toFixed(3),
    sign: (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(3),
    neg:  (v) => '−' + Math.abs(v).toFixed(3),
    pct0: (v) => (v * 100).toFixed(0) + '%',
    pct1: (v) => (v * 100).toFixed(1) + '%',
  };

  /* ─── Derivations ───
     Keyed by the data-eval attribute in the markup. Each returns a raw
     number plus the formatter it should be read through. */
  function derive(d) {
    const cs = d.corpus, enc = d.encoder.runs, rs = d.rerank.splits;
    const pools = d.baseline.test_A.pools;
    const claims = d.sig.tested_claims;
    const dq = d.headroom.POOLED_generated.by_doc_quality;

    // Encoder sweep: four configurations, each a macro-average over GEN.
    const RUN = {
      base: 'MiniLM-L6-v2/v0 (base)',   // shipped baseline
      text: 'all-MiniLM-L6-v2/v3',      // document text only
      enc:  'gte-large/v0',             // encoder only
      both: 'gte-large/v3',             // both, the shipped winner
    };
    const em = (arm, k) => mean(GEN.map((s) => enc[RUN[arm]][s][k]));

    const r100at199  = pools.pool_199.dense['recall@100'];
    const r100at3551 = pools.pool_3551.dense['recall@100'];

    const denseR1   = mean(GEN.map((s) => rs[s].dense['R@1']));
    const replaceR1 = mean(GEN.map((s) => rs[s].rerank[RERANKER][DEPTH]['R@1']));

    const replace = claims['§7 replacement (zscore depth100 a1)'].POOLED_generated;
    const fuse    = claims['§8 fusion (zscore depth100 a0.2)'].POOLED_generated;
    const bm      = d.bm25.significance.POOLED_generated.full_vs_dense;

    const m = {
      'catalog.total':       [cs.catalog_total, 'int'],
      'catalog.labeled':     [cs.labeled_tools, 'int'],
      'catalog.distractors': [cs.catalog_by_source['apis.guru'], 'int'],
      'catalog.ratio':       [cs.distractor_ratio, 'f1'],
      'catalog.pairs':       [cs.intents_total, 'int'],
      'catalog.heldout':     [cs.heldout_tools, 'int'],

      'pool.r100.at199':  [r100at199, 'f3'],
      'pool.r100.at3551': [r100at3551, 'f3'],
      'pool.r100.drop':   [r100at199 - r100at3551, 'neg'],
      'pool.unreachable': [1 - r100at3551, 'pct0'],

      'enc.l3.r10': [enc[RUN.both].standard_L3['R@10'], 'f3'],
      'enc.l4.r10': [enc[RUN.both].standard_L4['R@10'], 'f3'],

      'rr.dense.r1':   [denseR1, 'f3'],
      'rr.replace.r1': [replaceR1, 'f3'],

      'sig.replace.p':    [replace.mcnemar_p, 'f3'],
      'sig.fuse.dmrr':    [fuse.d_mrr, 'sign'],
      'sig.fuse.mrr_lo':  [fuse.mrr_ci95[0], 'sign'],
      'sig.fuse.mrr_hi':  [fuse.mrr_ci95[1], 'sign'],
      'sig.fuse.p':       [fuse.mcnemar_p, 'f3'],

      'bm25.d_r1': [bm['d_R@1'], 'sign'],
      'bm25.p':    [bm.mcnemar_p, 'f3'],

      'dq.weak.items': [dq.dq0_none.share_of_items + dq.dq1_poor.share_of_items, 'pct1'],
      'dq.weak.miss':  [dq.dq0_none['share_of_miss@10'] + dq.dq1_poor['share_of_miss@10'], 'pct1'],
      'dq.good.items': [dq.dq3_4_good.share_of_items, 'pct0'],
      'dq.good.miss':  [dq.dq3_4_good['share_of_miss@10'], 'pct0'],
      'dq.ratio':      [d.headroom.gold_vs_catalog_dq.dq1_poor.representation_ratio, 'f3'],
    };

    for (const [arm, keys] of Object.entries({
      base: 'enc.base', text: 'enc.text', enc: 'enc.enc', both: 'enc.both',
    })) {
      m[`${keys}.r1`]  = [em(arm, 'R@1'), 'f3'];
      m[`${keys}.r10`] = [em(arm, 'R@10'), 'f3'];
      m[`${keys}.r25`] = [em(arm, 'R@25'), 'f3'];
    }
    // The two factors read as deltas against the shared baseline.
    for (const arm of ['enc', 'text', 'both']) {
      m[`enc.d.${arm}`] = [em(arm, 'R@1') - em('base', 'R@1'), 'sign'];
    }
    return m;
  }

  /* ─── Paint ─── */
  const prov = document.getElementById('eval-prov');
  const setState = (s, txt) => {
    if (!prov) return;
    prov.dataset.state = s;
    if (txt) prov.querySelector('.prov__txt').innerHTML = txt;
  };

  async function load() {
    setState('loading');

    const names = Object.keys(FILES);
    const data = {};
    const parts = await Promise.all(names.map((n) =>
      fetch(BASE + FILES[n], { cache: 'default' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${FILES[n]}: ${r.status}`))))
    ));
    names.forEach((n, i) => { data[n] = parts[i]; });

    const m = derive(data);
    const targets = section.querySelectorAll('[data-eval]');
    let painted = 0, missing = 0;

    for (const el of targets) {
      const entry = m[el.dataset.eval];
      if (!entry || !Number.isFinite(entry[0])) { missing++; continue; }
      const next = fmt[entry[1]](entry[0]);
      // Mark only the figures the repo has actually moved since publication.
      if (next !== el.textContent.trim()) el.classList.add('num--moved');
      el.textContent = next;
      painted++;
    }

    const link = `<a href="https://github.com/${REPO}/tree/${REF}/data/eval">data/eval</a>`;
    setState('live',
      `${painted} figure${painted === 1 ? '' : 's'} in this section read live from ${link} ` +
      `in the experiment repository${missing ? `, ${missing} unresolved` : ''}. ` +
      `Nothing here is transcribed by hand.`);
  }

  // Fetch once, a screenful before the section arrives.
  const io = new IntersectionObserver((entries, obs) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    obs.disconnect();
    load().catch((err) => {
      // The published values are already on the page; say so and leave them.
      setState('stale',
        'The repository could not be reached, so the figures below are the ' +
        'last published values rather than a live read.');
      if (window.console) console.warn('ToolSelection eval load failed:', err);
    });
  }, { rootMargin: '600px 0px' });

  io.observe(section);
})();


/* ═══════════════════════════════════════════════════════════
   Screenshot viewer. A screenshot of an interface is unreadable
   at the width of a text column, so each one is a link to the
   file. Without this script that link is the browser's own image
   view, which already zooms; with it, the same link opens the
   file here instead, fitted to the window and steppable up to
   three times its own pixels.

   The dialog is built on first use. A reader who never opens one
   never pays for it, and there is no inert markup in the document
   for one that may never be wanted.
   ═══════════════════════════════════════════════════════════ */

(() => {
  const views = Array.from(document.querySelectorAll('.shot__view'));
  if (!views.length) return;

  const MAX  = 3;      // 300% of the file's own pixels; past that it is mush
  const STEP = 1.5;
  const PAD  = 32;     // .lightbox__stage padding, both sides

  let box, bar, stage, img, cap, pct, inBtn, outBtn, fitBtn, closeBtn;
  let fit = 1, scale = 1, opener = null, panned = false;

  const build = () => {
    box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Screenshot');

    bar = document.createElement('div');
    bar.className = 'lightbox__bar';

    cap = document.createElement('p');
    cap.className = 'lightbox__cap';

    const btn = (label, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lightbox__btn';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      return b;
    };
    outBtn   = btn('−', 'Zoom out');
    inBtn    = btn('+', 'Zoom in');
    fitBtn   = btn('Fit', 'Fit the screenshot to the window');
    closeBtn = btn('Close', 'Close the screenshot');

    pct = document.createElement('span');
    pct.className = 'lightbox__pct';
    // The figure is what changes as you zoom, so it is the live region.
    pct.setAttribute('aria-live', 'polite');

    stage = document.createElement('div');
    stage.className = 'lightbox__stage';

    img = document.createElement('img');
    img.className = 'lightbox__img';

    bar.append(cap, outBtn, pct, inBtn, fitBtn, closeBtn);
    stage.append(img);
    box.append(bar, stage);
    document.body.append(box);

    outBtn.addEventListener('click', () => zoomTo(scale / STEP));
    inBtn.addEventListener('click', () => zoomTo(scale * STEP));
    fitBtn.addEventListener('click', () => zoomTo(fit));
    closeBtn.addEventListener('click', close);

    // Clicking the plate behind the image dismisses; clicking the image
    // toggles between fitted and its own pixels, which is the one step
    // most readers actually want.
    stage.addEventListener('click', (e) => {
      if (e.target === stage) close();
    });
    img.addEventListener('click', () => {
      // A pan ends with a click on the image. Toggling the zoom there would
      // undo the pan the reader just made.
      if (panned) { panned = false; return; }
      zoomTo(Math.abs(scale - fit) < 1e-3 ? Math.min(1, MAX) : fit);
    });

    box.addEventListener('keydown', onKey);
    addPanning();
  };

  const fitScale = () => Math.min(
    1,
    (stage.clientWidth  - PAD) / img.naturalWidth,
    (stage.clientHeight - PAD) / img.naturalHeight
  );

  const apply = () => {
    img.style.width = (img.naturalWidth * scale) + 'px';
    pct.textContent = Math.round(scale * 100) + '%';
    outBtn.disabled = scale <= fit  + 1e-3;
    inBtn.disabled  = scale >= MAX  - 1e-3;
    fitBtn.disabled = Math.abs(scale - fit) < 1e-3;
    box.classList.toggle(
      'lightbox--pannable',
      stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight
    );
  };

  // Zoom about the middle of what is on screen, so the detail being read
  // stays roughly under the eye instead of sliding off to a corner.
  const zoomTo = (next) => {
    next = Math.min(MAX, Math.max(fit, next));
    if (Math.abs(next - scale) < 1e-4) return;
    const cx = stage.scrollLeft + stage.clientWidth  / 2;
    const cy = stage.scrollTop  + stage.clientHeight / 2;
    const ratio = next / scale;
    scale = next;
    apply();
    stage.scrollLeft = cx * ratio - stage.clientWidth  / 2;
    stage.scrollTop  = cy * ratio - stage.clientHeight / 2;
  };

  const addPanning = () => {
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
    img.addEventListener('pointerdown', (e) => {
      if (!box.classList.contains('lightbox--pannable')) return;
      dragging = true; panned = false;
      sx = e.clientX; sy = e.clientY;
      sl = stage.scrollLeft; st = stage.scrollTop;
      box.classList.add('lightbox--panning');
      img.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    img.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panned = true;
      stage.scrollLeft = sl - dx;
      stage.scrollTop  = st - dy;
    });
    const end = () => { dragging = false; box.classList.remove('lightbox--panning'); };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', end);
  };

  function onKey(e) {
    if (e.key === 'Escape')                  { close(); return; }
    if (e.key === '+' || e.key === '=')      { zoomTo(scale * STEP); return; }
    if (e.key === '-' || e.key === '_')      { zoomTo(scale / STEP); return; }
    if (e.key === '0')                       { zoomTo(fit); return; }
    if (e.key !== 'Tab') return;
    // Hold focus inside the dialog: behind it the page is still there and
    // tabbing onto it would be tabbing onto something nobody can see.
    const stops = Array.from(box.querySelectorAll('button:not(:disabled)'));
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus();  e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  const open = (link) => {
    if (!box) build();
    opener = link;
    const src = link.getAttribute('href');
    const thumb = link.querySelector('img');
    const figure = link.closest('figure');
    const caption = figure && figure.querySelector('figcaption');

    img.alt = thumb ? thumb.alt : '';
    cap.textContent = caption ? caption.textContent.replace(/\s+/g, ' ').trim() : '';
    box.hidden = false;
    document.documentElement.style.overflow = 'hidden';

    const start = () => { fit = fitScale(); scale = fit; apply(); };
    if (img.getAttribute('src') === src && img.complete) start();
    else { img.onload = start; img.setAttribute('src', src); }
    closeBtn.focus();
  };

  function close() {
    box.hidden = true;
    document.documentElement.style.overflow = '';
    if (opener) opener.focus();
    opener = null;
  }

  // Re-fit on resize: a window that got smaller should not leave the
  // screenshot stranded wider than the stage with no way back to fitted.
  let rt;
  window.addEventListener('resize', () => {
    if (!box || box.hidden) return;
    clearTimeout(rt);
    rt = setTimeout(() => {
      const wasFitted = Math.abs(scale - fit) < 1e-3;
      fit = fitScale();
      scale = wasFitted ? fit : Math.max(fit, scale);
      apply();
    }, 150);
  });

  views.forEach((link) => link.addEventListener('click', (e) => {
    // Let a modified click do what the reader asked: open the file itself.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open(link);
  }));
})();
