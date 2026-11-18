
import express from "express";
import { getMongoClient } from "../config/db.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  let createdUserId = null;
  let auth = null;

  try {
    const {
      ownerName,
      restaurantName,
      email,
      password,
      restaurantAddress,
      contactNumber,
    } = req.body || {};

    if (
      !ownerName?.trim() ||
      !restaurantName?.trim() ||
      !email?.trim() ||
      !password ||
      !restaurantAddress?.trim() ||
      !contactNumber?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password must contain 8 to 128 characters.",
      });
    }

    if (
      ownerName.trim().length > 100 ||
      restaurantName.trim().length > 120 ||
      restaurantAddress.trim().length > 300 ||
      contactNumber.trim().length > 25
    ) {
      return res.status(400).json({
        success: false,
        message: "One or more fields exceed the allowed length.",
      });
    }

    auth = req.auth;

    const normalizedEmail = email.trim().toLowerCase();

    // Create account using Better Auth
    const result = await auth.api.signUpEmail({
      body: {
        name: ownerName.trim(),
        email: normalizedEmail,
        password,
      },
    });

    if (!result?.user?.id) {
      throw new Error("User account creation failed.");
    }

    createdUserId = result.user.id;

    // Update the user directly through MongoDB
    const db = getMongoClient().db(
      process.env.DB_NAME || "pizzahub"
    );

    const updateResult = await db.collection("user").updateOne(
  { email: normalizedEmail },
      {
        $set: {
          role: "vendor",
          restaurantName: restaurantName.trim(),
          restaurantAddress: restaurantAddress.trim(),
          contactNumber: contactNumber.trim(),
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.matchedCount !== 1) {
      throw new Error("Vendor profile update failed.");
    }

    return res.status(201).json({
      success: true,
      message: "Vendor account created successfully.",
      user: {
        id: createdUserId,
        name: ownerName.trim(),
        email: normalizedEmail,
        role: "vendor",
        restaurantName: restaurantName.trim(),
      },
    });
  } catch (error) {
    console.error("Vendor Registration Error:", error.message);

    if (createdUserId && auth) {
      try {
        const authContext = await auth.$context;
        await authContext.internalAdapter.deleteUser(createdUserId);
      } catch (cleanupError) {
        console.error("Account Cleanup Error:", cleanupError.message);
      }
    }

    return res.status(400).json({
      success: false,
      message:
        "Unable to create vendor account. Please check your details or use another email address.",
    });
  }
});

export default router;
