import Image from "next/image";
import logo from "../../public/brand/exato-logo.png";
import mark from "../../public/brand/exato-mark.png";
import { APP_NAME } from "@/lib/config";

/** Full Exato.ai logo (artwork has its own white background). */
export function BrandLogo({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <Image
      src={logo}
      alt="Exato.ai"
      height={height}
      style={{ width: "auto", height }}
      className={className}
      priority
    />
  );
}

/** Circular Exato symbol only, for tight spaces. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return <Image src={mark} alt="Exato.ai" width={size} height={size} className={className} priority />;
}

export function BrandName() {
  return <span className="font-semibold tracking-[-0.01em]">{APP_NAME}</span>;
}
