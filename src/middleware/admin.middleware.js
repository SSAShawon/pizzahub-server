
import { fromNodeHeaders } from "better-auth/node";

const requireAdmin = async (req, res, next) => {
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

    if (session.user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked.",
      });
    }

    if (session.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin account required.",
      });
    }

    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    console.error("Admin Authentication Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication verification failed.",
    });
  }
};

export default requireAdmin;
