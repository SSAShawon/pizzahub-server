
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

    // A Free vendor's item can be approved,
    // but it must remain inactive if the limit is reached.
    let shouldRemainInactive = false;

    if (status === "approved" && menuItem.isAvailable === true) {
      if (!menuItem.vendorId) {
        return res.status(400).json({
          success: false,
          message: "Vendor information is missing for this menu item.",
        });
      }

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
          shouldRemainInactive = true;
        }
      }
    }

    await menuCollection.updateOne(
      { _id: menuItemId },
      {
        $set: {
          status,
          ...(shouldRemainInactive ? { isAvailable: false } : {}),
          updatedAt: new Date(),
        },
      },
    );

    const updatedItem = await menuCollection.findOne({
      _id: menuItemId,
    });

    return res.status(200).json({
      success: true,
      code: shouldRemainInactive
        ? "APPROVED_BUT_INACTIVE"
        : "MENU_ITEM_REVIEWED",
      message:
        status === "rejected"
          ? "Menu item rejected successfully."
          : shouldRemainInactive
            ? "Menu item approved successfully, but it remains inactive because the vendor has reached the Free Plan limit of 3 active items."
            : "Menu item approved successfully.",
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


// PATCH: Activate or deactivate an approved menu item
router.patch("/menu/:id/availability", async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body || {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Availability must be true or false.",
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

    // Only approved items can be activated or deactivated.
    if (menuItem.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved menu items can be activated or deactivated.",
      });
    }

    // Avoid unnecessary database updates.
    if (menuItem.isAvailable === isAvailable) {
      return res.status(200).json({
        success: true,
        message: isAvailable
          ? "This menu item is already active."
          : "This menu item is already inactive.",
        menuItem,
      });
    }

    // Enforce the Free Plan limit when activating an item.
    if (isAvailable === true) {
      if (!menuItem.vendorId) {
        return res.status(400).json({
          success: false,
          message: "Vendor information is missing for this menu item.",
        });
      }

      const vendorQuery = menuItem.vendorEmail
        ? {
            email: menuItem.vendorEmail,
            role: "vendor",
          }
        : {
            $or: [
              { _id: menuItem.vendorId },
              { id: menuItem.vendorId },
            ],
            role: "vendor",
          };

      const vendor = await getVendorCollection().findOne(
        vendorQuery,
        {
          projection: {
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
          },
        },
      );

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "The vendor account associated with this item was not found.",
        });
      }

      const expiryDate = vendor.subscriptionExpiresAt
        ? new Date(vendor.subscriptionExpiresAt)
        : null;

      const isPremium =
        vendor.subscriptionPlan === "premium" &&
        expiryDate !== null &&
        Number.isFinite(expiryDate.getTime()) &&
        expiryDate > new Date();

      if (!isPremium) {
        const activeCount = await menuCollection.countDocuments({
          vendorId: menuItem.vendorId,
          status: "approved",
          isAvailable: true,
        });

        if (activeCount >= 3) {
          return res.status(403).json({
            success: false,
            code: "FREE_PLAN_LIMIT_REACHED",
            message:
              "This vendor has reached the Free Plan limit of 3 active menu items. Deactivate another item or upgrade to Premium before activating this one.",
            activeItems: activeCount,
            limit: 3,
          });
        }
      }
    }

    await menuCollection.updateOne(
      { _id: menuItemId },
      {
        $set: {
          isAvailable,
          updatedAt: new Date(),
        },
      },
    );

    const updatedItem = await menuCollection.findOne({
      _id: menuItemId,
    });

    return res.status(200).json({
      success: true,
      message: isAvailable
        ? "Menu item activated successfully."
        : "Menu item deactivated successfully.",
      menuItem: updatedItem,
    });
  } catch (error) {
    console.error("Admin Update Menu Availability Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update menu item availability.",
    });
  }
});

// DELETE: Delete a menu item
router.delete("/menu/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const menuItemId = new ObjectId(id);
    const menuCollection = getMenuCollection();

    const menuItem = await menuCollection.findOne({
      _id: menuItemId,
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    const result = await menuCollection.deleteOne({
      _id: menuItemId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Menu item deleted successfully.",
    });
  } catch (error) {
    console.error("Admin Delete Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to delete menu item.",
    });
  }
});

export default router;
