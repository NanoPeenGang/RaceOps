import { describe, expect, it } from "vitest";
import { ResultStatus } from "@prisma/client";
import { formatLapTime, parseLapTime } from "@/lib/lap-time";
import {
  matchResultRows,
  parseDelimited,
  parseResultStatus,
  parseResultsImport,
} from "@/lib/results-import";

describe("parseDelimited", () => {
  it("parses a simple CSV", () => {
    expect(parseDelimited("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseDelimited('pos,team\n1,"Apex Racing, GT3"')).toEqual([
      ["pos", "team"],
      ["1", "Apex Racing, GT3"],
    ]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    expect(parseDelimited('note\n"He said ""go""\nnow"')).toEqual([
      ["note"],
      ['He said "go"\nnow'],
    ]);
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    expect(parseDelimited("﻿pos,car\r\n1,24\r\n")).toEqual([
      ["pos", "car"],
      ["1", "24"],
    ]);
  });

  it("supports tab and semicolon separated exports", () => {
    expect(parseDelimited("pos\tcar\n1\t24")).toEqual([
      ["pos", "car"],
      ["1", "24"],
    ]);
    expect(parseDelimited("pos;car\n1;24")).toEqual([
      ["pos", "car"],
      ["1", "24"],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseDelimited("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("lap times", () => {
  it("parses m:ss.mmm", () => {
    expect(parseLapTime("1:23.456")).toBe(83456);
    expect(parseLapTime("2:05.007")).toBe(125007);
  });

  it("parses seconds with a fraction", () => {
    expect(parseLapTime("83.456")).toBe(83456);
    expect(parseLapTime("59.5")).toBe(59500);
  });

  it("treats a large bare integer as milliseconds", () => {
    expect(parseLapTime("83456")).toBe(83456);
  });

  it("treats a small bare integer as seconds", () => {
    expect(parseLapTime("83")).toBe(83000);
  });

  it("rejects nonsense", () => {
    expect(parseLapTime("not a time")).toBeNull();
    expect(parseLapTime("")).toBeNull();
    expect(parseLapTime("1:99.000")).toBeNull();
  });

  it("round-trips through the formatter", () => {
    expect(formatLapTime(parseLapTime("1:23.456"))).toBe("1:23.456");
    expect(formatLapTime(83456)).toBe("1:23.456");
    expect(formatLapTime(59500)).toBe("59.500");
    expect(formatLapTime(null)).toBe("—");
  });
});

describe("parseResultStatus", () => {
  it("maps common spellings", () => {
    expect(parseResultStatus("DNF")).toBe(ResultStatus.DNF);
    expect(parseResultStatus("Retired")).toBe(ResultStatus.DNF);
    expect(parseResultStatus("dns")).toBe(ResultStatus.DNS);
    expect(parseResultStatus("Did Not Start")).toBe(ResultStatus.DNS);
    expect(parseResultStatus("DSQ")).toBe(ResultStatus.DSQ);
    expect(parseResultStatus("Disqualified")).toBe(ResultStatus.DSQ);
  });

  it("defaults to a classified finish", () => {
    expect(parseResultStatus("")).toBe(ResultStatus.FINISHED);
    expect(parseResultStatus(undefined)).toBe(ResultStatus.FINISHED);
    expect(parseResultStatus("Finished")).toBe(ResultStatus.FINISHED);
  });
});

describe("parseResultsImport", () => {
  it("reads a typical timing export", () => {
    const csv = [
      "Pos,Car,Team,Laps,Best Lap,Status",
      "1,24,Apex Racing,58,1:23.456,Finished",
      "2,7,Northline Motorsport,58,1:23.900,Finished",
      "3,11,Vertex GT,55,1:25.100,DNF",
    ].join("\n");

    const { rows, issues } = parseResultsImport(csv);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      carNumber: "24",
      competitor: "Apex Racing",
      position: 1,
      laps: 58,
      bestLapMs: 83456,
      status: ResultStatus.FINISHED,
    });
    expect(rows[2].status).toBe(ResultStatus.DNF);
  });

  it("accepts alternative header spellings", () => {
    const csv = "Position,#,Driver Name,Laps Completed\n1,5,Ana Reyes,40";
    const { rows } = parseResultsImport(csv);
    expect(rows[0]).toMatchObject({
      position: 1,
      carNumber: "5",
      competitor: "Ana Reyes",
      laps: 40,
    });
  });

  it("reads a JSON array export", () => {
    const json = JSON.stringify([
      { position: 1, car: "24", team: "Apex Racing", laps: 58 },
      { position: 2, car: "7", team: "Northline", laps: 58 },
    ]);
    const { rows, issues } = parseResultsImport(json);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].carNumber).toBe("24");
  });

  it("rejects a file with no identifying column", () => {
    const { rows, issues } = parseResultsImport("Pos,Laps\n1,58");
    expect(rows).toEqual([]);
    expect(issues[0].message).toMatch(/car number or competitor/i);
  });

  it("rejects a file with no recognizable headers at all", () => {
    const { rows, issues } = parseResultsImport("foo,bar\n1,2");
    expect(rows).toEqual([]);
    expect(issues[0].message).toMatch(/no recognizable columns/i);
  });

  it("flags a classified finish with no position", () => {
    const { rows, issues } = parseResultsImport(
      "Pos,Car,Status\n,24,Finished",
    );
    expect(rows).toHaveLength(0);
    expect(issues[0].message).toMatch(/needs a finishing position/i);
  });

  it("allows a DNF with no position", () => {
    const { rows, issues } = parseResultsImport("Pos,Car,Status\n,24,DNF");
    expect(issues).toEqual([]);
    expect(rows[0].status).toBe(ResultStatus.DNF);
    expect(rows[0].position).toBeNull();
  });

  it("reports an unreadable lap time but keeps the row", () => {
    const { rows, issues } = parseResultsImport(
      "Pos,Car,Best Lap\n1,24,banana",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bestLapMs).toBeNull();
    expect(issues[0].message).toMatch(/could not read the lap time/i);
  });

  it("returns nothing for empty input", () => {
    expect(parseResultsImport("   ")).toEqual({ rows: [], issues: [] });
  });

  it("reports invalid JSON rather than throwing", () => {
    const { issues } = parseResultsImport("[{ broken");
    expect(issues[0].message).toMatch(/invalid json/i);
  });
});

describe("matchResultRows", () => {
  const entries = [
    { registrationId: "r1", carNumber: "24", competitorLabel: "Apex Racing" },
    { registrationId: "r2", carNumber: "7", competitorLabel: "Northline" },
    { registrationId: "r3", carNumber: null, competitorLabel: "Vertex GT" },
  ];

  function rowsFrom(csv: string) {
    return parseResultsImport(csv).rows;
  }

  it("matches on car number", () => {
    const { matched, unmatched, conflicts } = matchResultRows(
      rowsFrom("Pos,Car\n1,24\n2,7"),
      entries,
    );
    expect(conflicts).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(matched.map((m) => m.registrationId)).toEqual(["r1", "r2"]);
    expect(matched[0].matchedOn).toBe("carNumber");
  });

  it("falls back to the competitor name", () => {
    const { matched } = matchResultRows(
      rowsFrom("Pos,Team\n1,Vertex GT"),
      entries,
    );
    expect(matched[0].registrationId).toBe("r3");
    expect(matched[0].matchedOn).toBe("competitor");
  });

  it("matches names ignoring case and punctuation", () => {
    const { matched } = matchResultRows(
      rowsFrom("Pos,Team\n1,vertex-gt"),
      entries,
    );
    expect(matched[0].registrationId).toBe("r3");
  });

  it("reports rows that match no entry", () => {
    const { matched, unmatched } = matchResultRows(
      rowsFrom("Pos,Car\n1,24\n2,99"),
      entries,
    );
    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].carNumber).toBe("99");
  });

  it("refuses to classify the same entry twice", () => {
    const { matched, conflicts } = matchResultRows(
      rowsFrom("Pos,Car\n1,24\n2,24"),
      entries,
    );
    expect(matched).toHaveLength(1);
    expect(conflicts[0].message).toMatch(/already classified by row/i);
  });

  it("refuses an ambiguous name match rather than guessing", () => {
    const ambiguous = [
      { registrationId: "a", carNumber: "1", competitorLabel: "Same Name" },
      { registrationId: "b", carNumber: "2", competitorLabel: "Same Name" },
    ];
    const { matched, conflicts } = matchResultRows(
      rowsFrom("Pos,Team\n1,Same Name"),
      ambiguous,
    );
    expect(matched).toEqual([]);
    expect(conflicts[0].message).toMatch(/matches 2 entries/i);
  });

  it("prefers the car number when name and number disagree", () => {
    // Row says car 7 but names Apex Racing (car 24); the number wins.
    const { matched } = matchResultRows(
      rowsFrom("Pos,Car,Team\n1,7,Apex Racing"),
      entries,
    );
    expect(matched[0].registrationId).toBe("r2");
    expect(matched[0].matchedOn).toBe("carNumber");
  });

  it("flags more than one fastest lap", () => {
    const { conflicts } = matchResultRows(
      rowsFrom("Pos,Car,FL\n1,24,yes\n2,7,yes"),
      entries,
    );
    expect(conflicts.some((c) => /fastest lap/i.test(c.message))).toBe(true);
  });

  it("accepts a single fastest lap", () => {
    const { conflicts, matched } = matchResultRows(
      rowsFrom("Pos,Car,FL\n1,24,yes\n2,7,"),
      entries,
    );
    expect(conflicts).toEqual([]);
    expect(matched[0].row.fastestLap).toBe(true);
    expect(matched[1].row.fastestLap).toBe(false);
  });
});
