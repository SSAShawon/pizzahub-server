
import express from "express";
import requireAdmin from "../middleware/admin.middleware.js";
import { getMongoClient } from "../config/db.js";

const router = express.Router();

router.use(requireAdmin);

const getUsersCollection = () => {
  const db = getMongoClient().db(process.env.DB_NAME || "pizzahub");
  return db.collection("user");
};

// GET: Get all customers and vendors
router.get("/", async (req, res) => {
  try {
    const users = await getUsersCollection()
      .find(
        { role: { $in: ["customer", "vendor"] } },
        {
          projection: {
            name: 1,
            email: 1,
            role: 1,
            image: 1,
            isBlocked: 1,
            restaurantName: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      totalUsers: users.length,
      users,
    });
  } catch (error) {
    console.error("Admin Get Users Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load users.",
    });
  }
});

// PATCH: Block or unblock user using email
router.patch("/:email/status", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    const { isBlocked } = req.body;

    if (!email || typeof isBlocked !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "A valid email and account status are required.",
      });
    }

    const usersCollection = getUsersCollection();

    const targetUser = await usersCollection.findOne({
      email,
      role: { $in: ["customer", "vendor"] },
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (targetUser.email === req.user.email) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own account status.",
      });
    }

    await usersCollection.updateOne(
      { email },
      {
        $set: {
          isBlocked,
          updatedAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: isBlocked
        ? "User blocked successfully."
        : "User unblocked successfully.",
      user: {
        email,
        isBlocked,
      },
    });
  } catch (error) {
    console.error("Admin Update User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user status.",
    });
  }
});

export default router;
