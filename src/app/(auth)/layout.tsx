import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex h-16 items-center bg-white px-6 shadow-[0_1px_0_var(--border)]">
        <BrandLogo height={36} />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
