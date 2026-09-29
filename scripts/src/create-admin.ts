// Seeds (or resets the password of) an admin dashboard user.
// Usage: npm run create-admin -- admin@relaypay.example "a-strong-password"
import bcrypt from "bcryptjs";
import { serviceClient } from "./lib.js";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run create-admin -- <email> "<password>"');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Use a password of at least 10 characters.");
    process.exit(1);
  }
  const password_hash = await bcrypt.hash(password, 12);
  const { error } = await serviceClient()
    .from("admin_users")
    .upsert({ email: email.toLowerCase(), password_hash }, { onConflict: "email" });
  if (error) throw error;
  console.log(`Admin user ready: ${email.toLowerCase()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
