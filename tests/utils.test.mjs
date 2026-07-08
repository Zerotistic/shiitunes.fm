import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, formatClock, hasCJK, readSeconds } from "../js/utils.js";

test("cleanText collapses whitespace", () => {
  assert.equal(cleanText("  a \n b  "), "a b");
  assert.equal(cleanText(null), "");
});

test("readSeconds parses and clamps", () => {
  assert.equal(readSeconds("42"), 42);
  assert.equal(readSeconds(-3), 0);
  assert.equal(readSeconds(""), null);
  assert.equal(readSeconds("nope"), null);
});

test("formatClock renders m:ss and h:mm:ss", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatClock(-1), "--:--");
  assert.equal(formatClock(NaN), "--:--");
});

test("hasCJK detects kana and ideographs", () => {
  assert.equal(hasCJK("君に夢中"), true);
  assert.equal(hasCJK("レクイエム"), true);
  assert.equal(hasCJK("I Have Nothing"), false);
  assert.equal(hasCJK(""), false);
});
