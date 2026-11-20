import { requireRole } from "./authorize.middleware.js";

const requireAdmin = requireRole("admin", "Admin");

export default requireAdmin;
