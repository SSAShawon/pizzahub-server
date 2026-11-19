
import express from "express";
import { ObjectId } from "mongodb";
import { getMongoClient } from "../config/db.js";
import requireAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

const getMenuCollection = () => {
  return getDatabase().collection("menuItems");
};

const getVendorCollection = () => {
  return getDatabase().collection("user");
};

// All routes require an authenticated admin
router.use(requireAdmin);

// GET: Get all menu items
router.get("/menu", async (req, res) => {
  try {
    const menuItems = await getMenuCollection()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      menuItems,
    });
  } catch (error) {
    console.error("Admin Get Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load menu items.",
    });
  }
});

// PATCH: Approve or reject a menu item
router.patch("/menu/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
    }

    const menuCollection = getMenuCollection();
    const menuItemId = new ObjectId(id);

    const menuItem = await menuCollection.findOne({
      _id: menuItemId,
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    // Check vendor subscription before approving an available item.
    if (status === "approved" && menuItem.isAvailable === true) {
      if (!menuItem.vendorId) {
        return res.status(400).json({
          success: false,
          message: "Vendor information is missing for this menu item.",
        });
      }

      // Better Auth user IDs are handled as strings.
      // Do not convert them into MongoDB ObjectIds.
      const vendorUser = await getVendorCollection().findOne(
        {
          $or: [
            { _id: menuItem.vendorId },
            { id: menuItem.vendorId },
            ...(menuItem.vendorEmail
              ? [{ email: menuItem.vendorEmail }]
              : []),
          ],
        },
        {
          projection: {
            email: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
          },
        },
      );

      if (!vendorUser) {
        return res.status(404).json({
          success: false,
          message: "The vendor account associated with this item was not found.",
        });
      }

      const expiryDate = vendorUser.subscriptionExpiresAt
        ? new Date(vendorUser.subscriptionExpiresAt)
        : null;

      const isPremium =
        vendorUser.subscriptionPlan === "premium" &&
        expiryDate !== null &&
        Number.isFinite(expiryDate.getTime()) &&
        expiryDate > new Date();

      if (!isPremium) {
        const activeCount = await menuCollection.countDocuments({
          vendorId: menuItem.vendorId,
          status: "approved",
          isAvailable: true,
        });

        const alreadyActive =
          menuItem.status === "approved" &&
          menuItem.isAvailable === true;

        if (!alreadyActive && activeCount >= 3) {
          return res.status(403).json({
            success: false,
            code: "FREE_PLAN_LIMIT_REACHED",
            message:
              "This vendor has reached the Free Plan limit of 3 active menu items. The vendor must upgrade to Premium or deactivate another item before this item can be approved.",
            activeItems: activeCount,
            limit: 3,
          });
        }
      }
    }

    const result = await menuCollection.updateOne(
      { _id: menuItemId },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    const updatedItem = await menuCollection.findOne({
      _id: menuItemId,
    });

    return res.status(200).json({
      success: true,
      message:
        status === "approved"
          ? "Menu item approved successfully."
          : "Menu item rejected successfully.",
      menuItem: updatedItem,
    });
  } catch (error) {
    console.error("Admin Review Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to review menu item.",
    });
  }
});

export default router;
