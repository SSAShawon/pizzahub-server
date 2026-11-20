
import express from "express";
import { getMongoClient } from "../config/db.js";
import requireCustomer from "../middleware/customer.middleware.js";

const router = express.Router();

const getUsersCollection = () => {
  return getMongoClient()
    .db(process.env.DB_NAME || "pizzahub")
    .collection("user");
};

// All routes require an authenticated customer
router.use(requireCustomer);

// GET: Get current customer's profile
router.get("/me", async (req, res) => {
  try {
    const user = await getUsersCollection().findOne(
      { email: req.user.email },
      {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          email: 1,
          phoneNumber: 1,
          deliveryAddress: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get Customer Profile Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve profile.",
    });
  }
});

// PATCH: Update current customer's profile
router.patch("/me", async (req, res) => {
  try {
    const { name, phoneNumber, deliveryAddress } = req.body;

    const updates = {};

    // Validate and update name
    if (name !== undefined) {
      const cleanName = String(name).trim();

      if (cleanName.length < 2 || cleanName.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 50 characters.",
        });
      }

      updates.name = cleanName;
    }

    // Validate and update phone number
    if (phoneNumber !== undefined) {
      const cleanPhone = String(phoneNumber).replace(/[\s-]/g, "");

      if (!/^(01[3-9]\d{8}|\+8801[3-9]\d{8})$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid phone number.",
        });
      }

      updates.phoneNumber = cleanPhone;
    }

    // Validate and update delivery address
    if (deliveryAddress !== undefined) {
      const cleanAddress = String(deliveryAddress).trim();

      if (cleanAddress.length < 10 || cleanAddress.length > 300) {
        return res.status(400).json({
          success: false,
          message: "Delivery address must be between 10 and 300 characters.",
        });
      }

      updates.deliveryAddress = cleanAddress;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one field to update.",
      });
    }

    updates.updatedAt = new Date();

    await getUsersCollection().updateOne(
      { email: req.user.email },
      { $set: updates }
    );

    const updatedUser = await getUsersCollection().findOne(
      { email: req.user.email },
      {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          email: 1,
          phoneNumber: 1,
          deliveryAddress: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update Customer Profile Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile.",
    });
  }
});

export default router;
