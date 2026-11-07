import { describe, expect, it } from "vitest";
import { parseStartSource, parseStartTicket } from "./theater-start";

describe("parseStartSource", () => {
  it.each([
    ["live", "live"],
    ["submission", "submission"],
  ] as const)("%s はそのまま", (value, expected) => {
    expect(parseStartSource(value)).toBe(expected);
  });

  it.each([null, "", "x", "Live", "LIVE", " live", "live\n", "submission ", "../x"])(
    "%j は既定の submission",
    (value) => {
      expect(parseStartSource(value)).toBe("submission");
    },
  );
});

describe("parseStartTicket", () => {
  it.each(["T-014", "T-1234", "T-026", "T-999"])("%j は票の ID の形なのでそのまま", (value) => {
    expect(parseStartTicket(value)).toBe(value);
  });

  it.each([
    null,
    "",
    "t-014",
    "T-14",
    "T-12345",
    "T-014x",
    "xT-014",
    "../x",
    "T-014\n",
    "T-014\r\n",
    "T-014\r",
    "\nT-014",
    " T-014",
    "T-014 ",
    "T-014\t",
    "T-0１4",
    "T-014/../x",
  ])("%j は null", (value) => {
    expect(parseStartTicket(value)).toBeNull();
  });
});
