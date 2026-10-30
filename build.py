#!/usr/bin/env python3
"""Render the site: one page per entry in the index.

The site is six pages that share a head, an index and a close. Those live
once, in src/, and are stamped into each page here. Edit src/ and run this;
never edit the generated .html at the repo root.

    python3 build.py            render every page
    python3 build.py --check    verify the rendered pages without writing

Output is flat at the repo root, and every path it writes is relative with no
leading slash. That is load-bearing: `media/cabinet-council.png`, `styles.css`
and `main.js` resolve from any page only because all the pages sit in the same
directory. Moving to pretty URLs (appdev/index.html) would silently break both
media hrefs, both <img src>, the stylesheet, the script and every nav link.

No dependencies, standard library only.
"""

import hashlib
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'

# The site's own index, and the single source of truth for the nav. The nav is
# rendered from this, so a label can never drift from the page it points at.
#
#   id    the landmark the page's own nav entry anchors to
#   hero  'full' for the home page's 100svh sky, 'band' for a short strip
#   subs  entries that hang under this page, deep-linking into it
PAGES = [
    dict(
        slug='overview', out='index.html', label='Overview', id='overview',
        hero='full',
        title="Jing Xu's Website",
        description='Jing Xu, Ph.D. Data, generative AI and machine learning: '
                    'turning capability into platforms, products and returns.',
        subs=[],
    ),
    dict(
        slug='experimentations', out='experimentations.html',
        label='Experimentations', id='projects', hero='band',
        title='Experimentations — Jing Xu',
        description='Retrieval bottlenecks in tool selection, measured against a '
                    'catalogue of 3,551 tools rather than ten.',
        subs=[dict(label='ToolSelection', id='toolselection')],
    ),
    dict(
        slug='appdev', out='appdev.html',
        label='APP Development', id='appdev', hero='band',
        title='APP Development — Jing Xu',
        description='HumanizedAI and Cabinet: steering signals for generated prose, '
                    'and a council of models answering as one.',
        subs=[dict(label='HumanizedAI', id='humanizedai'),
              dict(label='Cabinet', id='cabinet')],
    ),
    dict(
        slug='posts', out='posts.html', label='Posts', id='posts', hero='band',
        title='Posts — Jing Xu',
        description='Notes on data, generative AI and machine learning.',
        subs=[],
    ),
    dict(
        slug='techjokes', out='techjokes.html', label='Tech jokes', id='techjokes',
        hero='band',
        title='Tech jokes — Jing Xu',
        description='Jokes that only land if you have shipped something.',
        subs=[],
    ),
    dict(
        slug='contact', out='contact.html', label='Contact', id='contact', hero='band',
        title='Contact — Jing Xu',
        description='Email, GitHub, Google Scholar and LinkedIn for Jing Xu, Ph.D.',
        subs=[], main=False,
    ),
]

HOME = PAGES[0]

# Rendered with the same shell, but not an entry in the index: nothing points
# at it, and it must not take the mark from the page the reader was aiming for.
# GitHub Pages rewrites nothing, so /posts and /posts/ both 404 — six pages are
# six new ways to mistype a URL, and this is what answers them.
NOT_FOUND = dict(
    slug='404', out='404.html', label=None, id='notfound', hero='band',
    title='Not here — Jing Xu',
    description='That page is not on this site.',
    subs=[],
)

SITE = 'https://jingxulabs.github.io/'

# Fragments the single page used to answer on, and where each one lives now.
# Read by the redirect stamped into the home page's <head>: a fragment never
# reaches the server, so an old inbound link can only be forwarded by the
# browser, and only before anything has painted.
MOVED = {p['id']: p['out'] for p in PAGES if p is not HOME}
MOVED.update({s['id']: p['out'] for p in PAGES for s in p['subs']})


def read(name):
    return (SRC / name).read_text()


def digest(path):
    """Short content hash, so a changed asset is fetched and an unchanged one
    is not. Hashed per file: a JS edit should not expire the CSS."""
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:8]


# ── the index ──────────────────────────────────────────────────────────────

def render_nav(page):
    """The nav for one page. A link to somewhere on this page stays a
    fragment, so the scroll-spy and the fold-reveal still have an id to work
    with; everything else is a filename."""
    lines = ['<nav class="nav" aria-label="Sections">']
    for p in PAGES:
        here = p['slug'] == page['slug']
        href = f'#{p["id"]}' if here else p['out']
        mark = ' aria-current="page"' if here else ''
        lines.append(f'  <a href="{href}"{mark}>{p["label"]}</a>')
        for s in p['subs']:
            href = f'#{s["id"]}' if here else f'{p["out"]}#{s["id"]}'
            lines.append(f'  <a href="{href}" class="nav__sub">{s["label"]}</a>')
    lines.append('</nav>')
    return '\n'.join(lines)


# ── the hero, full and short ───────────────────────────────────────────────

