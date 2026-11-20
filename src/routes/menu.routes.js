import express from "express";
import { ObjectId } from "mongodb";
import { getMongoClient } from "../config/db.js";
import requireVendor from "../middleware/vendor.middleware.js";

const router = express.Router();

const getDatabase = () => {
  return getMongoClient().db(process.env.DB_NAME || "pizzahub");
};

const getMenuCollection = () => {
  return getDatabase().collection("menuItems");
};

// Check the vendor's current subscription
const getVendorSubscription = async (vendorEmail) => {
  const user = await getDatabase()
    .collection("user")
    .findOne(
      { email: vendorEmail },
      {
        projection: {
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
        },
      },
    );

  const now = new Date();
  const expiryDate = user?.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;

  const isPremium =
    user?.subscriptionPlan === "premium" &&
    expiryDate !== null &&
    Number.isFinite(expiryDate.getTime()) &&
    expiryDate > now;

  return {
    plan: isPremium ? "premium" : "free",
    isPremium,
    expiresAt: user?.subscriptionExpiresAt || null,
  };
};

// Count approved and available menu items
const getActiveMenuCount = async (vendorId) => {
  return getMenuCollection().countDocuments({
    vendorId,
    status: "approved",
    isAvailable: true,
  });
};

// PUBLIC: Get approved and available pizzas
// Supports search, category, price filtering, sorting and pagination.

// PUBLIC: Get approved and available pizzas
// Supports restaurant search, category, price filtering, sorting and pagination.
router.get("/public", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      minPrice,
      maxPrice,
      sort = "newest",
      page = "1",
      limit = "9",
    } = req.query;

    // Validate query parameter types
    if (
      typeof search !== "string" ||
      typeof category !== "string" ||
      typeof sort !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid search or category parameters.",
      });
    }

    const searchText = search.trim();
    const categoryText = category.trim();

    if (searchText.length > 100 || categoryText.length > 60) {
      return res.status(400).json({
        success: false,
        message: "Search or category text is too long.",
      });
    }

    // Validate pagination
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (
      !Number.isInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 50
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination parameters.",
      });
    }

    // Validate price filters
    const parsedMinPrice =
      minPrice !== undefined && minPrice !== ""
        ? Number(minPrice)
        : undefined;

    const parsedMaxPrice =
      maxPrice !== undefined && maxPrice !== ""
        ? Number(maxPrice)
        : undefined;

    if (
      (parsedMinPrice !== undefined &&
        (!Number.isFinite(parsedMinPrice) || parsedMinPrice < 0)) ||
      (parsedMaxPrice !== undefined &&
        (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice < 0)) ||
      (parsedMinPrice !== undefined &&
        parsedMaxPrice !== undefined &&
        parsedMinPrice > parsedMaxPrice)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid price range.",
      });
    }

    // Validate sorting
    const allowedSortOptions = {
      newest: { createdAt: -1, _id: -1 },
      price_asc: { price: 1, _id: 1 },
      price_desc: { price: -1, _id: 1 },
      name_asc: { name: 1, _id: 1 },
      name_desc: { name: -1, _id: 1 },
    };

    if (!Object.hasOwn(allowedSortOptions, sort)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sorting option.",
      });
    }

    const database = getDatabase();
    const menuCollection = getMenuCollection();
    const userCollection = database.collection("user");

    // Find all active, non-blocked vendors
    const vendors = await userCollection
      .find(
        {
          role: "vendor",
          isBlocked: { $ne: true },
          email: { $type: "string", $ne: "" },
        },
        {
          projection: {
            email: 1,
            name: 1,
            restaurantName: 1,
            restaurantAddress: 1,
          },
        },
      )
      .toArray();

    const vendorMap = new Map(
      vendors.map((vendor) => [vendor.email, vendor]),
    );

    const vendorEmails = [...vendorMap.keys()];

    // Only show pizzas belonging to valid vendors
    const baseQuery = {
      status: "approved",
      isAvailable: true,
      vendorEmail: { $in: vendorEmails },
    };

    // Get all available categories, independent of pagination
    const categories = await menuCollection.distinct(
      "category",
      baseQuery,
    );

    const publicCategories = categories
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim())
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));

    // Build the actual menu query
    const query = { ...baseQuery };

    if (categoryText) {
      query.category = categoryText;
    }

    // Search pizza name, description, category and restaurant name
    if (searchText) {
      const escapedSearch = searchText.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

      const searchRegex = new RegExp(escapedSearch, "i");

      const matchingRestaurantEmails = vendors
        .filter(
          (vendor) =>
            typeof vendor.restaurantName === "string" &&
            searchRegex.test(vendor.restaurantName),
        )
        .map((vendor) => vendor.email);

      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
        { vendorEmail: { $in: matchingRestaurantEmails } },
      ];
    }

    // Apply price range
    if (
      parsedMinPrice !== undefined ||
      parsedMaxPrice !== undefined
    ) {
      query.price = {};

      if (parsedMinPrice !== undefined) {
        query.price.$gte = parsedMinPrice;
      }

      if (parsedMaxPrice !== undefined) {
        query.price.$lte = parsedMaxPrice;
      }
    }

    // Count matching items before pagination
    const totalItems = await menuCollection.countDocuments(query);

    const totalPages = Math.ceil(totalItems / parsedLimit);
    const skip = (parsedPage - 1) * parsedLimit;

    // Fetch current page
    const menuItems = await menuCollection
      .find(query)
      .sort(allowedSortOptions[sort])
      .skip(skip)
      .limit(parsedLimit)
      .toArray();

    // Attach vendor information
    const publicMenuItems = menuItems.map((item) => {
      const vendor = vendorMap.get(item.vendorEmail);

      return {
        ...item,
        vendor: {
          name: vendor?.name || "",
          restaurantName: vendor?.restaurantName || "",
          restaurantAddress: vendor?.restaurantAddress || "",
        },
      };
    });

    return res.status(200).json({
      success: true,
      total: totalItems,
      categories: publicCategories,
      menuItems: publicMenuItems,
      pagination: {
        currentPage: parsedPage,
        limit: parsedLimit,
        totalItems,
        totalPages,
        hasNextPage: parsedPage < totalPages,
        hasPreviousPage: parsedPage > 1 && totalPages > 0,
      },
    });
  } catch (error) {
    console.error("Get Public Menu Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load public menu.",
    });
  }
});


