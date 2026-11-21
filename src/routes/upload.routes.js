import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ensure uploads folder exists in server directory
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, "-")
      .slice(0, 30);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${cleanName || "pizza"}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|webp|gif/;
  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  const mime = file.mimetype.toLowerCase();

  if (
    allowedExtensions.test(ext) &&
    (mime.startsWith("image/") || allowedExtensions.test(mime))
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only image files (JPG, PNG, WebP, GIF) are allowed!"
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter,
});

/**
 * POST /api/upload
 * Accepts an image file from the vendor's PC.
 * If IMGBB_API_KEY is configured in .env, uploads to ImgBB for permanent hosting.
 * Otherwise, stores locally on the server in /uploads and returns the accessible URL.
 */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided. Please select a photo from your PC.",
      });
    }

    const imgbbKey =
      process.env.IMGBB_API_KEY?.trim() || "791b23ab6f31150a1f3a44ac96208dd0";

    // 1. Try uploading to ImgBB
    if (imgbbKey) {
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const base64Image = fileBuffer.toString("base64");

        const bodyParams = new URLSearchParams();
        bodyParams.append("image", base64Image);

        const imgbbResponse = await fetch(
          `https://api.imgbb.com/1/upload?key=${imgbbKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyParams,
          }
        );

        const imgbbData = await imgbbResponse.json();

        if (imgbbData.success && (imgbbData.data?.url || imgbbData.data?.display_url)) {
          const finalUrl = imgbbData.data.display_url || imgbbData.data.url;

          // Remove local file after successful ImgBB upload
          fs.unlink(req.file.path, () => {});

          return res.status(200).json({
            success: true,
            url: finalUrl,
            message: "Image uploaded successfully to ImgBB!",
          });
        }
      } catch (imgbbErr) {
        console.warn(
          "⚠️ ImgBB upload failed, falling back to local server storage:",
          imgbbErr.message
        );
      }
    }

    // 2. Fallback to local server storage
    const clientUrl =
      process.env.CLIENT_URL?.split(",")[0].trim() || "http://localhost:3000";
    const serverPort = process.env.PORT || 5000;
    const serverHost = req.get("host") || `localhost:${serverPort}`;
    const protocol = req.protocol || "http";

    const localUrl = `${protocol}://${serverHost}/uploads/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      url: localUrl,
      filename: req.file.filename,
      message: "Image uploaded successfully to server!",
    });
  } catch (error) {
    console.error("❌ Upload Route Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload image.",
    });
  }
});

// Error handling middleware for multer errors (e.g. file too large)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Image file is too large. Maximum size allowed is 5MB.",
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Image upload failed.",
    });
  }
  next();
});

export default router;
