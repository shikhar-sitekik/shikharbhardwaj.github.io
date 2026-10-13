import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Revenue operating system",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a111f" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "text-[13px]" }} />
      </body>
    </html>
  );
}
