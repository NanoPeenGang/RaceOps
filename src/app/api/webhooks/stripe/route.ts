import Stripe from "stripe";
import {
  getStripe,
  syncSubscriptionFromStripe,
} from "@/server/services/billing";

/**
 * Stripe webhook — the single writer for subscription state.
 * Signature verification is mandatory; never process unverified events.
 *
 * Subscribe this endpoint (Stripe dashboard -> Webhooks) to:
 *   checkout.session.completed
 *   customer.subscription.created / updated / deleted
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = getStripe();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscriptionFromStripe(subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscriptionFromStripe(event.data.object);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error(`Stripe webhook handling failed for ${event.type}:`, error);
    // Non-2xx so Stripe retries the event.
    return new Response("Webhook handling failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
