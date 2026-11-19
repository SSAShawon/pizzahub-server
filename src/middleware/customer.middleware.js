
import { fromNodeHeaders } from "better-auth/node";

const requireCustomer = async (req, res, next) => {
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

    // Check whether the user is a customer
    if (session.user.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Customer account required.",
      });
    }

    // Attach authenticated user information
    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    console.error("Customer Authentication Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication verification failed.",
    });
  }
};

export default requireCustomer;
