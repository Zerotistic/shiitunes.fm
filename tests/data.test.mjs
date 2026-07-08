import test from "node:test";
import assert from "node:assert/strict";
import { UNTITLED_LABEL, enrichTrack, makeYouTubeUrl } from "../js/data.js";

test("enrichTrack normalizes the exporter schema", () => {
  const track = enrichTrack({
    id: "vid123-30",
    videoId: "vid123",
    title: "Requiem",
    artist: "Kanaria",
    source: "【Shiina x Lumi】 レクイエム【歌ってみた】",
    category: "cover",
    startSeconds: 30,
    durationSeconds: 149
  });
  assert.equal(track.id, "vid123-30");
  assert.equal(track.category, "cover");
  assert.equal(track.duration, 149);
  assert.equal(track.durationLabel, "2:29");
  assert.equal(track.untitled, false);
});

test("enrichTrack tolerates snake_case pipeline fields", () => {
  const track = enrichTrack({
    video_id: "vid123",
    possible_title: "Song",
    possible_artist: "Someone",
    vod_title: "Karaoke night",
    start_seconds: "10",
    duration_seconds: "60"
  }, 3);
  assert.equal(track.videoId, "vid123");
  assert.equal(track.title, "Song");
  assert.equal(track.startSeconds, 10);
  assert.equal(track.duration, 60);
  assert.equal(track.id, "vid123-10-3");
});

test("stream category is normalized to karaoke", () => {
  const track = enrichTrack({ videoId: "v", title: "Kani Song", source: "Zatsudan", category: "stream", startSeconds: 5 });
  assert.equal(track.category, "karaoke");
});

test("untitled songs get the shared label and flag", () => {
  const blank = enrichTrack({ videoId: "v", title: "", source: "Karaoke", startSeconds: 0 });
  assert.equal(blank.untitled, true);
  assert.equal(blank.title, UNTITLED_LABEL);

  const sentinel = enrichTrack({ videoId: "v", title: "Unknown singing moment", source: "Karaoke", startSeconds: 0 });
  assert.equal(sentinel.untitled, true);

  const realSong = enrichTrack({ videoId: "v", title: "Unknown Mother Goose", source: "Karaoke", startSeconds: 0 });
  assert.equal(realSong.untitled, false);
});

test("empty artist collapses to Shiina", () => {
  const track = enrichTrack({ videoId: "v", title: "Song", artist: "", source: "Karaoke", startSeconds: 0 });
  assert.equal(track.artist, "Shiina Amanogawa");
  assert.equal(track.shiinaIsArtist, true);
});

test("collab credits survive", () => {
  const track = enrichTrack({ videoId: "v", title: "Give Me Sweets", artist: "Youngilly X Amanogawa Shiina", source: "Original Song", startSeconds: 0 });
  assert.equal(track.shiinaIsArtist, false);
  assert.equal(track.artist, "Youngilly X Amanogawa Shiina");
});

test("makeYouTubeUrl applies the share lead without going negative", () => {
  assert.equal(makeYouTubeUrl("abc", 30), "https://www.youtube.com/watch?v=abc&t=26s");
  assert.equal(makeYouTubeUrl("abc", 2), "https://www.youtube.com/watch?v=abc&t=0s");
});
