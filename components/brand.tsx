import Link from "next/link";
import { MapPinCheckInside } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? "brand-light" : ""}`} aria-label="Presence home">
      <span className="brand-mark"><MapPinCheckInside size={20} strokeWidth={2.3} /></span>
      <span>Presence</span>
    </Link>
  );
}
