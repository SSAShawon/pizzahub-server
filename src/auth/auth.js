
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { hashPassword } from "better-auth/crypto";
import { jwt } from "better-auth/plugins";
import { getMongoClient } from "../config/db.js";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "../utils/password.js";

const createAuth = () => {
  const client = getMongoClient();
  const db = client.db(process.env.DB_NAME || "pizzahub");

  const configuredOrigins = (process.env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const trustedOrigins = configuredOrigins.length
    ? [...new Set(configuredOrigins)]
    : process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000"];

  const auth = betterAuth({
    appName: "PizzaHub",

    baseURL: process.env.BETTER_AUTH_URL,

    secret: process.env.BETTER_AUTH_SECRET,

    trustedOrigins,

    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },

    session: {
      // Protected endpoints independently re-check MongoDB, but keeping the
      // server-side session read fresh avoids stale role/blocked snapshots.
      cookieCache: { enabled: false },
    },

    database: mongodbAdapter(db, {
      client,
    }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: {
        hash: async (password) => {
          validatePassword(password);
          return hashPassword(password);
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              role: "customer",
              isBlocked: false,
            },
          }),
        },
      },
    },

    user: {
      additionalFields: {
        role: {
          type: ["customer", "vendor", "admin"],
          required: false,
          defaultValue: "customer",
          input: false,
        },

        isBlocked: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },

        restaurantName: {
          type: "string",
          required: false,
          input: false,
        },

        restaurantAddress: {
          type: "string",
          required: false,
          input: false,
        },

        contactNumber: {
          type: "string",
          required: false,
          input: false,
        },

        // Customer delivery information
        deliveryAddress: {
          type: "string",
          required: false,
        },

        phoneNumber: {
          type: "string",
          required: false,
        },
      },
    },

    socialProviders:
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    // Issues signed JWTs at /api/auth/token and exposes the public key set at
    // /api/auth/jwks. The Express middleware can verify Bearer tokens as an
    // alternative to the Better Auth session cookie.
    plugins: [jwt()],
  });

  return auth;
};

export default createAuth;
