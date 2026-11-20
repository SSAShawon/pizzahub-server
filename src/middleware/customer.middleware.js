import { requireRole } from "./authorize.middleware.js";

const requireCustomer = requireRole("customer", "Customer");

export default requireCustomer;