// PUBLIC: Get one approved and available pizza's details
router.get("/public/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const menuItem = await getMenuCollection().findOne({
      _id: new ObjectId(id),
      status: "approved",
      isAvailable: true,
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: "Pizza not found or currently unavailable.",
      });
    }

    const vendor = await getDatabase()
      .collection("user")
      .findOne(
        {
          email: menuItem.vendorEmail,
          role: "vendor",
          isBlocked: { $ne: true },
        },
        {
          projection: {
            name: 1,
            restaurantName: 1,
            restaurantAddress: 1,
          },
        },
      );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Pizza not found or currently unavailable.",
      });
    }

    return res.status(200).json({
      success: true,
      menuItem: {
        ...menuItem,
        vendor: {
          name: vendor.name || "",
          restaurantName: vendor.restaurantName || "",
          restaurantAddress: vendor.restaurantAddress || "",
        },
      },
    });
  } catch (error) {
    console.error("Get Public Menu Details Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load pizza details.",
    });
  }
});

// All routes below require an authenticated vendor.

// GET: Get the logged-in vendor's menu items
router.use(requireVendor);

router.get("/", async (req, res) => {
  try {
    const [menuItems, subscription] = await Promise.all([
      getMenuCollection()
        .find({ vendorId: req.user.id })
        .sort({ createdAt: -1 })
        .toArray(),
      getVendorSubscription(req.user.email),
    ]);

    const activeItems = menuItems.filter(
      (item) => item.status === "approved" && item.isAvailable,
    ).length;

    return res.status(200).json({
      success: true,
      menuItems,
      subscription: {
        ...subscription,
        activeItems,
        freePlanLimit: 3,
      },
    });
  } catch (error) {
    console.error("Get Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load menu items.",
    });
  }
});

