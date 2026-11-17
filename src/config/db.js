
import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

let client;
let database;

export const getMongoClient = () => {
  if (!client) {
    throw new Error("MongoDB client is not initialized");
  }

  return client;
};

const connectDB = async () => {
  try {
    if (database) {
      return database;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGODB_URI is missing");
    }

    client = new MongoClient(uri);

    await client.connect();

    database = client.db(process.env.DB_NAME || "pizzahub");

    console.log("✅ MongoDB Connected Successfully!");

    return database;
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error.message);
    throw error;
  }
};

export default connectDB;
