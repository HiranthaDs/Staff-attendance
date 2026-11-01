import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";

const querySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
}).refine((value) => value.end >= value.start, "Invalid date range");

export async function GET(request: Request) {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  if (actor.profile.role === "super_admin" || actor.profile.role === "company_admin") {
    return NextResponse.json({ error: "Attendance history is available to employee accounts only." }, { status: 403 });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ start: url.searchParams.get("start"), end: url.searchParams.get("end") });
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid calendar month." }, { status: 400 });
  const span = (Date.parse(`${parsed.data.end}T12:00:00Z`) - Date.parse(`${parsed.data.start}T12:00:00Z`)) / 86_400_000;
  if (span > 45) return NextResponse.json({ error: "Attendance history can be loaded one month at a time." }, { status: 400 });

  const { data, error } = await actor.admin.from("attendance_records")
    .select("*, branch:branches(name,code)")
    .eq("user_id", actor.user.id)
    .gte("attendance_date", parsed.data.start)
    .lte("attendance_date", parsed.data.end)
    .order("attendance_date", { ascending: false });
  if (error) return NextResponse.json({ error: "Attendance history could not be loaded." }, { status: 500 });
  return NextResponse.json({ attendance: data ?? [] }, { headers: { "cache-control": "private, no-store" } });
}
