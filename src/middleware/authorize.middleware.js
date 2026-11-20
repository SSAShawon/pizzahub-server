import { fromNodeHeaders } from "better-auth/node";
import { getMongoClient } from "../config/db.js";

const getUsersCollection = () =>
  getMongoClient()
    .db(process.env.DB_NAME || "pizzahub")
    .collection("user");

const buildUserQuery = (sessionUser) => {
  const conditions = [];

  if (typeof sessionUser.id === "string" && sessionUser.id) {
    conditions.push({ id: sessionUser.id });
  }

  if (typeof sessionUser.email === "string" && sessionUser.email) {
    const email = sessionUser.email.trim().toLowerCase();

    conditions.push({ email }, { email: sessionUser.email });
  }

  return conditions.length ? { $or: conditions } : null;
};

export const requireRole = (allowedRole, roleLabel) => {
  return async (req, res, next) => {
    try {
      const session = await req.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session?.user) {
        return res.status(401).json({
          success: false,
          message: "Please sign in to continue.",
        });
      }

      const query = buildUserQuery(session.user);

      if (!query) {
        return res.status(401).json({
          success: false,
          message: "Please sign in to continue.",
        });
      }

      // Better Auth sessions can contain a snapshot of the user. MongoDB is
      // authoritative for role and blocked status so changes made by an admin
      // take effect immediately, even for an existing session.
      const currentUser = await getUsersCollection().findOne(query, {
        projection: {
          _id: 0,
          id: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
        },
      });

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: "Please sign in to continue.",
        });
      }

      const user = {
        ...session.user,
        ...currentUser,
        role: currentUser.role || "customer",
        isBlocked: currentUser.isBlocked === true,
      };

      if (user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "Your account has been blocked.",
        });
      }

      if (user.role !== allowedRole) {
        return res.status(403).json({
          success: false,
          message: `Access denied. ${roleLabel} account required.`,
        });
      }

      req.user = user;
      req.session = session.session;

      next();
    } catch (error) {
      console.error(`${roleLabel} Authentication Error:`, error.message);

      return res.status(500).json({
        success: false,
        message: "Authentication verification failed.",
      });
    }
  };
};
