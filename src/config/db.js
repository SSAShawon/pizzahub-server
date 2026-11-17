
import dns from "node:dns";
import { MongoClient } from "mongodb";

// Use Google DNS to resolve MongoDB SRV records
dns.setServers(["8.8.8.8", "8.8.4.4"]);

let client;
let database;

const connectDB = async () => {
  try {
    if (database) {
      return database;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGODB_URI is missing from environment variables");
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
