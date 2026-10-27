import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { localDateParts } from "@/lib/attendance";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid employee." }, { status: 400 });
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;

  const [profileResult, attendanceResult, leaveResult] = await Promise.all([
    actor.admin.from("profiles").select("*, branch:branches(*)").eq("id", parsed.data).neq("role", "super_admin").maybeSingle(),
    actor.admin.from("attendance_records").select("*, branch:branches(name, code)").eq("user_id", parsed.data).gte("attendance_date", yearStart).lte("attendance_date", yearEnd).order("attendance_date", { ascending: false }),
    actor.admin.from("leave_requests").select("*").eq("user_id", parsed.data).lte("start_date", yearEnd).gte("end_date", yearStart).order("start_date", { ascending: false }),
  ]);
  if (!profileResult.data) return NextResponse.json({ error: "Employee profile was not found." }, { status: 404 });
  if (profileResult.error || attendanceResult.error || leaveResult.error) {
    return NextResponse.json({ error: "The employee details could not be loaded." }, { status: 500 });
  }
  return NextResponse.json({
    profile: profileResult.data,
    attendance: attendanceResult.data ?? [],
    leaves: leaveResult.data ?? [],
  });
}
