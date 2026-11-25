export type LineEnding = "none" | "\\r" | "\\n" | "\\r\\n";

const lineEndings = new Map<LineEnding, string>([
  ["\\r", "\r"],
  ["\\n", "\n"],
  ["\\r\\n", "\r\n"],
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeTerminalMessage(
  input: string,
  hex: boolean,
  lineEnding: LineEnding = "none",
): number[] {
  if (hex) {
    const digits = input.replace(/[\s-]/g, "");
    if (!/^(?:[0-9a-f]{2})+$/i.test(digits)) {
      throw new Error("Enter complete hexadecimal bytes, for example 01 A0 FF.");
    }
    const bytes = [];
    for (let i = 0; i < digits.length; i += 2) {
      bytes.push(Number.parseInt(digits.slice(i, i + 2), 16));
    }
    return bytes;
  }

  const text = input.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  return Array.from(encoder.encode(text + (lineEndings.get(lineEnding) ?? "")));
}

export function formatTerminalBytes(bytes: number[], hex: boolean, verboseCrLf: boolean): string {
  if (hex) {
    return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase() + " ").join("");
  }

  const text = decoder.decode(new Uint8Array(bytes));
  return verboseCrLf ? text.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>\n") : text;
}
