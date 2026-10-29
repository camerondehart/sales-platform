import { isAdmin } from "@/lib/auth";
import { getProducts } from "@/lib/storage";
import { isEnabled } from "@/lib/flags";
import AdminLogin from "./AdminLogin";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) {
    const [linkLogin, passkeys, dailyPhrase] = await Promise.all([isEnabled("admin_magic_link").catch(() => false), isEnabled("admin_passkeys").catch(() => false), isEnabled("rotating_staff_password").catch(() => false)]);
    return <AdminLogin linkLogin={linkLogin} passkeys={passkeys} dailyPhrase={dailyPhrase} />;
  }
  const products = await getProducts();
  return <AdminDashboard initialProducts={products} />;
}