def render_hero(page):
    if page['hero'] == 'full':
        return read('_hero.html')
    # The band: the same night and the same starfield, a short strip of it,
    # carrying the line that is also the way home. The name is not repeated
    # here — the home page is one click away and says it at display size; the
    # strip says what the pages under it are for instead. No horizon and no
    # player — both belong to the home page, and main.js degrades to no
    # collision curve and no aimed meteor when they are absent.
    return (
        '<!-- ───────────────────── SKY / band ─────────────────────\n'
        '     A strip of the hero\'s night, with the line home set in it. -->\n'
        '<header class="sky sky--band" id="sky">\n'
        '  <canvas class="sky__canvas" id="starfield" aria-hidden="true"></canvas>\n'
        '\n'
        '  <div class="sky__inner sky__inner--band">\n'
        '    <p class="sky__name sky__name--small">'
        '<a href="index.html">It&rsquo;s time to build</a></p>\n'
        '  </div>\n'
        '</header>'
    )


# ── the close ──────────────────────────────────────────────────────────────

def render_close(page):
    """Night again on every page, with the same four links. Only the Contact
    page announces them with a heading; elsewhere the close stays quiet."""
    contact_page = page['slug'] == 'contact'
    if contact_page:
        tag = '<footer class="close" id="contact">'
        middle = read('_close_sechead.html') + '\n\n'
    else:
        tag = '<footer class="close close--quiet">'
        middle = ''
    return (read('_close_head.html') + '\n' + tag + '\n'
            + read('_close_curve.html') + '\n\n'
            + middle
            + read('_close_contact.html') + '\n</footer>')


# ── the head redirect ──────────────────────────────────────────────────────

SPOTIFY = '<script src="https://open.spotify.com/embed/iframe-api/v1" async></script>\n'


def render_redirect(page):
    """Only the home page answered the old fragments, so only the home page
    forwards them. Inline and before the stylesheet: main.js runs at the end of
    the body, by which time the sky has painted and the reader has seen a page
    they are about to be moved off."""
    if page['slug'] != HOME['slug']:
        return ''
    pairs = ','.join(f'{k}:"{v}"' for k, v in sorted(MOVED.items()))
    return (
        '<!-- An inbound link from before the split names a section that now has\n'
        '     its own page. A fragment is never sent to the server, so this is the\n'
        '     only place it can be answered. -->\n'
        '<script>(function(h){var m={' + pairs + '};'
        'var t=m[h.slice(1)];if(t)location.replace(t+h);})(location.hash);</script>\n'
    )


# ── rendering ──────────────────────────────────────────────────────────────

def render_main(content):
    """The ruled sheet. A page with nothing to put on it leaves it out rather
    than shipping an empty one — the Contact page is carried by its close."""
    if content is None:
        return ''
    return (read('_main_open.html') + '\n' + content + '\n'
            + read('_main_close.html'))


H2_HEAD = '<h2 class="sechead__name">'


def promote_h1(text):
    """On the home page the name is the <h1>. Everywhere else the name is set
    small and is only the way back, so the page's own section head takes the
    rank — the first one, which is the page's subject."""
    i = text.find(H2_HEAD)
    if i < 0:
        return text
    j = text.index('</h2>', i)
    return (text[:i] + '<h1 class="sechead__name">' + text[i + len(H2_HEAD):j]
            + '</h1>' + text[j + len('</h2>'):])


def render(page, content, v_css, v_js):
    out = read('_layout.html')
    main = render_main(content)
    if not main:
        # No sheet on this page, and no blank lines left standing where it was.
        out = out.replace('{{main}}\n\n', '')
    fields = {
        'title': html.escape(page['title'], quote=False),
        'description': html.escape(page['description'], quote=True),
        'body_class': '' if page['hero'] == 'full' else ' class="page--band"',
        'nav': render_nav(page),
        'hero': render_hero(page),
        'main': main,
        'close': render_close(page),
        'spotify': SPOTIFY if page['hero'] == 'full' else '',
        'redirect': render_redirect(page),
        # The home page's canonical is the bare domain, which is the URL it is
        # actually reached at; everyone else is their own filename.
        'canonical': SITE if page['slug'] == HOME['slug'] else SITE + page['out'],
        'v_css': v_css,
        'v_js': v_js,
    }
    for key, value in fields.items():
        out = out.replace('{{' + key + '}}', value)
    left = re.findall(r'\{\{(\w+)\}\}', out)
    if left:
        sys.exit(f'build: unfilled placeholder(s) in _layout.html: {sorted(set(left))}')
    return out if page['hero'] == 'full' else promote_h1(out)


def content_for(page):
    """A page's sections, wrapped in the blank lines the sheet had around them.
    A page with no partial has no <main>; that is the Contact page only, and
    `main` in the manifest says so, so a partial lost by accident still fails."""
    path = SRC / f'{page["slug"]}.html'
    if not path.exists():
        if page.get('main', True):
            sys.exit(f'build: missing content partial {path.relative_to(ROOT)}')
        return None
    return '\n' + path.read_text() + '\n'


def build():
    v_css, v_js = digest('styles.css'), digest('main.js')
    return {p['out']: render(p, content_for(p), v_css, v_js)
            for p in PAGES + [NOT_FOUND]}


def main(argv):
    pages = build()
    if '--check' in argv:
        # Importable whether or not the interpreter put this directory on the
        # path — `python3 -I build.py` does not.
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from check import run
        sys.exit(run(pages, PAGES, MOVED, ROOT))
    for name, text in pages.items():
        (ROOT / name).write_text(text)
        print(f'  wrote {name}  ({len(text):,} bytes)')


if __name__ == '__main__':
    main(sys.argv[1:])
