import { SignJWT } from "/tmp/final/node_modules/jose/dist/node/esm/index.js";
const key = new TextEncoder().encode("test-secret-at-least-32-characters-long!!");
const admin = await new SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
const member = await new SignJWT({ role: "visitor", userId: "u_member" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
const dev = await new SignJWT({ role: "admin", email: "dev@example.com" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
const staff = await new SignJWT({ role: "admin", email: "sam@example.com" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
console.log(JSON.stringify({ admin, member, dev, staff }));
