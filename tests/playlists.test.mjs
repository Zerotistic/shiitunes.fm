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

test("migratePlaylists is a no-op when everything resolves", () => {
  state.playlists = { liked: ["vidAAA-120"], custom: [] };
  const trackById = trackByIdOf([
    { id: "vidAAA-120", videoId: "vidAAA", startSeconds: 120 }
  ]);

  assert.equal(migratePlaylists(trackById), false);
  assert.deepEqual(state.playlists.liked, ["vidAAA-120"]);
});

test("share link round-trips name and track ids, unicode included", () => {
  const playlist = { id: "p1", name: "夜のうた ✨ mix", trackIds: ["vidAAA-120", "vidBBB-40"] };
  const encoded = encodePlaylistShare(playlist);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "must be URL-safe without escaping");
  const decoded = decodePlaylistShare(encoded);
  assert.deepEqual(decoded, { name: "夜のうた ✨ mix", trackIds: ["vidAAA-120", "vidBBB-40"] });
});

test("decodePlaylistShare rejects garbage and empty payloads", () => {
  assert.equal(decodePlaylistShare("not base64!!"), null);
  assert.equal(decodePlaylistShare(""), null);
  const empty = encodePlaylistShare({ name: "x", trackIds: [] });
  assert.equal(decodePlaylistShare(empty), null);
});

test("renamePlaylist trims and refuses empty names", () => {
  state.playlists = { liked: [], custom: [{ id: "p1", name: "Old", trackIds: [] }] };
  assert.equal(renamePlaylist("p1", "  New Name  "), true);
  assert.equal(state.playlists.custom[0].name, "New Name");
  assert.equal(renamePlaylist("p1", "   "), false);
  assert.equal(state.playlists.custom[0].name, "New Name");
  assert.equal(renamePlaylist("missing", "X"), false);
});
