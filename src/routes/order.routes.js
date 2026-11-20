
import express from "express";
import { ObjectId } from "mongodb";
import { getMongoClient } from "../config/db.js";
import requireCustomer from "../middleware/customer.middleware.js";
import requireVendor from "../middleware/vendor.middleware.js";

const router = express.Router();

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

const getOrdersCollection = () => {
  return getDatabase().collection("orders");
};

const getMenuCollection = () => {
  return getDatabase().collection("menuItems");
};

// Get today's date in Bangladesh timezone (YYYY-MM-DD)
const getBangladeshToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const dateParts = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      dateParts[part.type] = part.value;
    }
  }

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

// Validate YYYY-MM-DD and ensure it is a real calendar date
const isValidDeliveryDate = (date) => {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  return (
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day
  );
};

// POST: Customer creates a new order
router.post("/", requireCustomer, async (req, res) => {
  try {
    const {
      menuItemId,
      quantity,
      phoneNumber,
      deliveryAddress,
      specialInstructions,
      deliveryDate,
    } = req.body || {};

    // Validate menu item ID
    if (!menuItemId || !ObjectId.isValid(menuItemId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid pizza.",
      });
    }

    // Validate quantity
    const parsedQuantity = Number(quantity);

    if (
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > 20
    ) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be between 1 and 20.",
      });
    }

    // Validate phone number
    const cleanPhone = String(phoneNumber || "").replace(/[\s-]/g, "");

    if (!/^(01[3-9]\d{8}|\+8801[3-9]\d{8})$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid phone number.",
      });
    }

    // Validate delivery address
    if (typeof deliveryAddress !== "string") {
      return res.status(400).json({
        success: false,
        message: "Delivery address is required.",
      });
    }

    const cleanAddress = deliveryAddress.trim();

    if (cleanAddress.length < 10 || cleanAddress.length > 300) {
      return res.status(400).json({
        success: false,
        message: "Delivery address must be between 10 and 300 characters.",
      });
    }

    // Validate delivery date
    if (!isValidDeliveryDate(deliveryDate)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid delivery date.",
      });
    }

    if (deliveryDate < getBangladeshToday()) {
      return res.status(400).json({
        success: false,
        message: "Delivery date cannot be in the past.",
      });
    }

    // Validate special instructions
    const instructions = specialInstructions ?? "";

    if (
      typeof instructions !== "string" ||
      instructions.trim().length > 500
    ) {
      return res.status(400).json({
        success: false,
        message: "Special instructions cannot exceed 500 characters.",
      });
    }

    // Find the selected pizza
    const menuItem = await getMenuCollection().findOne({
      _id: new ObjectId(menuItemId),
      status: "approved",
      isAvailable: true,
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: "Pizza not found or currently unavailable.",
      });
    }

    // Verify restaurant owner
    const vendor = await getDatabase()
      .collection("user")
      .findOne({
        email: menuItem.vendorEmail,
        role: "vendor",
        isBlocked: { $ne: true },
      });

    if (!vendor) {
      console.log("Vendor verification failed:", {
        vendorEmail: menuItem.vendorEmail,
        vendorId: menuItem.vendorId,
      });

      return res.status(404).json({
        success: false,
        message: "This restaurant is currently unavailable.",
      });
    }

    // Prevent a vendor from ordering their own pizza
    if (req.user.id === menuItem.vendorId) {
      return res.status(403).json({
        success: false,
        message: "You cannot order from your own restaurant.",
      });
    }

    // Prevent duplicate active orders for the same pizza and date
    const existingOrder = await getOrdersCollection().findOne({
      customerId: req.user.id,
      menuItemId: menuItem._id,
      deliveryDate,
      status: { $in: ["pending", "accepted"] },
    });

    if (existingOrder) {
      return res.status(409).json({
        success: false,
        message:
          "You already have an active order for this pizza on the selected delivery date.",
      });
    }

    // Always calculate price using the database price
    const unitPrice = Number(menuItem.price);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "This pizza has an invalid price.",
      });
    }

    const totalPrice = Number((unitPrice * parsedQuantity).toFixed(2));
    const now = new Date();

    // Create order document
    const newOrder = {
      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: cleanPhone,
      deliveryAddress: cleanAddress,

      vendorId: menuItem.vendorId,
      vendorEmail: menuItem.vendorEmail,
      restaurantName: vendor.restaurantName || "",

      menuItemId: menuItem._id,
      pizzaName: menuItem.name,
      pizzaImage: menuItem.image || "",
      unitPrice,
      quantity: parsedQuantity,
      totalPrice,

      specialInstructions: instructions.trim(),

      deliveryDate,
      deliveryType: "scheduled",
      status: "pending",

      createdAt: now,
      updatedAt: now,
    };

    const result = await getOrdersCollection().insertOne(newOrder);

    return res.status(201).json({
      success: true,
      message: "Your order has been placed successfully!",
      order: {
        ...newOrder,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create Order Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to place your order.",
    });
  }
});

// GET: Customer views their own orders
router.get("/my", requireCustomer, async (req, res) => {
  try {
    const orders = await getOrdersCollection()
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get Customer Orders Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load your orders.",
    });
  }
});

// GET: Vendor views orders received by their restaurant
router.get("/vendor", requireVendor, async (req, res) => {
  try {
    const orders = await getOrdersCollection()
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get Vendor Orders Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load restaurant orders.",
    });
  }
});

// PATCH: Customer cancels their own pending order
router.patch("/:id/cancel", requireCustomer, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    const result = await getOrdersCollection().updateOne(
      {
        _id: new ObjectId(id),
        customerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pending order not found or cancellation is not allowed.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Your order has been cancelled successfully.",
    });
  } catch (error) {
    console.error("Cancel Order Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel your order.",
    });
  }
});

// PATCH: Vendor accepts or rejects an order
router.patch("/:id/status", requireVendor, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Order status must be accepted or rejected.",
      });
    }

    const result = await getOrdersCollection().updateOne(
      {
        _id: new ObjectId(id),
        vendorId: req.user.id,
        status: "pending",
      },
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
        message: "Pending order not found or access denied.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Order ${status} successfully.`,
      status,
    });
  } catch (error) {
    console.error("Update Order Status Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update order status.",
    });
  }
});

export default router;
