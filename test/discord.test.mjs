import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDiscordRequest, answerPayload, feedbackRow } from "../src/discord.ts";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

test("verifyDiscordRequest accepts a valid Ed25519 signature and rejects a tampered body", async () => {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = hex(await crypto.subtle.exportKey("raw", kp.publicKey));
  const ts = "1700000000";
  const body = JSON.stringify({ type: 1 });
  const sig = hex(await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(ts + body)));
  const mk = (b) => new Request("https://x/", { method: "POST", headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts }, body: b });
  assert.equal(await verifyDiscordRequest(mk(body), pub, body), true);
  assert.equal(await verifyDiscordRequest(mk(body), pub, body + " "), false);
});

test("answerPayload truncates to embed limit and carries buttons", () => {
  const p = answerPayload({ question: "q\nq", answer: "x".repeat(5000), footer: "f", logId: 7 });
  assert.ok(p.embeds[0].description.length <= 4096);
  assert.equal(p.components[0].components[2].custom_id, "help:7");
  assert.deepEqual(feedbackRow(1)[0].components.map((c) => c.label), ["解決了", "多說一點", "呼叫助教"]);
  assert.deepEqual(feedbackRow(1, false)[0].components.map((c) => c.label), ["解決了", "呼叫助教"]);
});
