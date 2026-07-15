import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../lib/functions/omnichannel-maintenance.ts", import.meta.url),
  "utf8",
);

describe("omnichannel maintenance direction guards", () => {
  it("requeues and escalates only inbound processing rows", () => {
    const directionGuards = source.match(/\.eq\('direction', 'in'\)/g) ?? [];
    expect(directionGuards).toHaveLength(2);
    expect(source).not.toMatch(
      /\.in\('status', \['processing', 'sending'\]\)[\s\S]{0,120}?\.eq\('direction', 'out'\)/,
    );
  });
});
