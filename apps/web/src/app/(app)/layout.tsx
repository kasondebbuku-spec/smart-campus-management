import { AppShell } from "@/components/AppShell";

// Every page in this folder needs a signed-in user and shares the same header.
export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
