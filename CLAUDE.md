# JingWeb

Jing Xu's personal site. Static, hand-written, served by GitHub Pages from the
root of `main` at https://jingxulabs.github.io/ — there is no Action and no
deploy step beyond `git push`.

## The pages are generated — edit `src/`, not the root `.html`

```
python3 build.py          render every page into the repo root
python3 build.py --check   verify the rendered pages without writing
```

Seven pages share one head, one index and one close, so those live once in
`src/` and are stamped into each page by `build.py`. **Never edit
`index.html`, `experimentations.html`, `appdev.html`, `posts.html`,
`techjokes.html`, `contact.html` or `404.html` directly** — the next build
overwrites them. Edit the partial and rebuild.

- `src/_layout.html` — the shell, with `{{...}}` slots
- `src/_hero.html` — the home page's full sky; the short band is generated
- `src/_close_*.html` — the night close, in parts
- `src/<slug>.html` — one page's sections, verbatim
- `PAGES` in `build.py` — the manifest the nav is rendered from, and the only
  place a page's title, description, label or sub-items are written down

`styles.css` and `main.js` are hand-edited as normal. Their `?v=` query is a
content hash stamped by the build, so **do not bump it by hand**; `--check`
fails if a committed page points at a stale hash.

Run `python3 build.py --check` before committing. It proves every link
resolves, every id is unique per page, all nine of the original single-page
fragments are still answered, and exactly one page carries the Spotify widget.

## Shape

- Three registers: the night **sky** (hero or short band), the **paper** sheet
  (`main > .measured`, ruled down the left margin), and the night **close**.
- The index (`nav.nav`) is a fixed vertical list on the right, becoming a top
  bar at ≤860px. The current page's entry is marked `aria-current="page"` at
  build time; `main.js`'s scroll-spy writes `true` within a page. CSS matches
  on the attribute's presence, so neither needs to know about the other.
- Output is flat at the repo root and every path is **relative with no leading
  slash**. Pretty URLs (`appdev/index.html`) would break both `media/` hrefs,
  the stylesheet, the script and every nav link.
- Old inbound links like `/#toolselection` are forwarded by a small inline
  script in the home page's `<head>` — a fragment never reaches the server, so
  that is the only place it can be answered.

## Previewing

Serve over HTTP, not `file://` — the ToolSelection figures are fetched from
`raw.githubusercontent.com` and are CORS-blocked from a `null` origin.

```
python3 -m http.server 8731
```
