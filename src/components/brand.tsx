import { APP_NAME } from "@/lib/config";

export function BrandMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="5" fill="#1f5fd6" />
      <path d="M7 7h10v2.2H9.4v1.7h6.4v2.2H9.4v1.7H17V17H7z" fill="#fff" />
    </svg>
  );
}

export function BrandName() {
  return <span className="font-semibold tracking-[-0.01em]">{APP_NAME}</span>;
}
