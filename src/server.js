
import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

// Vercel Serverless Handler
const handler = async (req, res) => {
  try {
    await connectDB();

    return app(req, res);
  } catch (error) {
    console.error("❌ Server Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// Local Development Server
if (process.env.NODE_ENV !== "production") {
  const startServer = async () => {
    try {
      await connectDB();

      app.listen(PORT, () => {
        console.log(`🍕 PizzaHub Server running on port ${PORT}`);
        console.log(`🌐 Server URL: http://localhost:${PORT}`);
      });
    } catch (error) {
      console.error("❌ Server Startup Failed:", error.message);
      process.exit(1);
    }
  };

  startServer();
}

export default handler;
