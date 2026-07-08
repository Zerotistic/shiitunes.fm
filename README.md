# shiitunes.fm

Fan-made Shiina Amanogawa radio. Static site (no build step), hosted on
GitHub Pages. The site hosts no audio — every song is a timestamped
YouTube embed.

## Updating the song list

Edit `data/tracks.json`, then run:

```sh
./publish-tracks.sh
```

That bumps `DATA_VERSION` in `js/data.js` (so caches revalidate), commits,
and pushes. Pages redeploys on its own in about a minute.

## Updating anything else

If you change HTML/CSS/JS, bump **every** `?v=` stamp in `index.html`
together (the 7 CSS links and `js/app.js`), then commit and push normally.

## Development

Serve locally (ES modules need HTTP, not file://):

```sh
python3 -m http.server 8811
```

Unit tests and lint:

```sh
node --test tests/*.test.mjs
npx eslint js tests
```
