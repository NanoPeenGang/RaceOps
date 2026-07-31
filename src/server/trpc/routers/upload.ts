import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  buildObjectKey,
  checkUpload,
  UPLOAD_RULES,
  type UploadPurpose,
} from "@/lib/upload";
import {
  presignUpload,
  storageConfig,
  uploadToken,
} from "@/server/services/storage";
import { uploadRateLimiter } from "@/server/services/ratelimit";

/**
 * Direct browser uploads.
 *
 * The server signs a single PUT and the browser sends the bytes straight to
 * object storage, so a 40 MB paddock photo never passes through a serverless
 * function. Everything the signature pins — the key, the content type, the
 * expiry — is decided here and none of it is taken from the client.
 */

const PURPOSES = [
  "avatar",
  "logo",
  "banner",
  "media",
  "document",
] as const satisfies readonly UploadPurpose[];

export const uploadRouter = createTRPCRouter({
  /**
   * Whether direct upload is available on this deployment.
   *
   * The UI asks first and falls back to attach-by-URL rather than showing a
   * file picker that always fails — the platform has always worked without a
   * bucket and must keep working.
   */
  config: protectedProcedure.query(() => {
    const config = storageConfig();
    return {
      enabled: config !== null,
      rules: Object.fromEntries(
        PURPOSES.map((purpose) => [
          purpose,
          {
            maxBytes: UPLOAD_RULES[purpose].maxBytes,
            maxEdge: UPLOAD_RULES[purpose].maxEdge,
            accept: [...UPLOAD_RULES[purpose].accept],
          },
        ]),
      ),
    };
  }),

  /**
   * Signs one upload.
   *
   * Rate limited per user: a presign is cheap to ask for and each one
   * authorises a write to the bucket, so an unthrottled endpoint is a way to
   * fill someone's storage bill.
   */
  createUploadUrl: protectedProcedure
    .input(
      z.object({
        purpose: z.enum(PURPOSES),
        contentType: z.string().min(3).max(120),
        /// Used only to make the key readable; never trusted as a path.
        fileName: z.string().max(200).optional(),
        /// Checked before signing so an over-size upload fails before the
        /// bytes are sent rather than after.
        sizeBytes: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const config = storageConfig();
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "File upload is not configured on this deployment. Paste a link to the image instead.",
        });
      }

      const { success } = await uploadRateLimiter.limit(ctx.user.id);
      if (!success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many uploads at once. Give it a moment.",
        });
      }

      const rejection = checkUpload(input.purpose, {
        type: input.contentType,
        size: input.sizeBytes,
      });
      if (rejection) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: rejection.message,
        });
      }

      // The key is server-generated. A client-chosen key means one account
      // can overwrite another's objects.
      const key = buildObjectKey({
        purpose: input.purpose,
        ownerId: ctx.user.id,
        contentType: input.contentType,
        originalName: input.fileName,
        token: uploadToken(),
      });

      return presignUpload(config, {
        key,
        contentType: input.contentType,
      });
    }),
});
