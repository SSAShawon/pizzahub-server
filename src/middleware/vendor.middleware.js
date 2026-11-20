import { requireRole } from "./authorize.middleware.js";

const requireVendor = requireRole("vendor", "Vendor");

export default requireVendor;
