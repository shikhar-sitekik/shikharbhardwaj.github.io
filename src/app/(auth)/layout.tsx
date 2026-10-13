import type { ReactNode } from "react";
import { BrandMark, BrandName } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex h-14 items-center gap-2 px-6 text-[15px] text-text">
        <BrandMark />
        <BrandName />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
