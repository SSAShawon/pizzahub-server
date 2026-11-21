import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import requireVendor from "../middleware/vendor.middleware.js";
import { getMongoClient } from "../config/db.js";

const router = express.Router();

const getStripeInstance = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured on the server.");
  }
  return new Stripe(secretKey);
};

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

/**
 * Idempotently process a verified successful payment:
 * 1. Inserts or updates the transaction record in 'transactions' collection
 * 2. Updates the vendor's user document to 'premium' plan with 30-day expiration
 */
export const processVerifiedPayment = async ({
  sessionId,
  paymentIntentId,
  amount,
  currency,
  vendorId,
  vendorEmail,
  vendorName,
  customerId,
  subscriptionId,
}) => {
  const db = getDatabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days active

  const transactionsCol = db.collection("transactions");
  const usersCol = db.collection("user");

  // Lookup vendor details if name is missing
  let resolvedVendorName = vendorName;
  if (!resolvedVendorName || resolvedVendorName === "Vendor") {
    const vendorUser = await usersCol.findOne({
      $or: [{ id: String(vendorId) }, { email: vendorEmail }],
    });
    resolvedVendorName =
      vendorUser?.restaurantName || vendorUser?.name || "Premium Vendor";
  }

  // 1. Check if transaction already recorded
  let transaction = await transactionsCol.findOne({
    stripeSessionId: sessionId,
  });

  if (!transaction) {
    const newTransaction = {
      vendorId: String(vendorId),
      vendorEmail,
      vendorName: resolvedVendorName,
      amount: Number(amount) || 10,
      currency: String(currency || "usd").toLowerCase(),
      status: "succeeded",
      paymentMethod: "Stripe",
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId || "",
      subscriptionPlan: "premium",
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await transactionsCol.insertOne(newTransaction);
    transaction = { ...newTransaction, _id: insertResult.insertedId };
  } else if (transaction.status !== "succeeded") {
    await transactionsCol.updateOne(
      { _id: transaction._id },
      {
        $set: {
          status: "succeeded",
          stripePaymentIntentId: paymentIntentId || transaction.stripePaymentIntentId,
          updatedAt: now,
        },
      }
    );
    transaction = { ...transaction, status: "succeeded" };
  }

  // 2. Activate or renew subscription in user collection
  await usersCol.updateOne(
    {
      $or: [{ id: String(vendorId) }, { email: vendorEmail }],
    },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: expiresAt,
        subscriptionStatus: "active",
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        updatedAt: now,
      },
    }
  );

  return { transaction, expiresAt };
};

/**
 * Handle Stripe Webhooks
 * Raw body is required for signature verification
 */
export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const stripe = getStripeInstance();
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In development when webhook secret isn't configured, parse the body
      const payload = typeof req.body === "string" ? req.body : req.body.toString("utf8");
      event = JSON.parse(payload);
      console.warn("⚠️ Webhook received without signature verification (development mode)");
    }
  } catch (err) {
    console.error("❌ Webhook Signature Verification Failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const db = getDatabase();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.payment_status === "paid") {
          const vendorId =
            session.metadata?.vendorId || session.client_reference_id;
          const vendorEmail =
            session.metadata?.vendorEmail || session.customer_details?.email;
          const vendorName = session.metadata?.vendorName;

          if (vendorEmail) {
            await processVerifiedPayment({
              sessionId: session.id,
              paymentIntentId:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.subscription || "",
              amount: session.amount_total ? session.amount_total / 100 : 10,
              currency: session.currency || "usd",
              vendorId,
              vendorEmail,
              vendorName,
              customerId: session.customer,
              subscriptionId: session.subscription,
            });
            console.log(`✅ Subscription activated for ${vendorEmail} via webhook.`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        // Subscription cancelled or expired
        const subscription = event.data.object;
        await db.collection("user").updateOne(
          {
            $or: [
              { stripeSubscriptionId: subscription.id },
              { stripeCustomerId: subscription.customer },
            ],
          },
          {
            $set: {
              subscriptionPlan: "free",
              subscriptionStatus: "canceled",
              subscriptionExpiresAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        console.log(`ℹ️ Subscription ${subscription.id} cancelled.`);
        break;
      }

      case "invoice.payment_succeeded": {
        // Recurring renewal succeeded
        const invoice = event.data.object;
        if (invoice.subscription) {
          const nextExpiry = invoice.lines?.data?.[0]?.period?.end
            ? new Date(invoice.lines.data[0].period.end * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          await db.collection("user").updateOne(
            {
              $or: [
                { stripeSubscriptionId: invoice.subscription },
                { stripeCustomerId: invoice.customer },
              ],
            },
            {
              $set: {
                subscriptionPlan: "premium",
                subscriptionExpiresAt: nextExpiry,
                subscriptionStatus: "active",
                updatedAt: new Date(),
              },
            }
          );
        }
        break;
      }

      default:
        // Other events ignored safely
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook Event Processing Error:", err.message);
    return res.status(500).json({ error: "Failed to process webhook event." });
  }
};

// All endpoints below require an authenticated vendor
router.use(requireVendor);

/**
 * POST /api/payment/create-checkout-session
 * Backend creates a Stripe Checkout Session for the logged-in vendor.
 * Enforces security: vendor is derived exclusively from req.user, preventing
 * creating subscription sessions for other vendors.
 */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const stripe = getStripeInstance();

    const vendorId = req.user.id;
    const vendorEmail = req.user.email;
    const vendorName = req.user.restaurantName || req.user.name || "Restaurant Vendor";

    const clientOrigin =
      req.headers.origin ||
      (process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",")[0].trim() : "http://localhost:3000");

    const successUrl = `${clientOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientOrigin}/payment/cancel`;

    // Configure line items: use environment price ID if provided, otherwise price_data
    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    const lineItems = priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "PizzaHub Premium Vendor Plan",
                description:
                  "Unlimited active pizzas, priority restaurant listing, and advanced analytics.",
              },
              unit_amount: 1000, // $10.00 USD
            },
            quantity: 1,
          },
        ];

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: "payment",
      customer_email: vendorEmail,
      client_reference_id: String(vendorId),
      metadata: {
        vendorId: String(vendorId),
        vendorEmail: String(vendorEmail),
        vendorName: String(vendorName),
        plan: "premium",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("Create Checkout Session Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create checkout session.",
    });
  }
});

