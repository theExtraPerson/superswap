import type { Metadata } from "next";
import { AdminDesk } from "@/components/admin/AdminDesk";

export const metadata: Metadata = {
  title: "Ops Desk · SuperSwap",
  description: "Admin operations desk for SuperSwap — settlement queues, reserve and money rules.",
};

/** The desk is a client app over /api/admin/* — no server data fetched here. */
export default function AdminPage() {
  return <AdminDesk />;
}
