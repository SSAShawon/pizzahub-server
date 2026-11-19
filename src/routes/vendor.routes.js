
import express from "express";
import { getMongoClient } from "../config/db.js";
import requireVendor from "../middleware/vendor.middleware.js";

const router = express.Router();

const getUsersCollection = () => {
  return getMongoClient()
    .db(process.env.DB_NAME || "pizzahub")
    .collection("user");
};

// Vendor Registration
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

    const updateResult = await getUsersCollection().updateOne(
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

// All routes below require an authenticated vendor.
router.use(requireVendor);

// GET: Retrieve the logged-in vendor's restaurant profile
router.get("/profile", async (req, res) => {
  try {
    const user = await getUsersCollection().findOne(
      { email: req.user.email },
      {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          email: 1,
          restaurantName: 1,
          restaurantAddress: 1,
          contactNumber: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Restaurant profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      profile: {
        ownerName: user.name || "",
        email: user.email || "",
        restaurantName: user.restaurantName || "",
        restaurantAddress: user.restaurantAddress || "",
        contactNumber: user.contactNumber || "",
      },
    });
  } catch (error) {
    console.error("Get Vendor Profile Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load restaurant profile.",
    });
  }
});

// PATCH: Update the logged-in vendor's restaurant profile
router.patch("/profile", async (req, res) => {
  try {
    const {
      ownerName,
      restaurantName,
      restaurantAddress,
      contactNumber,
    } = req.body || {};

    const updates = {};

    if (ownerName !== undefined) {
      if (
        typeof ownerName !== "string" ||
        !ownerName.trim() ||
        ownerName.trim().length > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid owner name.",
        });
      }

      updates.name = ownerName.trim();
    }

    if (restaurantName !== undefined) {
      if (
        typeof restaurantName !== "string" ||
        !restaurantName.trim() ||
        restaurantName.trim().length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid restaurant name.",
        });
      }

      updates.restaurantName = restaurantName.trim();
    }

    if (restaurantAddress !== undefined) {
      if (
        typeof restaurantAddress !== "string" ||
        !restaurantAddress.trim() ||
        restaurantAddress.trim().length > 300
      ) {
        return res.status(400).json({
          success: false,
          message: "Address must be between 1 and 300 characters.",
        });
      }

      updates.restaurantAddress = restaurantAddress.trim();
    }

    if (contactNumber !== undefined) {
      if (
        typeof contactNumber !== "string" ||
        !/^[+0-9()\-\s]{7,25}$/.test(contactNumber.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid contact number.",
        });
      }

      updates.contactNumber = contactNumber.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one field to update.",
      });
    }

    updates.updatedAt = new Date();

    const result = await getUsersCollection().updateOne(
      {
        email: req.user.email,
        role: "vendor",
      },
      {
        $set: updates,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Vendor account not found.",
      });
    }

    const updatedUser = await getUsersCollection().findOne(
      { email: req.user.email },
      {
        projection: {
          _id: 0,
          name: 1,
          email: 1,
          restaurantName: 1,
          restaurantAddress: 1,
          contactNumber: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Restaurant profile updated successfully.",
      profile: {
        ownerName: updatedUser.name || "",
        email: updatedUser.email || "",
        restaurantName: updatedUser.restaurantName || "",
        restaurantAddress: updatedUser.restaurantAddress || "",
        contactNumber: updatedUser.contactNumber || "",
      },
    });
  } catch (error) {
    console.error("Update Vendor Profile Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update restaurant profile.",
    });
  }
});

export default router;
