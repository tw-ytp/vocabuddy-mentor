import { test } from "node:test";
import assert from "node:assert/strict";
import { fuse, ftsQuery } from "../src/rank.ts";
import { redactSecrets, detectLab, redLine, isMinorSensitive, cleanQuestion } from "../src/safety.ts";

test("ftsQuery keeps error tokens and splits CJK", () => {
  const q = ftsQuery("Lab 3 跑出 AttributeError: 'ThinkingBlock' object has no attribute 'text' 怎麼辦");
  assert.ok(q.includes('"AttributeError"'));
  assert.ok(q.includes('"ThinkingBlock"'));
  assert.ok(q.includes('"attribute"'));
  assert.ok(q.includes("怎麼辦"));
  assert.equal(ftsQuery("ab 中"), null);
});

test("fuse boosts rescue and lab match", () => {
  const meta = new Map([
    ["a", { id: "a", kind: "body", lab: 1, tier: 1, page_id: "1-1" }],
    ["b", { id: "b", kind: "rescue", lab: 3, tier: 1, page_id: "lab3" }],
    ["c", { id: "c", kind: "code", lab: 3, tier: 2, page_id: "lab3" }],
  ]);
  const r = fuse([{ id: "a", score: 0.8 }, { id: "b", score: 0.7 }], [{ id: "c", score: 5 }, { id: "b", score: 4 }], meta, { lab: 3 });
  assert.equal(r[0].id, "b"); // 兩路都命中＋rescue＋lab 加權
  assert.equal(r.length, 3);
});

test("redactSecrets masks anthropic and github keys", () => {
  const { text, redacted } = redactSecrets("my key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef and ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  assert.ok(!text.includes("sk-ant-api03"));
  assert.ok(!text.includes("ghp_abcdef"));
  assert.equal(redacted.length, 2);
  assert.equal(redactSecrets("git grep sk-ant-api 應該一無所獲").redacted.length, 0); // 教材示範字樣不遮
});

test("detectLab / redLine / minor", () => {
  assert.equal(detectLab("Sprint 3 的時間旅行"), 7);
  assert.equal(detectLab("lab 12 指示檔"), 12);
  assert.equal(detectLab("沒有編號"), null);
  assert.equal(redLine("怎麼 git push --force"), "強制推送");
  assert.equal(redLine("push 失敗怎麼辦"), null);
  assert.ok(isMinorSensitive("要刷信用卡才能開通嗎"));
  assert.equal(cleanQuestion("<@12345> hi  "), "hi");
});
