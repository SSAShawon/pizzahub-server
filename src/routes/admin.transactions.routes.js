
import express from "express";
import requireAdmin from "../middleware/admin.middleware.js";
import { getMongoClient } from "../config/db.js";

const router = express.Router();

router.use(requireAdmin);

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

// GET: Subscription transactions and revenue statistics
router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const transactions = await db
      .collection("transactions")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const vendorEmails = [
      ...new Set(
        transactions
          .map((transaction) => transaction.vendorEmail)
          .filter(Boolean),
      ),
    ];

    const vendors = vendorEmails.length
      ? await db
          .collection("user")
          .find(
            { email: { $in: vendorEmails } },
            {
              projection: {
                email: 1,
                name: 1,
                restaurantName: 1,
              },
            },
          )
          .toArray()
      : [];

    const vendorMap = new Map(
      vendors.map((vendor) => [vendor.email, vendor]),
    );

    const formattedTransactions = transactions.map((transaction) => {
      const vendor = vendorMap.get(transaction.vendorEmail);

      return {
        _id: String(transaction._id),
        vendorEmail: transaction.vendorEmail || "",
        vendorName:
          vendor?.restaurantName ||
          vendor?.name ||
          transaction.vendorName ||
          "Unknown Vendor",
        amount: Number(transaction.amount) || 0,
        currency: transaction.currency || "bdt",
        status: String(transaction.status || "pending").toLowerCase(),
        paymentMethod: transaction.paymentMethod || "Stripe",
        stripeSessionId: transaction.stripeSessionId || "",
        stripePaymentIntentId:
          transaction.stripePaymentIntentId || "",
        createdAt: transaction.createdAt || null,
      };
    });

    const isSuccessful = (status) =>
      ["succeeded", "paid", "completed", "success"].includes(status);

    const isFailed = (status) =>
      ["failed", "canceled", "cancelled"].includes(status);

    const isPending = (status) =>
      ["pending", "processing", "requires_payment_method"].includes(
        status,
      );

    const successfulTransactions = formattedTransactions.filter(
      (transaction) => isSuccessful(transaction.status),
    );

    const failedTransactions = formattedTransactions.filter(
      (transaction) => isFailed(transaction.status),
    );

    const pendingTransactions = formattedTransactions.filter(
      (transaction) => isPending(transaction.status),
    );

    const totalRevenue = successfulTransactions.reduce(
      (total, transaction) => {
        return total + transaction.amount;
      },
      0,
    );

    return res.status(200).json({
      success: true,
      statistics: {
        totalTransactions: formattedTransactions.length,
        successfulPayments: successfulTransactions.length,
        failedPayments: failedTransactions.length,
        pendingPayments: pendingTransactions.length,
        totalRevenue,
        currency: formattedTransactions[0]?.currency || "bdt",
      },
      transactions: formattedTransactions,
    });
  } catch (error) {
    console.error("Admin Get Transactions Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load transactions.",
    });
  }
});

export default router;
