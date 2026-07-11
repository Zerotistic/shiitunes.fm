import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/state.js";
import {
  decodePlaylistShare, encodePlaylistShare, isLiked, migratePlaylists,
  renamePlaylist, toggleLiked
} from "../js/playlists.js";

function trackByIdOf(tracks) {
  return new Map(tracks.map((track) => [track.id, track]));
}

test("toggleLiked adds then removes", () => {
  state.playlists = { liked: [], custom: [] };
  assert.equal(toggleLiked("a-0"), true);
  assert.equal(isLiked("a-0"), true);
  assert.equal(toggleLiked("a-0"), false);
  assert.equal(isLiked("a-0"), false);
});

test("migratePlaylists rebinds re-timed songs by videoId + nearest start", () => {
  /* The saved id points at second 118; the re-export moved the moment to 120. */
  state.playlists = {
    liked: ["vidAAA-118"],
    custom: [{ id: "playlist-x", name: "Mix", trackIds: ["vidAAA-118", "vidBBB-40"] }]
  };
  const trackById = trackByIdOf([
    { id: "vidAAA-120", videoId: "vidAAA", startSeconds: 120 },
    { id: "vidAAA-900", videoId: "vidAAA", startSeconds: 900 },
    { id: "vidBBB-40", videoId: "vidBBB", startSeconds: 40 }
  ]);

  const changed = migratePlaylists(trackById);

  assert.equal(changed, true);
  assert.deepEqual(state.playlists.liked, ["vidAAA-120"]);
  assert.deepEqual(state.playlists.custom[0].trackIds, ["vidAAA-120", "vidBBB-40"]);
});

test("migratePlaylists leaves far-off orphans alone", () => {
  state.playlists = { liked: ["vidAAA-118"], custom: [] };
  const trackById = trackByIdOf([
    { id: "vidAAA-900", videoId: "vidAAA", startSeconds: 900 }
  ]);

  const changed = migratePlaylists(trackById);

  assert.equal(changed, false);
  assert.deepEqual(state.playlists.liked, ["vidAAA-118"]);
});

test("migratePlaylists prunes ids whose video is gone entirely", () => {
  /* Unlike a far-off orphan (video still present, just no close match), a
   * video missing from tracksByVideo altogether is truly dead — the id must
   * be dropped, not kept forever inflating liked/playlist counts. */
  state.playlists = {
    liked: ["vidAAA-118", "vidBBB-40"],
    custom: [{ id: "playlist-x", name: "Mix", trackIds: ["vidAAA-118"] }]
  };
  const trackById = trackByIdOf([{ id: "vidBBB-40", videoId: "vidBBB", startSeconds: 40 }]);

  const changed = migratePlaylists(trackById);

  assert.equal(changed, true);
  assert.deepEqual(state.playlists.liked, ["vidBBB-40"]);
  assert.deepEqual(state.playlists.custom[0].trackIds, []);
});

test("migratePlaylists is a no-op when everything resolves", () => {
  state.playlists = { liked: ["vidAAA-120"], custom: [] };
  const trackById = trackByIdOf([
    { id: "vidAAA-120", videoId: "vidAAA", startSeconds: 120 }
  ]);

  assert.equal(migratePlaylists(trackById), false);
  assert.deepEqual(state.playlists.liked, ["vidAAA-120"]);
});

test("share link round-trips name and track ids, unicode included", async () => {
  /* Odd-shaped ids (not 11-char videoIds) must fall back to the legacy
   * encoding and still round-trip. */
  const playlist = { id: "p1", name: "夜のうた ✨ mix", trackIds: ["vidAAA-120", "vidBBB-40"] };
  const encoded = await encodePlaylistShare(playlist);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "legacy fallback stays base64url");
  const decoded = await decodePlaylistShare(encoded);
  assert.deepEqual(decoded, { name: "夜のうた ✨ mix", trackIds: ["vidAAA-120", "vidBBB-40"] });
});

test("v2 share links round-trip real-shaped ids compactly", async () => {
  const trackIds = ["9qfAZYrD4Ho-0", "IUivtbGznrw-1569", "_CVrdoZU8Zs-4410"];
  const playlist = { id: "p1", name: "test ~ & 夜.mix", trackIds };
  const encoded = await encodePlaylistShare(playlist);
  assert.match(encoded, /^(2|z)~/, "compact ids use the v2/z format");
  const decoded = await decodePlaylistShare(encoded);
  assert.deepEqual(decoded, { name: "test ~ & 夜.mix", trackIds });
  const legacyLength = (await encodePlaylistShare({ ...playlist, trackIds: ["x-1"] })).length;
  assert.ok(legacyLength > 0); // sanity: legacy path still callable
});

test("v2 beats the legacy encoding on size for a large playlist", async () => {
  const trackIds = Array.from({ length: 80 }, (_, i) => `9qfAZYrD4H${"abcdefgh"[i % 8]}-${i * 37}`);
  const playlist = { id: "p1", name: "big mix", trackIds };
  const encoded = await encodePlaylistShare(playlist);
  const legacy = Buffer.from(JSON.stringify({ n: playlist.name, t: trackIds })).toString("base64url");
  assert.ok(encoded.length < legacy.length * 0.75,
    `expected ≥25% smaller: v2=${encoded.length} legacy=${legacy.length}`);
  assert.deepEqual(await decodePlaylistShare(encoded), { name: "big mix", trackIds });
});

test("legacy base64-JSON links keep decoding (old shares must never break)", async () => {
  /* A real pre-v2 link payload. */
  const legacy = "eyJuIjoidGVzdCIsInQiOlsiX0NWcmRvWlU4WnMtMCIsIi1MU1hIT1lWVWRjLTE1NjkiLCJ5U1JxSERnVDlMdy0xMzQ0IiwicEJHMWVSUXVkYm8tNDQxMCJdfQ";
  const decoded = await decodePlaylistShare(legacy);
  assert.deepEqual(decoded, {
    name: "test",
    trackIds: ["_CVrdoZU8Zs-0", "-LSXHOYVUdc-1569", "ySRqHDgT9Lw-1344", "pBG1eRQudbo-4410"]
  });
});

test("decodePlaylistShare rejects garbage and empty payloads", async () => {
  assert.equal(await decodePlaylistShare("not base64!!"), null);
  assert.equal(await decodePlaylistShare(""), null);
  assert.equal(await decodePlaylistShare("2~name-without-tracks"), null);
  assert.equal(await decodePlaylistShare("z~!!!"), null);
  const empty = await encodePlaylistShare({ name: "x", trackIds: [] });
  assert.equal(await decodePlaylistShare(empty), null);
});

test("renamePlaylist trims and refuses empty names", () => {
  state.playlists = { liked: [], custom: [{ id: "p1", name: "Old", trackIds: [] }] };
  assert.equal(renamePlaylist("p1", "  New Name  "), true);
  assert.equal(state.playlists.custom[0].name, "New Name");
  assert.equal(renamePlaylist("p1", "   "), false);
  assert.equal(state.playlists.custom[0].name, "New Name");
  assert.equal(renamePlaylist("missing", "X"), false);
});
