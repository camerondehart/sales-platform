import { isAdmin } from "@/lib/auth";
import { getProducts } from "@/lib/storage";
import { isEnabled } from "@/lib/flags";
import AdminLogin from "./AdminLogin";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return <AdminLogin linkLogin={await isEnabled("admin_magic_link").catch(() => false)} />;
  }
  const products = await getProducts();
  return <AdminDashboard initialProducts={products} />;
}
