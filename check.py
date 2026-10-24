#!/usr/bin/env python3
"""Checks on the rendered site, run by `python3 build.py --check`.

Splitting one page into six turns every in-page jump into something that can
dangle silently: a fragment whose section now lives on another file still
looks like a link and still does nothing. These assertions are the proof that
none of them do.

Standard library only; no HTML parser, because the markup here is generated
from partials that are themselves verbatim slices of a hand-written file.
"""

import re
from pathlib import Path

HREF = re.compile(r'(?:href|src)="([^"]+)"')
ID = re.compile(r'\sid="([^"]+)"')
VQ = re.compile(r'(styles\.css|main\.js)\?v=([0-9a-f]+)')


def ids_in(text):
    return ID.findall(text)


def run(pages, manifest, moved, root):
    """`pages` maps output filename -> rendered text. Returns an exit code."""
    fails, notes = [], []

    def fail(msg):
        fails.append(msg)

    ids = {name: ids_in(text) for name, text in pages.items()}

    # 1. Every id is unique within its page. #sky, #starfield, #player,
    #    #bandFade and #eval-prov are all reachable from more than one partial.
    for name, found in ids.items():
        dupes = {i for i in found if found.count(i) > 1}
        if dupes:
            fail(f'{name}: duplicate id(s) {sorted(dupes)}')

    # 2. Every link resolves: external, mailto, a fragment on this page, or
    #    another page of the site with the fragment present over there.
    for name, text in pages.items():
        for href in HREF.findall(text):
            if href.startswith(('http://', 'https://', 'mailto:', 'data:', '#')):
                if href.startswith('#') and href[1:] not in ids[name]:
                    fail(f'{name}: href="{href}" has no such id on this page')
                continue
            target, _, frag = href.partition('#')
            target = target.split('?')[0]
            if not target:
                continue
            if target in pages:
                if frag and frag not in ids[target]:
                    fail(f'{name}: href="{href}" — {target} has no id "{frag}"')
                continue
            # A local asset: must exist on disk, matched case-sensitively,
            # because Pages is case-sensitive and macOS is not.
            path = root / target
            if not path.exists():
                fail(f'{name}: {target} does not exist')
            elif target not in [p.name for p in (root / target).parent.iterdir()] \
                    and Path(target).name not in [p.name for p in path.parent.iterdir()]:
                fail(f'{name}: {target} differs in case from the file on disk')

    # 3. The dangling-fragment proof, driven off the fragments the single page
    #    used to answer — not off the new ones, which is what makes it a proof.
    home = manifest[0]['out']
    old_fragments = [p['id'] for p in manifest] + [s['id'] for p in manifest for s in p['subs']]
    for frag in old_fragments:
        if frag in ids[home]:
            continue
        if frag in moved and moved[frag] in pages:
            continue
        fail(f'old fragment #{frag} is answered by neither {home} nor the redirect map')
    if home in pages:
        for frag in moved:
            if f'{frag}:"' not in pages[home]:
                fail(f'{home}: redirect map is missing #{frag}')

    # 4. The asset versions match the assets. A content hash removes the habit
    #    of bumping by hand, and with it the chance of noticing a stale one —
    #    so the staleness is asserted instead.
    import build
    want = {'styles.css': build.digest('styles.css'), 'main.js': build.digest('main.js')}
    for name, text in pages.items():
        stamped = dict(VQ.findall(text))
        for asset, v in want.items():
            if stamped.get(asset) != v:
                fail(f'{name}: {asset}?v={stamped.get(asset)} but the file hashes to {v}')

    # 5. Exactly one page carries the widget, and it is the one with the hero.
    with_player = [n for n, t in pages.items() if 'id="player"' in t]
    with_api = [n for n, t in pages.items() if 'open.spotify.com/embed/iframe-api' in t]
    with_hero = [n for n, t in pages.items() if 'class="sky"' in t]
    for label, got in (('id="player"', with_player), ('the Spotify API script', with_api),
                       ('the full hero', with_hero)):
        if len(got) != 1:
            fail(f'{label} appears on {len(got)} pages ({got}), expected exactly 1')
    if with_player and with_api and with_hero and not (with_player == with_api == with_hero):
        fail(f'player {with_player}, API {with_api} and hero {with_hero} are not the same page')

    # 6. One <h1> per page, and night at the foot of every one.
    for name, text in pages.items():
        n = len(re.findall(r'<h1[\s>]', text))
        if n != 1:
            fail(f'{name}: {n} <h1> elements, expected 1')
        if 'class="close' not in text:
            fail(f'{name}: no footer.close')

    # 7. #toolselection and its provenance block are never separated — main.js
    #    reaches into .prov__txt without checking that it is there.
    for name, text in pages.items():
        if 'id="toolselection"' in text:
            if 'id="eval-prov"' not in text or 'prov__txt' not in text:
                fail(f'{name}: has #toolselection but not #eval-prov/.prov__txt')

    for name, text in pages.items():
        notes.append(f'  {name:24} {len(ids[name]):3} ids  {len(text):>7,} bytes')

    print('\n'.join(notes))
    print()
    if fails:
        print(f'FAILED — {len(fails)} problem(s):')
        for f in fails:
            print(f'  · {f}')
        return 1
    print(f'OK — {len(pages)} pages, {len(old_fragments)} original fragments all answered.')
    return 0