// POST: Add a new menu item
router.post("/", async (req, res) => {
  try {
    const { name, category, description, price, image } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof category !== "string" ||
      !category.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      price === undefined ||
      price === null ||
      price === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided.",
      });
    }

    const parsedPrice = Number(price);

    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid price.",
      });
    }

    if (
      name.trim().length > 120 ||
      category.trim().length > 60 ||
      description.trim().length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "One or more fields exceed the allowed length.",
      });
    }

    if (
      image !== undefined &&
      (typeof image !== "string" || image.length > 2000)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid image URL.",
      });
    }

    const now = new Date();

    // New items always start as pending.
    const newItem = {
      vendorId: req.user.id,
      vendorEmail: req.user.email,
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      price: parsedPrice,
      image: image?.trim() || "",
      status: "pending",
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await getMenuCollection().insertOne(newItem);

    return res.status(201).json({
      success: true,
      message: "Menu item submitted for approval.",
      menuItem: {
        ...newItem,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Add Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to add menu item.",
    });
  }
});

// PATCH: Update an existing menu item
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const menuCollection = getMenuCollection();

    const existingItem = await menuCollection.findOne({
      _id: new ObjectId(id),
      vendorId: req.user.id,
    });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found or access denied.",
      });
    }

    const { name, category, description, price, image, isAvailable } =
      req.body || {};

    const updates = {};

    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid item name.",
        });
      }

      updates.name = name.trim();
    }

    if (category !== undefined) {
      if (
        typeof category !== "string" ||
        !category.trim() ||
        category.trim().length > 60
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid category.",
        });
      }

      updates.category = category.trim();
    }

    if (description !== undefined) {
      if (
        typeof description !== "string" ||
        !description.trim() ||
        description.trim().length > 1000
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid description.",
        });
      }

      updates.description = description.trim();
    }

    if (price !== undefined) {
      const parsedPrice = Number(price);

      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid price.",
        });
      }

      updates.price = parsedPrice;
    }

    if (image !== undefined) {
      if (typeof image !== "string" || image.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid image URL.",
        });
      }

      updates.image = image.trim();
    }

    if (isAvailable !== undefined) {
      if (typeof isAvailable !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "Availability must be true or false.",
        });
      }

      updates.isAvailable = isAvailable;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update.",
      });
    }

    // Enforce the Free Plan limit when activating an approved item.
    const isActivatingApprovedItem =
      existingItem.status === "approved" &&
      existingItem.isAvailable !== true &&
      updates.isAvailable === true;

    if (isActivatingApprovedItem) {
      const subscription = await getVendorSubscription(req.user.email);

      if (!subscription.isPremium) {
        const activeCount = await getActiveMenuCount(req.user.id);

        if (activeCount >= 3) {
          return res.status(403).json({
            success: false,
            code: "FREE_PLAN_LIMIT_REACHED",
            message:
              "Your Free Plan allows only 3 active menu items. Deactivate another item or upgrade to Premium.",
            activeItems: activeCount,
            limit: 3,
          });
        }
      }
    }

    updates.updatedAt = new Date();

    const result = await menuCollection.updateOne(
      {
        _id: new ObjectId(id),
        vendorId: req.user.id,
      },
      {
        $set: updates,
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found or access denied.",
      });
    }

    const updatedItem = await menuCollection.findOne({
      _id: new ObjectId(id),
      vendorId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Menu item updated successfully.",
      menuItem: updatedItem,
    });
  } catch (error) {
    console.error("Update Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update menu item.",
    });
  }
});

// DELETE: Delete an existing menu item
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
    }

    const result = await getMenuCollection().deleteOne({
      _id: new ObjectId(id),
      vendorId: req.user.id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found or access denied.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Menu item deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Menu Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to delete menu item.",
    });
  }
});

export default router;
