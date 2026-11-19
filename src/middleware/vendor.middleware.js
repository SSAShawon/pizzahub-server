
import { fromNodeHeaders } from "better-auth/node";

const requireVendor = async (req, res, next) => {
  try {
    const session = await req.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    // Check whether the user is logged in
    if (!session?.user) {
      return res.status(401).json({
        success: false,
        message: "Please sign in to continue.",
      });
    }

    // Check whether the account is blocked
    if (session.user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked.",
      });
    }

    // Check whether the user is a vendor
    if (session.user.role !== "vendor") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Vendor account required.",
      });
    }

    // Attach authenticated user information
    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    console.error("Vendor Authentication Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication verification failed.",
    });
  }
};

export default requireVendor;
