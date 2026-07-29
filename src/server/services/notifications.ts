import { Resend } from "resend";
import type { NotificationType, PrismaClient } from "@prisma/client";

/**
 * Notification fan-out (Phase 2): always writes an in-app notification;
 * best-effort email via Resend when configured. Email failures never fail
 * the triggering mutation.
 */

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  _resend ??= new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
}

export async function notify(
  db: PrismaClient,
  input: NotifyInput,
): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
    },
  });

  const resend = getResend();
  if (!resend) return;
  try {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user) return;
    await resend.emails.send({
      from: process.env.RESEND_FROM ?? "RaceOps <notifications@raceops.app>",
      to: user.email,
      subject: input.title,
      text: [input.body, input.linkUrl].filter(Boolean).join("\n\n") || input.title,
    });
  } catch (error) {
    console.error("Notification email failed (non-fatal):", error);
  }
}
