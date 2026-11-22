import type { Metadata } from "next";
import { MemberDesk } from "@/components/app/MemberDesk";

export const metadata: Metadata = { title: "My savings — SuperSwap" };

export default function AppPage() {
  return <MemberDesk />;
}
