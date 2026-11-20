import assert from "node:assert/strict";
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import connectDB, { getMongoClient } from "../src/config/db.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Do not run auth integration tests against production.");
}

const BASE_URL = "http://localhost:5000";
const ORIGIN = "http://localhost:3000";
const suffix = Date.now().toString();
const emails = {
  customer: `audit.customer.${suffix}@example.com`,
  vendor: `audit.vendor.${suffix}@example.com`,
  admin: `audit.admin.${suffix}@example.com`,
};

const results = [];
const createdUserIds = [];

function createJar() {
  return new Map();
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function storeCookies(jar, headers) {
  const values =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of values) {
    const pair = raw.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function api(jar, path, { method = "GET", body } = {}) {
  const headers = { origin: ORIGIN };
  const cookies = cookieHeader(jar);
  if (cookies) headers.cookie = cookies;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  storeCookies(jar, response.headers);

  let data;
  try {
    data = await response.json();
  } catch {
    data = await response.text();
  }

  return { status: response.status, data };
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}

await connectDB();
const db = getMongoClient().db(process.env.DB_NAME || "pizzahub");
const users = db.collection("user");
const accounts = db.collection("account");
const sessions = db.collection("session");

try {
  // Remove leftovers from interrupted audit runs.
  const auditEmailPattern = /^audit\.(customer|vendor|admin|short|lower|upper)\./;
  const leftoverUsers = await users
    .find({ email: { $regex: auditEmailPattern } })
    .toArray();
  const leftoverIds = leftoverUsers.map((user) => user._id);
  await sessions.deleteMany({ userId: { $in: leftoverIds } });
  await accounts.deleteMany({ userId: { $in: leftoverIds } });
  await users.deleteMany({ _id: { $in: leftoverIds } });

  const customerJar = createJar();
  const vendorJar = createJar();
  const adminJar = createJar();

  await check("short password rejected", async () => {
    const result = await api(customerJar, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Audit Short",
        email: `audit.short.${suffix}@example.com`,
        password: "Abcde",
      },
    });
    assert.equal(result.status, 400);
    assert.match(result.data.message, /too short|at least 6 characters/);
  });

  await check("password without uppercase rejected", async () => {
    const result = await api(customerJar, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Audit Lower",
        email: `audit.lower.${suffix}@example.com`,
        password: "abcdef",
      },
    });
    assert.equal(result.status, 400);
    assert.match(result.data.message, /uppercase letter/);
  });

  await check("password without lowercase rejected", async () => {
    const result = await api(customerJar, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Audit Upper",
        email: `audit.upper.${suffix}@example.com`,
        password: "ABCDEF",
      },
    });
    assert.equal(result.status, 400);
    assert.match(result.data.message, /lowercase letter/);
  });

  await check(
    "customer registration ignores client privileged fields",
    async () => {
      const result = await api(customerJar, "/api/auth/sign-up/email", {
        method: "POST",
        body: {
          name: "Audit Customer",
          email: emails.customer,
          password: "Abcdef",
          image: "https://example.com/audit.png",
          role: "admin",
          isBlocked: true,
          subscriptionPlan: "pro",
        },
      });
      assert.equal(result.status, 200, JSON.stringify(result.data));

      const user = await users.findOne({ email: emails.customer });
      assert.ok(user, "customer user not created");
      createdUserIds.push(user.id || user._id);
      assert.equal(user.role, "customer");
      assert.equal(user.isBlocked, false);
      assert.equal(user.subscriptionPlan, undefined);
    }
  );

  await check("no public admin registration endpoint", async () => {
    const result = await api(createJar(), "/api/admin/register", {
      method: "POST",
      body: {
        name: "Audit Admin",
        email: emails.admin,
        password: "AdminPass1",
      },
    });
    assert.equal(result.status, 401);
  });

  await check("customer sign-in creates usable session", async () => {
    const result = await api(customerJar, "/api/auth/sign-in/email", {
      method: "POST",
      body: { email: emails.customer, password: "Abcdef" },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));

    const me = await api(customerJar, "/api/users/me");
    assert.equal(me.status, 200, JSON.stringify(me.data));
  });

  await check("customer cannot access admin or vendor APIs", async () => {
    const admin = await api(customerJar, "/api/admin/users");
    assert.equal(admin.status, 403);
    assert.match(admin.data.message, /Admin account required/);

    const vendor = await api(customerJar, "/api/vendors/profile");
    assert.equal(vendor.status, 403);
    assert.match(vendor.data.message, /Vendor account required/);
  });

  await check("profile update cannot change role or block status", async () => {
    const result = await api(customerJar, "/api/users/me", {
      method: "PATCH",
      body: {
        name: "Audit Customer Updated",
        phoneNumber: "01712345678",
        deliveryAddress: "123 Audit Street, Test City",
        role: "admin",
        isBlocked: true,
        subscriptionPlan: "pro",
      },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));

    const user = await users.findOne({ email: emails.customer });
    assert.equal(user.role, "customer");
    assert.equal(user.isBlocked, false);
    assert.equal(user.subscriptionPlan, undefined);
  });

  await check("live block denies an existing session", async () => {
    await users.updateOne(
      { email: emails.customer },
      { $set: { isBlocked: true } }
    );

    const blocked = await api(customerJar, "/api/users/me");
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.message, /blocked/);

    await users.updateOne(
      { email: emails.customer },
      { $set: { isBlocked: false } }
    );

    const restored = await api(customerJar, "/api/users/me");
    assert.equal(restored.status, 200);
  });

  await check("sign-out invalidates the session", async () => {
    const result = await api(customerJar, "/api/auth/sign-out", {
      method: "POST",
      body: {},
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));

    const me = await api(customerJar, "/api/users/me");
    assert.equal(me.status, 401);
  });

  await check("vendor registration and vendor API access", async () => {
    const result = await api(createJar(), "/api/vendors/register", {
      method: "POST",
      body: {
        ownerName: "Audit Vendor",
        restaurantName: "Audit Pizzeria",
        email: emails.vendor,
        image: "https://example.com/vendor.png",
        password: "VendorPass1",
        restaurantAddress: "456 Vendor Road, Test City",
        contactNumber: "01712345679",
        role: "admin",
        isBlocked: true,
      },
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));

    const user = await users.findOne({ email: emails.vendor });
    assert.ok(user, "vendor user not created");
    createdUserIds.push(user.id || user._id);
    assert.equal(user.role, "vendor");
    assert.equal(user.isBlocked, false);
    assert.equal(user.image, "https://example.com/vendor.png");
    assert.equal(user.restaurantName, "Audit Pizzeria");

    const signIn = await api(vendorJar, "/api/auth/sign-in/email", {
      method: "POST",
      body: { email: emails.vendor, password: "VendorPass1" },
    });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.data));

    const profile = await api(vendorJar, "/api/vendors/profile");
    assert.equal(profile.status, 200, JSON.stringify(profile.data));

    const admin = await api(vendorJar, "/api/admin/users");
    assert.equal(admin.status, 403);

    const customer = await api(vendorJar, "/api/users/me");
    assert.equal(customer.status, 403);
  });

  await check("Mongo-provisioned admin can access admin APIs", async () => {
    const sampleCustomer = await users.findOne({ email: emails.customer });
    const sampleAccount = await accounts.findOne({
      userId: sampleCustomer._id,
    });
    assert.ok(sampleAccount, "sample credential account not found");

    const ObjectId = sampleCustomer._id.constructor;
    const adminObjectId = new ObjectId();
    const adminId = adminObjectId.toString();

    const adminUser = {
      ...sampleCustomer,
      _id: adminObjectId,
      name: "Audit Admin",
      email: emails.admin,
      role: "admin",
      isBlocked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    delete adminUser.subscriptionPlan;
    delete adminUser.restaurantName;
    delete adminUser.restaurantAddress;
    delete adminUser.contactNumber;

    const adminAccountId =
      typeof sampleAccount.accountId === "string"
        ? adminId
        : sampleAccount.accountId.equals(sampleCustomer._id)
          ? adminObjectId
          : `audit-admin-${suffix}`;

    const adminAccount = {
      ...sampleAccount,
      _id: new (sampleAccount._id.constructor)(),
      userId: adminObjectId,
      accountId: adminAccountId,
      password: await hashPassword("AdminPass1"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await users.insertOne(adminUser);
    createdUserIds.push(adminObjectId);
    await accounts.insertOne(adminAccount);

    const signIn = await api(adminJar, "/api/auth/sign-in/email", {
      method: "POST",
      body: { email: emails.admin, password: "AdminPass1" },
    });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.data));

    const admin = await api(adminJar, "/api/admin/users");
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
  });
} finally {
  await sessions.deleteMany({ userId: { $in: createdUserIds } });
  await accounts.deleteMany({ userId: { $in: createdUserIds } });
  await users.deleteMany({
    $or: [{ id: { $in: createdUserIds } }, { _id: { $in: createdUserIds } }],
  });
  await getMongoClient().close();

  console.log("\nSummary");
  for (const result of results) {
    console.log(`${result.status}  ${result.name}`);
  }
  const failed = results.filter((result) => result.status === "FAIL").length;
  console.log(
    `Total: ${results.length}, Passed: ${results.length - failed}, Failed: ${failed}`
  );
  if (failed > 0) process.exitCode = 1;
}
