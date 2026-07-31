import { PURPOSES } from "@/server/trpc/routers/upload";
import { describe, expect, it } from "vitest";
import {
  buildObjectKey,
  checkUpload,
  describeTypes,
  extensionFor,
  formatBytes,
  isAllowedType,
  isOwnStorageUrl,
  safeName,
  scaleToFit,
  UPLOAD_RULES,
} from "@/lib/upload";
import { presignUpload } from "@/server/services/storage";

describe("allowed types", () => {
  it("never accepts SVG as an image", () => {
    // An SVG can carry script, and these are served from a URL people open.
    for (const purpose of ["avatar", "logo", "banner", "media"] as const) {
      expect(isAllowedType(purpose, "image/svg+xml")).toBe(false);
    }
  });

  it("accepts video only where video makes sense", () => {
    expect(isAllowedType("media", "video/mp4")).toBe(true);
    expect(isAllowedType("avatar", "video/mp4")).toBe(false);
    expect(isAllowedType("banner", "video/mp4")).toBe(false);
  });

  it("keeps documents to PDF", () => {
    expect(isAllowedType("document", "application/pdf")).toBe(true);
    expect(isAllowedType("document", "image/jpeg")).toBe(false);
  });
});

describe("checkUpload", () => {
  it("rejects a wrong type with a message naming what is allowed", () => {
    const rejection = checkUpload("avatar", {
      type: "application/zip",
      size: 100,
    });
    expect(rejection?.reason).toBe("type");
    expect(rejection?.message).toContain("JPEG");
  });

  it("rejects an over-size file with both numbers in it", () => {
    const rejection = checkUpload("banner", {
      type: "image/jpeg",
      size: 20 * 1024 * 1024,
    });
    expect(rejection?.reason).toBe("size");
    // A person has to know what to do next: how big it is, and the limit.
    expect(rejection?.message).toContain("20.0 MB");
    expect(rejection?.message).toContain("15.0 MB");
  });

  it("accepts a file inside the rules", () => {
    expect(
      checkUpload("logo", { type: "image/png", size: 200_000 }),
    ).toBeNull();
  });
});

