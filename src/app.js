
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node";
import createAuth from "./auth/auth.js";
import vendorRoutes from "./routes/vendor.routes.js";
import menuRoutes from "./routes/menu.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import adminUsersRoutes from "./routes/admin.users.routes.js";
import adminVendorsRoutes from "./routes/admin.vendors.routes.js";
import adminTransactionsRoutes from "./routes/admin.transactions.routes.js";

dotenv.config();

const app = express();

// CORS Configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Better Auth Configuration
let auth;

app.use(async (req, res, next) => {
  try {
    if (!auth) {
      auth = createAuth();
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
});

// Better Auth Routes (must be before express.json)
app.all("/api/auth/{*any}", (req, res, next) => {
  toNodeHandler(req.auth)(req, res).catch(next);
});

// JSON Middleware
app.use(express.json());

// Vendor Routes
app.use("/api/vendors", vendorRoutes);

// Menu Routes
app.use("/api/menu", menuRoutes);

// Admin Routes
app.use("/api/admin", adminRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/vendors", adminVendorsRoutes);
app.use("/api/admin/transactions", adminTransactionsRoutes);
// Home Route
app.get("/", (req, res) => {
  res.send("Welcome to PizzaHub API!");
});

// Health Check Route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "PizzaHub API is running successfully!",
  });
});

export default app;
