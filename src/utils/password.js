import { APIError } from "better-auth/api";

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

export const getPasswordError = (password) => {
  if (typeof password !== "string") {
    return "Password is required.";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters.`;
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }

  return null;
};

export const validatePassword = (password) => {
  const error = getPasswordError(password);

  if (error) {
    throw new APIError("BAD_REQUEST", { message: error });
  }

  return true;
};
