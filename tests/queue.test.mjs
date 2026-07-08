import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/state.js";
import {
  categoryStationId, canonicalOrder, contextTrackIds, libraryTracks,
  rebuildPlayOrder, searchScore, upNextTracks
} from "../js/queue.js";

function makeTrack(id, overrides = {}) {
  return {
    id,
    videoId: id.split("-")[0],
    title: `Track ${id}`,
    artist: "Artist",
    source: "Some VOD",
    category: "karaoke",
    startSeconds: 0,
    publishedAt: null,
    haystack: `track ${id} artist some vod`.toLowerCase(),
    ...overrides
  };
}

function seedState(tracks) {
  state.tracks = tracks;
  state.trackById = new Map(tracks.map((track) => [track.id, track]));
  state.playContext = null;
  state.activePlaylist = null;
  state.shuffle = false;
  state.repeat = "off";
  state.currentId = tracks[0]?.id || null;
  state.query = "";
  state.libraryFilter = "all";
  state.librarySort = "stream";
  state.playlists = { liked: [], custom: [] };
  rebuildPlayOrder();
}

test("searchScore matches multi-word queries in any order", () => {
  const track = makeTrack("v-1", {
    title: "レクイエム (Requiem)",
    artist: "Kanaria",
    source: "【Shiina x Lumi】 Requiem",
    haystack: "レクイエム (requiem) kanaria 【shiina x lumi】 requiem"
  });
  assert.notEqual(searchScore(track, "requiem kanaria"), Infinity);
  assert.notEqual(searchScore(track, "kanaria requiem"), Infinity);
  assert.equal(searchScore(track, "requiem missingword"), Infinity);
});

test("searchScore ranks title hits above source-only hits", () => {
  const titleHit = makeTrack("v-1", { title: "Cupid", haystack: "cupid" });
  const sourceHit = makeTrack("v-2", { title: "Other", source: "Cupid karaoke", haystack: "other cupid karaoke" });
  assert.ok(searchScore(titleHit, "cupid") < searchScore(sourceHit, "cupid"));
});

test("category station contexts scope the play order", () => {
  seedState([
    makeTrack("a-0", { category: "cover" }),
    makeTrack("b-0", { category: "karaoke" }),
    makeTrack("c-0", { category: "cover" })
  ]);
  state.playContext = categoryStationId("cover");
  assert.deepEqual(canonicalOrder(), ["a-0", "c-0"]);
  assert.equal(contextTrackIds("cat:original"), null);
});

test("shuffle keeps the current track first and every id exactly once", () => {
  const tracks = Array.from({ length: 20 }, (_, i) => makeTrack(`v${i}-0`));
  seedState(tracks);
  state.currentId = "v7-0";
  state.shuffle = true;
  rebuildPlayOrder();
  assert.equal(state.playOrder[0], "v7-0");
  assert.deepEqual([...state.playOrder].sort(), tracks.map((t) => t.id).sort());
});

test("up next stops at the end of the order with repeat off", () => {
  seedState([makeTrack("a-0"), makeTrack("b-0"), makeTrack("c-0")]);
  state.currentId = "b-0";
  const { tracks, endsHere } = upNextTracks();
  assert.deepEqual(tracks.map((t) => t.id), ["c-0"]);
  assert.equal(endsHere, true);
});

test("up next wraps with repeat all", () => {
  seedState([makeTrack("a-0"), makeTrack("b-0"), makeTrack("c-0")]);
  state.currentId = "b-0";
  state.repeat = "all";
  const { tracks, endsHere } = upNextTracks();
  assert.deepEqual(tracks.map((t) => t.id), ["c-0", "a-0"]);
  assert.equal(endsHere, false);
});

test("libraryTracks filters by category and sorts A-Z", () => {
  seedState([
    makeTrack("a-0", { title: "Zebra", category: "cover" }),
    makeTrack("b-0", { title: "Apple", category: "cover" }),
    makeTrack("c-0", { title: "Mango", category: "karaoke" })
  ]);
  state.libraryFilter = "cover";
  state.librarySort = "az";
  assert.deepEqual(libraryTracks().map((t) => t.title), ["Apple", "Zebra"]);
});

test("libraryTracks with a query returns relevance order and honors the filter", () => {
  seedState([
    makeTrack("a-0", { title: "Cupid", category: "cover", haystack: "cupid" }),
    makeTrack("b-0", { title: "Cupid", category: "karaoke", haystack: "cupid" })
  ]);
  state.query = "cupid";
  state.libraryFilter = "karaoke";
  assert.deepEqual(libraryTracks().map((t) => t.id), ["b-0"]);
});
