
import dns from "node:dns";
import { MongoClient } from "mongodb";

// Google DNS is only used for local development.
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

let client;
let database;
let connectionPromise;

export const getMongoClient = () => {
  if (!client) {
    throw new Error("MongoDB client is not initialized");
  }

  return client;
};

const connectDB = async () => {
  if (database) {
    return database;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGODB_URI is missing");
    }

    const mongoClient = new MongoClient(uri);

    await mongoClient.connect();

    client = mongoClient;
    database = mongoClient.db(
      process.env.DB_NAME || "pizzahub"
    );

    console.log("✅ MongoDB Connected Successfully!");

    return database;
  })();

  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    client = null;
    database = null;

    console.error(
      "❌ MongoDB Connection Failed:",
      error.message
    );

    throw error;
  }
};

export default connectDB;
