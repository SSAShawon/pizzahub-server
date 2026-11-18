import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { getMongoClient } from "../config/db.js";

const createAuth = () => {
  const client = getMongoClient();
  const db = client.db(process.env.DB_NAME || "pizzahub");

  const auth = betterAuth({
    appName: "PizzaHub",

    baseURL: process.env.BETTER_AUTH_URL,

    secret: process.env.BETTER_AUTH_SECRET,

    trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],

    database: mongodbAdapter(db, {
      client,
    }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
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
      },
    },

    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
  });

  return auth;
};

export default createAuth;
