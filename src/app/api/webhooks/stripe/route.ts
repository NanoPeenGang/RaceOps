import Stripe from "stripe";

/**
 * Stripe webhook handler (Phase 2 wiring).
 * Signature verification is mandatory — never process unverified events.
 * Subscription/product handling lands with the marketplace in Phase 2.
 */
export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(secretKey);
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

  switch (event.type) {
    case "checkout.session.completed":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // Phase 2: activate/deactivate recruiter & sponsor tiers.
      break;
    default:
      break;
  }

  return new Response("OK", { status: 200 });
}
