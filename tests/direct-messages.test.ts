import { describe, expect, it } from "vitest";
import {
  isVisibleTo,
  pairKeyFor,
  relativeTime,
  sortInbox,
  threadTitle,
  unreadCount,
} from "@/lib/direct-messages";

describe("pairKeyFor", () => {
  it("is the same whichever of the two opened it", () => {
    // Without a canonical form you get two threads side by side, each holding
    // half the conversation.
    expect(pairKeyFor(["b", "a"])).toBe(pairKeyFor(["a", "b"]));
    expect(pairKeyFor(["a", "b"])).toBe("a:b");
  });

  it("is null for a group, so three people can have two conversations", () => {
    expect(pairKeyFor(["a", "b", "c"])).toBeNull();
  });

  it("is null for one person", () => {
    expect(pairKeyFor(["a"])).toBeNull();
    expect(pairKeyFor(["a", "a"])).toBeNull();
  });
});

describe("unreadCount", () => {
  const messages = [
    { userId: "them", createdAt: new Date("2026-03-01T10:00:00Z") },
    { userId: "me", createdAt: new Date("2026-03-01T10:05:00Z") },
    { userId: "them", createdAt: new Date("2026-03-01T10:10:00Z") },
  ];

  it("never counts your own messages", () => {
    const count = unreadCount(messages, { userId: "me", readAt: null });
    expect(count).toBe(2);
  });

  it("counts everything in a thread never opened", () => {
    expect(unreadCount(messages, { userId: "me" })).toBe(2);
  });

  it("counts only what arrived after the read mark", () => {
    const count = unreadCount(messages, {
      userId: "me",
      readAt: new Date("2026-03-01T10:06:00Z"),
    });
    expect(count).toBe(1);
  });

  it("is zero once read past the last message", () => {
    const count = unreadCount(messages, {
      userId: "me",
      readAt: new Date("2026-03-01T11:00:00Z"),
    });
    expect(count).toBe(0);
  });
});

describe("isVisibleTo", () => {
  const left = new Date("2026-03-01T10:00:00Z");

  it("shows a thread you never left", () => {
    expect(isVisibleTo({ userId: "me" }, null)).toBe(true);
  });

  it("hides one you left", () => {
    expect(isVisibleTo({ userId: "me", leftAt: left }, left)).toBe(false);
  });

  it("brings it back when somebody replies", () => {
    // A reply to a conversation you left is still addressed to you; swallowing
    // it would be the platform deciding a message did not deserve delivery.
    expect(
      isVisibleTo(
        { userId: "me", leftAt: left },
        new Date("2026-03-01T11:00:00Z"),
      ),
    ).toBe(true);
  });

  it("keeps it hidden when the last message predates leaving", () => {
    expect(
      isVisibleTo(
        { userId: "me", leftAt: left },
        new Date("2026-03-01T09:00:00Z"),
      ),
    ).toBe(false);
  });
});

describe("threadTitle", () => {
  it("names a thread after the other person, not you", () => {
    const title = threadTitle(
      {
        participants: [
          { userId: "me", displayName: "Me" },
          { userId: "them", displayName: "Dani" },
        ],
      },
      "me",
    );
    expect(title).toBe("Dani");
  });

  it("keeps an explicit subject", () => {
    const title = threadTitle(
      {
        subject: "Sebring tow",
        participants: [
          { userId: "me", displayName: "Me" },
          { userId: "them", displayName: "Dani" },
        ],
      },
      "me",
    );
    expect(title).toBe("Sebring tow");
  });

  it("lists a small group", () => {
    const title = threadTitle(
      {
        participants: [
          { userId: "me", displayName: "Me" },
          { userId: "a", displayName: "Dani" },
          { userId: "b", displayName: "Sam" },
        ],
      },
      "me",
    );
    expect(title).toBe("Dani and Sam");
  });

  it("summarises a big one", () => {
    const title = threadTitle(
      {
        participants: [
          { userId: "me", displayName: "Me" },
          { userId: "a", displayName: "Dani" },
          { userId: "b", displayName: "Sam" },
          { userId: "c", displayName: "Alex" },
          { userId: "d", displayName: "Robin" },
        ],
      },
      "me",
    );
    expect(title).toBe("Dani, Sam and 2 others");
  });

  it("says so rather than rendering blank when everyone else left", () => {
    const title = threadTitle(
      { participants: [{ userId: "me", displayName: "Me" }] },
      "me",
    );
    expect(title).toBe("Just you");
  });

  it("falls back for a participant with no display name", () => {
    const title = threadTitle(
      {
        participants: [
          { userId: "me" },
          { userId: "them", displayName: null },
        ],
      },
      "me",
    );
    expect(title).toBe("Unnamed");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("is coarse, because an inbox is scanned not read", () => {
    expect(relativeTime(new Date("2026-03-10T11:59:30Z"), now)).toBe("now");
    expect(relativeTime(new Date("2026-03-10T11:40:00Z"), now)).toBe("20m");
    expect(relativeTime(new Date("2026-03-10T08:00:00Z"), now)).toBe("4h");
  });

  it("is empty for nothing rather than showing an epoch date", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime(undefined, now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("sortInbox", () => {
  it("puts unread first, then most recent", () => {
    const sorted = sortInbox([
      { id: "a", unread: 0, lastMessageAt: "2026-03-10T12:00:00Z" },
      { id: "b", unread: 2, lastMessageAt: "2026-03-01T12:00:00Z" },
      { id: "c", unread: 1, lastMessageAt: "2026-03-05T12:00:00Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["c", "b", "a"]);
  });

  it("puts a thread with no messages last among the read ones", () => {
    const sorted = sortInbox([
      { id: "empty", unread: 0, lastMessageAt: null },
      { id: "old", unread: 0, lastMessageAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["old", "empty"]);
  });
});