/**
 * GET /api/payment/session-status
 * Verifies payment confirmation with Stripe and returns verified details.
 * Security: does NOT trust arbitrary frontend claims. Confirms directly with Stripe
 * and verifies that the session belongs to req.user before updating subscription.
 */
router.get("/session-status", async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id || typeof session_id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Missing session_id query parameter.",
      });
    }

    const stripe = getStripeInstance();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Checkout session not found.",
      });
    }

    // Verify session belongs to the authenticated vendor
    const sessionVendorId = session.client_reference_id || session.metadata?.vendorId;
    const sessionVendorEmail =
      session.metadata?.vendorEmail || session.customer_details?.email;

    const matchesId = sessionVendorId && String(sessionVendorId) === String(req.user.id);
    const matchesEmail =
      sessionVendorEmail &&
      sessionVendorEmail.toLowerCase() === req.user.email.toLowerCase();

    if (!matchesId && !matchesEmail) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this payment session.",
      });
    }

    if (session.payment_status === "paid") {
      // Process verification and idempotently update subscription & transaction
      const { transaction, expiresAt } = await processVerifiedPayment({
        sessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.subscription || "",
        amount: session.amount_total ? session.amount_total / 100 : 10,
        currency: session.currency || "usd",
        vendorId: req.user.id,
        vendorEmail: req.user.email,
        vendorName: req.user.restaurantName || req.user.name,
        customerId: session.customer,
        subscriptionId: session.subscription,
      });

      return res.status(200).json({
        success: true,
        verified: true,
        status: "complete",
        paymentStatus: session.payment_status,
        plan: "premium",
        expiresAt,
        transaction,
        amount: session.amount_total ? session.amount_total / 100 : 10,
        currency: session.currency || "usd",
      });
    }

    return res.status(200).json({
      success: true,
      verified: false,
      status: session.status,
      paymentStatus: session.payment_status,
      message: "Payment is pending or not completed.",
    });
  } catch (error) {
    console.error("Session Status Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to verify payment session.",
    });
  }
});

/**
 * POST /api/payment/cancel-subscription
 * Properly handle vendor subscription cancellation
 */
router.post("/cancel-subscription", async (req, res) => {
  try {
    const db = getDatabase();
    const vendorEmail = req.user.email;

    const user = await db.collection("user").findOne({ email: vendorEmail });

    if (!user || user.subscriptionPlan !== "premium") {
      return res.status(400).json({
        success: false,
        message: "No active premium subscription found to cancel.",
      });
    }

    // Cancel Stripe subscription if one exists
    if (user.stripeSubscriptionId) {
      try {
        const stripe = getStripeInstance();
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      } catch (stripeErr) {
        console.warn("Could not cancel Stripe subscription directly:", stripeErr.message);
      }
    }

    // Downgrade vendor in MongoDB
    await db.collection("user").updateOne(
      { email: vendorEmail },
      {
        $set: {
          subscriptionPlan: "free",
          subscriptionStatus: "canceled",
          subscriptionExpiresAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Premium subscription cancelled successfully. Your account is now on the Free Plan.",
    });
  } catch (error) {
    console.error("Cancel Subscription Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel subscription.",
    });
  }
});

/**
 * GET /api/payment/transactions
 * Retrieve the logged-in vendor's own payment transactions
 */
router.get("/transactions", async (req, res) => {
  try {
    const db = getDatabase();
    const transactions = await db
      .collection("transactions")
      .find({
        $or: [{ vendorId: String(req.user.id) }, { vendorEmail: req.user.email }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error("Vendor Get Transactions Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to load payment history.",
    });
  }
});

export default router;
