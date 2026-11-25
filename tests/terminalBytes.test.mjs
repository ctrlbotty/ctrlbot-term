import assert from "node:assert/strict";
import test from "node:test";
import { encodeTerminalMessage, formatTerminalBytes } from "../src/terminalBytes.ts";

test("encodes text escapes, Unicode and an optional line ending", () => {
  assert.deepEqual(encodeTerminalMessage("é\\r\\n", false, "\\r"), [195, 169, 13, 10, 13]);
  assert.deepEqual(encodeTerminalMessage("", false, "\\r\\n"), [13, 10]);
  assert.deepEqual(encodeTerminalMessage("A", false), [65]);
});

test("accepts complete hex bytes and rejects malformed input", () => {
  assert.deepEqual(encodeTerminalMessage("01 a0-FF", true, "\\n"), [1, 160, 255]);
  for (const input of ["F", "AG", " -- ", "0xFF"]) {
    assert.throws(() => encodeTerminalMessage(input, true), /complete hexadecimal bytes/);
  }
});

test("formats bytes as hex, plain text or visible line endings", () => {
  const bytes = [65, 13, 10];
  assert.equal(formatTerminalBytes(bytes, true, true), "41 0D 0A ");
  assert.equal(formatTerminalBytes(bytes, false, false), "A\r\n");
  assert.equal(formatTerminalBytes(bytes, false, true), "A<CR><LF>\n");
});
