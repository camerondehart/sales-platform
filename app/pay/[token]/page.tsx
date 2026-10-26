import PayClient from "./PayClient";
import { brand } from "@/lib/brand";

export const metadata = { title: `Your order · ${brand.name}` };

export default function PayPage({ params }: { params: { token: string } }) {
  return <PayClient token={params.token} />;
}
