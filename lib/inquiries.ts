// Inquiry persistence — every product inquiry is saved with a userId
// so the admin can view each member's history.

import { promises as fs } from "fs";
import path from "path";

export type Inquiry = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  productId: string;
  productName: string;
  phone?: string;
  message?: string;
  createdAt: number;
  items?: Array<{ productId: string; productName: string; quantity: number }>; // for bulk orders
};

const DATA_FILE = path.join(process.cwd(), "data", "inquiries.json");
const BLOB_KEY = "inquiries.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function blobGet<T>(key: string, fallback: T): Promise<T> {
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: key });
  const match = blobs.find((b) => b.pathname === key);
  if (!match) return fallback;
  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to read ${key} from Blob: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function blobPut(key: string, value: unknown): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(key, JSON.stringify(value, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
  });
}

async function fsRead<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function fsWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export async function getInquiries(): Promise<Inquiry[]> {
  if (useBlob) return blobGet<Inquiry[]>(BLOB_KEY, []);
  return fsRead<Inquiry[]>(DATA_FILE, []);
}

export async function saveInquiries(inquiries: Inquiry[]): Promise<void> {
  try {
    const existing = await (useBlob ? blobGet<Inquiry[]>(BLOB_KEY, []) : fsRead<Inquiry[]>(DATA_FILE, []));
    if (existing.length >= 3 && inquiries.length < Math.ceil(existing.length / 2)) {
      throw new Error(
        `Refusing to write inquiries: existing list has ${existing.length}, ` +
        `new list has only ${inquiries.length}. This looks like accidental data loss.`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Refusing to write")) throw err;
    console.error("Safety guard could not read existing inquiries:", err);
  }

  if (useBlob) return blobPut(BLOB_KEY, inquiries);
  return fsWrite(DATA_FILE, inquiries);
}

export async function addInquiry(args: Omit<Inquiry, "id" | "createdAt">): Promise<Inquiry> {
  const inquiry: Inquiry = {
    ...args,
    id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const all = await getInquiries();
  all.push(inquiry);
  await saveInquiries(all);
  return inquiry;
}

export async function getInquiriesByUser(userId: string): Promise<Inquiry[]> {
  const all = await getInquiries();
  return all
    .filter((i) => i.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
