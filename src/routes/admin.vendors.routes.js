
import express from "express";
import requireAdmin from "../middleware/admin.middleware.js";
import { getMongoClient } from "../config/db.js";

const router = express.Router();

router.use(requireAdmin);

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

// GET: All registered vendors
router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const vendors = await db
      .collection("user")
      .find(
        { role: "vendor" },
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            isBlocked: 1,
            restaurantName: 1,
            restaurantAddress: 1,
            contactNumber: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    const vendorsWithStats = await Promise.all(
      vendors.map(async (vendor) => {
        const activeMenuItems = await db
          .collection("menuItems")
          .countDocuments({
            vendorId: String(vendor._id),
            status: "approved",
            isAvailable: true,
          });

        const expiryDate = vendor.subscriptionExpiresAt
          ? new Date(vendor.subscriptionExpiresAt)
          : null;

        const isPremium =
          vendor.subscriptionPlan === "premium" &&
          expiryDate &&
          !Number.isNaN(expiryDate.getTime()) &&
          expiryDate > new Date();

        return {
          ...vendor,
          subscriptionPlan: isPremium ? "premium" : "free",
          subscriptionExpiresAt: vendor.subscriptionExpiresAt || null,
          activeMenuItems,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      totalVendors: vendorsWithStats.length,
      vendors: vendorsWithStats,
    });
  } catch (error) {
    console.error("Admin Get Vendors Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load vendors.",
    });
  }
});

export default router;
