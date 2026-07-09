/* Drift checks for the hand-maintained lists that must stay in lockstep:
 * index.html's modulepreload + stylesheet links, sw.js's ASSETS precache,
 * the js/ directory itself, and the tracks.json ?v= (DATA_VERSION). A miss
 * in any of them is silent in production — a slower load, a stale offline
 * shell, or a double download — so it fails here instead. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
const swJs = readFileSync(join(ROOT, "sw.js"), "utf8");
const dataJs = readFileSync(join(ROOT, "js", "data.js"), "utf8");

const jsFiles = readdirSync(join(ROOT, "js")).filter((name) => name.endsWith(".js")).sort();

/* All ?v= stamps on own css/js assets (og-image.png?v= is a separate,
 * embed-cache stamp and deliberately excluded). */
function assetStamps(text) {
  return [...text.matchAll(/(?:css|js)\/[\w.-]+\?v=(\d+)/g)].map((match) => match[1]);
}

function listed(text, re) {
  return [...text.matchAll(re)].map((match) => match[1]).sort();
}

test("every js module is modulepreloaded", () => {
  const preloads = listed(indexHtml, /rel="modulepreload" href="\.\/js\/([\w.-]+?)(?:\?v=\d+)?"/g);
  assert.deepEqual(preloads, jsFiles);
});

test("sw.js precaches every js module", () => {
  const cached = listed(swJs, /"\.\/js\/([\w.-]+?)(?:\?v=\d+)?"/g);
  assert.deepEqual(cached, jsFiles);
});

test("sw.js precaches every stylesheet index.html links", () => {
  const linked = listed(indexHtml, /rel="stylesheet" href="\.\/css\/([\w.-]+)\?v=\d+"/g);
  const cached = listed(swJs, /"\.\/css\/([\w.-]+)\?v=\d+"/g);
  assert.ok(linked.length >= 5, `sanity: found ${linked.length} stylesheets`);
  assert.deepEqual(cached, linked);
});

test("asset ?v= stamps agree everywhere", () => {
  const stamps = new Set([...assetStamps(indexHtml), ...assetStamps(swJs)]);
  assert.equal(stamps.size, 1, `mixed asset stamps: ${[...stamps].join(", ")} — bump index.html and sw.js together`);
});

test("tracks.json ?v= matches DATA_VERSION in all three places", () => {
  const dataVersion = dataJs.match(/^const DATA_VERSION = "(\d+)";$/m)?.[1];
  assert.ok(dataVersion, "DATA_VERSION not found in js/data.js");
  const inIndex = [...indexHtml.matchAll(/data\/tracks\.json\?v=(\d+)/g)].map((match) => match[1]);
  const inSw = [...swJs.matchAll(/data\/tracks\.json\?v=(\d+)/g)].map((match) => match[1]);
  assert.deepEqual(inIndex, [dataVersion], "index.html preload out of step with DATA_VERSION");
  assert.deepEqual(inSw, [dataVersion], "sw.js precache out of step with DATA_VERSION");
});
