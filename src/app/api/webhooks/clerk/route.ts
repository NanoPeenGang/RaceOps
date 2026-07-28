import { Webhook } from "svix";
import { headers } from "next/headers";
import { db } from "@/server/db/client";

type ClerkWebhookEvent = {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
    primary_email_address_id?: string;
  };
};

/**
 * Clerk -> RaceOps user sync. Signature-verified via svix.
 * user.created is NOT auto-provisioned here — onboarding (profile type
 * selection) creates the local User. This handler keeps email in sync and
 * removes local data when a Clerk account is deleted (GDPR).
 */
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.text();
  let event: ClerkWebhookEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "user.updated": {
      const primaryEmail = event.data.email_addresses?.find(
        (e) => e.id === event.data.primary_email_address_id,
      )?.email_address;
      if (primaryEmail) {
        await db.user.updateMany({
          where: { authProviderId: event.data.id },
          data: { email: primaryEmail },
        });
      }
      break;
    }
    case "user.deleted": {
      await db.user.deleteMany({ where: { authProviderId: event.data.id } });
      break;
    }
    default:
      break;
  }

  return new Response("OK", { status: 200 });
}
