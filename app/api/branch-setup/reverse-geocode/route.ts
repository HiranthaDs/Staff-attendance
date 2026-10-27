import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse({ lat: url.searchParams.get("lat"), lng: url.searchParams.get("lng") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid coordinates." }, { status: 400 });
  try {
    const lookup = new URL("https://nominatim.openstreetmap.org/reverse");
    lookup.searchParams.set("format", "jsonv2");
    lookup.searchParams.set("lat", String(parsed.data.lat));
    lookup.searchParams.set("lon", String(parsed.data.lng));
    lookup.searchParams.set("zoom", "18");
    lookup.searchParams.set("addressdetails", "1");
    const response = await fetch(lookup, {
      headers: { "User-Agent": "PresenceAttendance/1.0 (branch setup address lookup)" },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Lookup failed");
    const result = await response.json();
    return NextResponse.json({ address: result.display_name || "" });
  } catch {
    return NextResponse.json({ address: "" });
  }
}
