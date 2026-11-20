import assert from "node:assert/strict";
import test from "node:test";
import { getPasswordError } from "./password.js";

test("accepts a valid password", () => {
  assert.equal(getPasswordError("Abcdef"), null);
});

test("rejects passwords shorter than six characters", () => {
  assert.equal(
    getPasswordError("Abcde"),
    "Password must contain at least 6 characters."
  );
});

test("rejects passwords without an uppercase letter", () => {
  assert.equal(
    getPasswordError("abcdef"),
    "Password must contain at least one uppercase letter."
  );
});

test("rejects passwords without a lowercase letter", () => {
  assert.equal(
    getPasswordError("ABCDEF"),
    "Password must contain at least one lowercase letter."
  );
});

test("rejects non-string passwords", () => {
  assert.equal(getPasswordError(undefined), "Password is required.");
});