describe("formatBytes", () => {
  it("scales the unit to the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("describeTypes", () => {
  it("reads as a person would say it", () => {
    expect(describeTypes(["image/jpeg", "image/png"])).toBe("a JPEG or PNG");
    expect(describeTypes(["application/pdf"])).toBe("a PDF");
  });
});

describe("safeName", () => {
  it("strips everything that could be a path", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("photo (1).JPG")).toBe("photo-1");
    expect(safeName("a/b/c.png")).toBe("c");
    expect(safeName("C:\\Users\\me\\shot.png")).toBe("shot");
  });

  it("copes with a name that is entirely unusable", () => {
    expect(safeName("///")).toBe("");
    expect(safeName(null)).toBe("");
  });

  it("caps the length so a key cannot be padded out", () => {
    expect(safeName("x".repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe("buildObjectKey", () => {
  it("namespaces by purpose and owner, and ends with the right extension", () => {
    const key = buildObjectKey({
      purpose: "logo",
      ownerId: "user123",
      contentType: "image/png",
      originalName: "Team Logo.png",
      token: "abc123",
    });
    expect(key).toBe("logo/user123/team-logo-abc123.png");
  });

  it("cannot be escaped by a hostile filename", () => {
    const key = buildObjectKey({
      purpose: "avatar",
      ownerId: "user123",
      contentType: "image/jpeg",
      originalName: "../../../admin/config",
      token: "tok",
    });
    // Nothing beyond the two path segments the server chose.
    expect(key.split("/")).toHaveLength(3);
    expect(key.startsWith("avatar/user123/")).toBe(true);
  });

  it("still produces a key when the name reduces to nothing", () => {
    const key = buildObjectKey({
      purpose: "media",
      ownerId: "u",
      contentType: "video/mp4",
      originalName: "!!!",
      token: "tok",
    });
    expect(key).toBe("media/u/tok.mp4");
  });
});

describe("extensionFor", () => {
  it("falls back rather than trusting an unknown type", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("application/x-evil")).toBe("bin");
  });
});

describe("scaleToFit", () => {
  it("leaves an image already within bounds alone", () => {
    expect(scaleToFit(400, 300, 512)).toBeNull();
    expect(scaleToFit(512, 512, 512)).toBeNull();
  });

  it("scales the longest edge and keeps the ratio", () => {
    expect(scaleToFit(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(scaleToFit(3000, 4000, 1000)).toEqual({ width: 750, height: 1000 });
  });

  it("never rounds a dimension to zero", () => {
    expect(scaleToFit(10000, 3, 100)).toEqual({ width: 100, height: 1 });
  });

  it("does nothing when the purpose sets no limit", () => {
    expect(scaleToFit(4000, 3000, null)).toBeNull();
  });
});

describe("isOwnStorageUrl", () => {
  const base = "https://media.raceops.test/bucket";

  it("accepts a URL inside the configured bucket", () => {
    expect(isOwnStorageUrl(`${base}/logo/u1/x.png`, base)).toBe(true);
  });

  it("rejects another host", () => {
    // Otherwise "I just uploaded this" is a way to point a logo rendered on a
    // public page at any host on the internet.
    expect(isOwnStorageUrl("https://evil.test/bucket/x.png", base)).toBe(false);
  });

  it("rejects a lookalike path on the right host", () => {
    expect(
      isOwnStorageUrl("https://media.raceops.test/other/x.png", base),
    ).toBe(false);
  });

  it("rejects plain http and unparseable input", () => {
    expect(isOwnStorageUrl("http://media.raceops.test/bucket/x.png", base)).toBe(
      false,
    );
    expect(isOwnStorageUrl("not a url", base)).toBe(false);
  });

  it("rejects everything when storage is not configured", () => {
    expect(isOwnStorageUrl(`${base}/x.png`, null)).toBe(false);
  });
});

describe("presignUpload", () => {
  const config = {
    accountEndpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "raceops",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secretexample",
    region: "auto",
    publicBaseUrl: "https://media.raceops.test",
  };

  it("signs a PUT with the content type pinned", () => {
    const signed = presignUpload(config, {
      key: "logo/u1/x.png",
      contentType: "image/png",
    });
    // Content-Type is a signed header, so an upload arriving as a different
    // type fails the signature — that is what stops a JPEG presign being used
    // to store HTML on the app's own origin.
    expect(signed.uploadUrl).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
    expect(signed.uploadUrl).toContain("X-Amz-Signature=");
    expect(signed.uploadUrl).toContain("/raceops/logo/u1/x.png");
  });

  it("returns the public URL the object will be readable at", () => {
    const signed = presignUpload(config, {
      key: "logo/u1/x.png",
      contentType: "image/png",
    });
    expect(signed.publicUrl).toBe("https://media.raceops.test/logo/u1/x.png");
  });

  it("produces a different signature for a different content type", () => {
    const png = presignUpload(config, {
      key: "k",
      contentType: "image/png",
    }).uploadUrl;
    const html = presignUpload(config, {
      key: "k",
      contentType: "text/html",
    }).uploadUrl;
    expect(png).not.toBe(html);
  });

  it("carries the expiry so a leaked URL goes stale", () => {
    const signed = presignUpload(config, {
      key: "k",
      contentType: "image/png",
      expiresInSeconds: 120,
    });
    expect(signed.uploadUrl).toContain("X-Amz-Expires=120");
    expect(signed.expiresInSeconds).toBe(120);
  });
});

describe("upload rules", () => {
  it("downscales avatars and logos but never race photography", () => {
    expect(UPLOAD_RULES.avatar.maxEdge).toBe(512);
    // Re-encoding a photographer's work through a canvas would be vandalism.
    expect(UPLOAD_RULES.media.maxEdge).toBeNull();
  });
});

describe("purpose coverage", () => {
  it("signs every purpose the client can offer", () => {
    // The client picks a purpose from UPLOAD_RULES and the server signs one
    // from PURPOSES. If they drift, the file picker renders and every upload
    // is rejected — and only for whichever feature added the new purpose.
    expect([...PURPOSES].sort()).toEqual(Object.keys(UPLOAD_RULES).sort());
  });

  it("gives every purpose a usable rule", () => {
    for (const purpose of PURPOSES) {
      const rules = UPLOAD_RULES[purpose];
      expect(rules.label, purpose).toBeTruthy();
      expect(rules.maxBytes, purpose).toBeGreaterThan(0);
      expect(rules.accept.length, purpose).toBeGreaterThan(0);
      // An SVG can carry script, so it must never be offered as an image.
      expect(rules.accept, purpose).not.toContain("image/svg+xml");
    }
  });

  it("keeps a track map readable rather than shrinking it to a logo", () => {
    // A circuit diagram is read for detail — corner numbers, pit entry, an
    // access road. Downscaling it to 1024px like a logo loses exactly that.
    expect(UPLOAD_RULES.diagram.maxEdge).toBeGreaterThanOrEqual(2048);
  });
});
