"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, eachDayOfInterval, format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin, Moon, Palmtree, Plus, StickyNote, Sun, Trash2, X } from "lucide-react";
import { dateRange, scheduleForDate } from "@/lib/workday";
import type { AttendanceRecord, Branch, CalendarNote, CompanyHoliday, LeaveRequest, WorkScheduleDay } from "@/lib/types";

type CalendarItem =
  | { id: string; date: string; title: string; description: string | null; kind: "note"; branchName: string | null; note: CalendarNote }
  | { id: string; date: string; title: string; description: string | null; kind: "poya" | "public" | "company" | "special" | "pending_holiday"; branchName: string | null; holiday: CompanyHoliday }
  | { id: string; date: string; title: string; description: string; kind: "leave" | "short_leave" | "timing" | "schedule_half" | "schedule_off"; branchName: null };

export function WorkCalendar({
  today,
  initialNotes,
  initialHolidays = [],
  canManage = false,
  canProposeHoliday = false,
  branches = [],
  title = "Calendar & schedule",
  attendance = [],
  leaves = [],
  workSchedule = [],
}: {
  today: string;
  initialNotes: CalendarNote[];
  initialHolidays?: CompanyHoliday[];
  canManage?: boolean;
  canProposeHoliday?: boolean;
  branches?: Branch[];
  title?: string;
  attendance?: AttendanceRecord[];
  leaves?: LeaveRequest[];
  workSchedule?: WorkScheduleDay[];
}) {
  const router = useRouter();
  const todayDate = parseISO(`${today}T12:00:00`);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(todayDate));
  const [selectedDate, setSelectedDate] = useState(today);
  const [addedNotes, setAddedNotes] = useState<CalendarNote[]>([]);
  const [realtimeNotes, setRealtimeNotes] = useState<CalendarNote[]>([]);
  const [deletedNoteIds, setDeletedNoteIds] = useState<string[]>([]);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [editor, setEditor] = useState<"note" | "holiday" | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyHoliday, setBusyHoliday] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [holidayStart, setHolidayStart] = useState(selectedDate);
  const [holidayEnd, setHolidayEnd] = useState(selectedDate);

  const notes = useMemo(() => {
    const byId = new Map([...initialNotes, ...addedNotes, ...realtimeNotes].map((note) => [note.id, note]));
    return [...byId.values()].filter((note) => !deletedNoteIds.includes(note.id));
  }, [addedNotes, deletedNoteIds, initialNotes, realtimeNotes]);

  useEffect(() => {
    const updateCalendar = (event: Event) => {
      const detail = (event as CustomEvent<{ eventType?: string; note?: Partial<CalendarNote> }>).detail;
      const note = detail?.note;
      if (!note?.id) return;
      if (detail.eventType === "DELETE") {
        setDeletedNoteIds((current) => current.includes(note.id!) ? current : [...current, note.id!]);
        setRealtimeNotes((current) => current.filter((item) => item.id !== note.id));
        return;
      }
      if (!note.note_date || !note.title) return;
      setDeletedNoteIds((current) => current.filter((id) => id !== note.id));
      setRealtimeNotes((current) => [...current.filter((item) => item.id !== note.id), note as CalendarNote]);
    };
    window.addEventListener("presence:calendar-updated", updateCalendar);
    return () => window.removeEventListener("presence:calendar-updated", updateCalendar);
  }, []);

  const calendarDays = useMemo(() => {
    const first = startOfMonth(visibleMonth);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -mondayOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const monthItems = useMemo<CalendarItem[]>(() => {
    const holidayItems: CalendarItem[] = holidays.filter((holiday) => holiday.status === "approved" || holiday.status === "pending").flatMap((holiday) => dateRange(holiday.holiday_date, holiday.end_date || holiday.holiday_date).map((date) => ({
      id: `${holiday.id}-${date}`,
      date,
      title: holiday.name,
      description: `${holiday.status === "pending" ? "Awaiting super-admin approval. " : ""}${holiday.holiday_date !== holiday.end_date ? `${holiday.holiday_date} to ${holiday.end_date}. ` : ""}${holiday.reason || ""}` || null,
      kind: holiday.status === "pending" ? "pending_holiday" as const : holiday.holiday_type,
      branchName: holiday.branch?.name ?? null,
      holiday,
    })));
    const noteItems: CalendarItem[] = notes.map((note) => ({ id: note.id, date: note.note_date, title: note.title, description: note.note, kind: "note", branchName: note.branch?.name ?? null, note }));
    const leaveItems: CalendarItem[] = leaves.filter((leave) => leave.status === "approved").flatMap((leave) => eachDayOfInterval({ start: parseISO(`${leave.start_date}T12:00:00`), end: parseISO(`${leave.end_date}T12:00:00`) }).map((day) => ({
      id: `leave-${leave.id}-${format(day, "yyyy-MM-dd")}`,
      date: format(day, "yyyy-MM-dd"),
      title: leave.portion === "full_day" ? `${labelLeaveType(leave.leave_type)} leave` : "Half-day leave",
      description: `${leave.portion === "full_day" ? "Full day – no attendance required" : leave.portion === "first_half" ? "First half – attendance required for the second half" : "Second half – attendance required for the first half"} · ${leave.reason}`,
      kind: leave.portion === "full_day" ? "leave" as const : "short_leave" as const,
      branchName: null,
    })));
    const timingItems: CalendarItem[] = attendance.filter((record) => record.late_minutes > 0 || record.early_leave_minutes > 0).map((record) => {
      const timing = [record.late_minutes > 0 ? `${record.late_minutes} min late` : "", record.early_leave_minutes > 0 ? `${record.early_leave_minutes} min early departure` : ""].filter(Boolean);
      return { id: `timing-${record.id}`, date: record.attendance_date, title: timing.join(" · "), description: "Outside the branch's saved attendance tolerance.", kind: "timing", branchName: null };
    });
    const scheduleItems: CalendarItem[] = workSchedule.length ? calendarDays.flatMap<CalendarItem>((day) => {
      const date = format(day, "yyyy-MM-dd");
      const schedule = scheduleForDate(workSchedule, date);
      if (schedule.day_type === "half_day") return [];
      if (schedule.day_type === "off") return [{ id: `schedule-${date}`, date, title: "Weekly off day", description: "This is a scheduled off day, not a public holiday.", kind: "schedule_off" as const, branchName: null }];
      return [];
    }) : [];
    return [...holidayItems, ...noteItems, ...leaveItems, ...timingItems, ...scheduleItems];
  }, [attendance, calendarDays, holidays, leaves, notes, workSchedule]);

  const selectedItems = monthItems.filter((item) => item.date === selectedDate);
  const monthPrefix = format(visibleMonth, "yyyy-MM");
  const monthHolidayCount = new Set(monthItems.filter((item) => item.date.startsWith(monthPrefix) && ["poya", "public", "company", "special"].includes(item.kind)).map((item) => item.date)).size;
  const pendingHolidays = holidays.filter((item) => item.status === "pending");
  const pendingCount = pendingHolidays.length;
  const monthNoteCount = notes.filter((item) => item.note_date.startsWith(monthPrefix)).length;

  function moveMonth(amount: number) {
    const next = addMonths(visibleMonth, amount);
    setVisibleMonth(next);
    setSelectedDate(format(startOfMonth(next), "yyyy-MM-dd"));
  }

  function openHolidayEditor() {
    setHolidayStart(selectedDate);
    setHolidayEnd(selectedDate);
    setError("");
    setEditor("holiday");
  }

  async function createNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/admin/calendar-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The calendar note could not be saved.");
      setAddedNotes((current) => [...current, result.note as CalendarNote]);
      setSelectedDate((result.note as CalendarNote).note_date); setEditor(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The calendar note could not be saved."); }
    finally { setSaving(false); }
  }

  async function createHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/holidays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The holiday could not be saved.");
      setHolidays((current) => [...current, result.holiday as CompanyHoliday]);
      setSelectedDate((result.holiday as CompanyHoliday).holiday_date);
      setMessage(canManage ? "Holiday approved and staff notifications were sent." : "Suggestion sent. It will count as a holiday only after super-admin approval.");
      setEditor(null);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The holiday could not be saved."); }
    finally { setSaving(false); }
  }

  async function decideHoliday(holiday: CompanyHoliday, status: "approved" | "rejected") {
    setBusyHoliday(holiday.id); setError(""); setMessage("");
    const response = await fetch(`/api/admin/holidays/${holiday.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      setHolidays((current) => current.map((item) => item.id === holiday.id ? result.holiday : item));
      setMessage(`Holiday ${status}. The proposer${status === "approved" ? " and affected staff" : ""} received a notification.`);
      router.refresh();
    } else setError(result.error || "The holiday decision could not be saved.");
    setBusyHoliday(null);
  }

  async function deleteNote(note: CalendarNote) {
    if (!window.confirm(`Remove “${note.title}” from the calendar?`)) return;
    const response = await fetch("/api/admin/calendar-notes", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: note.id }) });
    if (response.ok) { setDeletedNoteIds((current) => [...current, note.id]); setAddedNotes((current) => current.filter((item) => item.id !== note.id)); }
  }

  return <>
    <section className="work-calendar" id="calendar">
      <div className="calendar-title-row">
        <div><span className="eyebrow">WORKDAY PLANNER</span><h2>{title}</h2><p>Approved Sri Lankan holidays, weekly schedules, leave and team notes in one auditable calendar.</p></div>
        <div className="heading-actions">{canManage && <button className="button button-ghost" onClick={() => setEditor("note")}><StickyNote size={17} /> Add note</button>}{(canManage || canProposeHoliday) && <button className="button button-primary" onClick={openHolidayEditor}><Plus size={17} /> {canManage ? "Add holiday" : "Suggest holiday"}</button>}</div>
      </div>
      {message && <div className="form-alert success calendar-message">{message}</div>}{error && !editor && <div className="form-alert error calendar-message">{error}</div>}
      <div className="calendar-overview">
        <div><small>Viewing</small><strong>{format(visibleMonth, "MMMM yyyy")}</strong></div>
        <div className="lavender"><small>Approved holidays</small><strong>{monthHolidayCount}</strong></div>
        <div className="lime"><small>Team notes</small><strong>{monthNoteCount}</strong></div>
        {canManage && <div className="amber"><small>Pending approval</small><strong>{pendingCount}</strong></div>}
      </div>
      {canManage && pendingHolidays.length > 0 && <div className="pending-holiday-queue"><strong>Holiday requests to review</strong><div>{pendingHolidays.slice(0, 4).map((holiday) => <button key={holiday.id} onClick={() => { setVisibleMonth(startOfMonth(parseISO(`${holiday.holiday_date}T12:00:00`))); setSelectedDate(holiday.holiday_date); }}><span>{holiday.holiday_date}</span>{holiday.name}</button>)}</div></div>}
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar"><div><button onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19} /></button><button onClick={() => { setVisibleMonth(startOfMonth(todayDate)); setSelectedDate(today); }}>Today</button></div><strong>{format(visibleMonth, "MMMM yyyy")}</strong><button onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19} /></button></div>
          <div className="calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">{calendarDays.map((day) => {
            const date = format(day, "yyyy-MM-dd"); const items = monthItems.filter((item) => item.date === date);
            const hasPoya = items.some((item) => item.kind === "poya");
            const hasHoliday = items.some((item) => ["public", "company", "special"].includes(item.kind));
            const hasPending = items.some((item) => item.kind === "pending_holiday");
            const hasNote = items.some((item) => item.kind === "note"); const hasLeave = items.some((item) => item.kind === "leave");
            const hasShortLeave = items.some((item) => item.kind === "short_leave"); const hasTiming = items.some((item) => item.kind === "timing");
            const hasOff = items.some((item) => item.kind === "schedule_off");
            return <button key={date} className={`${!isSameMonth(day, visibleMonth) ? "outside" : ""} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""} ${hasPoya ? "has-poya" : ""} ${hasHoliday ? "has-holiday" : ""} ${hasPending ? "has-pending-holiday" : ""} ${hasNote ? "has-note" : ""} ${hasLeave ? "has-leave" : ""} ${hasShortLeave ? "has-short-leave" : ""} ${hasTiming ? "has-timing" : ""} ${hasOff ? "has-off" : ""}`} onClick={() => setSelectedDate(date)} aria-label={`${format(day, "d MMMM yyyy")}${items.length ? `, ${items.map((item) => item.title).join(", ")}` : ""}`}><time>{format(day, "d")}</time><span className="calendar-cell-label">{items.find((item) => item.kind !== "schedule_off")?.title ?? items[0]?.title}</span><span className="calendar-dots" aria-hidden="true">{hasPoya && <i className="poya" />}{hasHoliday && <i className="holiday" />}{hasPending && <i className="pending-holiday" />}{hasNote && <i className="note" />}{hasLeave && <i className="leave" />}{hasShortLeave && <i className="short-leave" />}{hasTiming && <i className="timing" />}{hasOff && <i className="off" />}</span></button>;
          })}</div>
          <div className="calendar-legend"><span><i className="poya" /> Poya</span><span><i className="holiday" /> Approved holiday</span>{canManage && <span><i className="pending-holiday" /> Pending</span>}<span><i className="off" /> Weekly off</span><span><i className="leave" /> Leave</span><span><i className="note" /> Note</span><span><i className="today" /> Today</span></div>
        </div>
        <aside className="calendar-agenda"><div className="agenda-date"><span><CalendarDays size={20} /></span><div><small>SELECTED DATE</small><strong>{format(parseISO(`${selectedDate}T12:00:00`), "EEEE, d MMMM yyyy")}</strong></div></div><div className="agenda-list">{selectedItems.length ? selectedItems.map((item) => <article className={`agenda-item ${item.kind}`} key={item.id}><span>{item.kind === "poya" ? <Moon size={17} /> : ["public", "company", "special", "pending_holiday"].includes(item.kind) ? <Palmtree size={17} /> : item.kind === "note" ? <StickyNote size={17} /> : item.kind === "schedule_off" ? <Sun size={17} /> : <Clock3 size={17} />}</span><div><small>{itemLabel(item)}</small><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div>{canManage && item.kind === "note" && <button onClick={() => deleteNote(item.note)} aria-label={`Delete ${item.title}`}><Trash2 size={16} /></button>}{canManage && item.kind === "pending_holiday" && <div className="holiday-review-actions"><button disabled={busyHoliday === item.holiday.id} onClick={() => void decideHoliday(item.holiday, "rejected")} aria-label="Reject holiday"><X size={15} /></button><button disabled={busyHoliday === item.holiday.id} onClick={() => void decideHoliday(item.holiday, "approved")} aria-label="Approve holiday"><Check size={15} /></button></div>}</article>) : <div className="agenda-empty"><CalendarDays size={24} /><strong>No events</strong><small>This date follows the normal saved work schedule.</small></div>}</div></aside>
      </div>
    </section>

    {editor === "note" && <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}><div className="modal calendar-note-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">TEAM CALENDAR</span><h2>Add a calendar note</h2><p>Share an office reminder with everyone or one branch.</p></div><button className="icon-button bordered" onClick={() => setEditor(null)}><X size={20} /></button></div><form className="stack-lg" onSubmit={createNote}><label className="field"><span>Date</span><input name="note_date" type="date" required defaultValue={selectedDate} /></label><label className="field"><span>Title</span><input name="title" required minLength={2} maxLength={100} placeholder="Quarterly team meeting" /></label><label className="field"><span>Audience</span><span className="input-shell"><MapPin size={17} /><select name="branch_id" defaultValue=""><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></span></label><label className="field"><span>Message (optional)</span><textarea name="note" maxLength={500} placeholder="Add time, location or a helpful reminder" /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Publish note"}</button></div></form></div></div>}
    {editor === "holiday" && <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}><div className="modal holiday-editor-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">HOLIDAY CONTROL</span><h2>{canManage ? "Approve a holiday" : "Suggest a holiday"}</h2><p>{canManage ? "Choose one day or a continuous range. Approval immediately updates attendance rules." : "Choose one day or a range. Attendance changes only after super-admin approval."}</p></div><button className="icon-button bordered" onClick={() => setEditor(null)}><X size={20} /></button></div><form className="holiday-editor-layout" onSubmit={createHoliday}><div className="holiday-calendar-side"><CompactRangeCalendar start={holidayStart} end={holidayEnd} onChange={(start, end) => { setHolidayStart(start); setHolidayEnd(end); }} /><input type="hidden" name="start_date" value={holidayStart} /><input type="hidden" name="end_date" value={holidayEnd} /><div className="holiday-range-summary"><CalendarDays size={18} /><span><small>SELECTED HOLIDAY PERIOD</small><strong>{formatHolidayRange(holidayStart, holidayEnd)}</strong></span></div></div><div className="holiday-fields stack-lg"><label className="field"><span>Holiday name</span><input name="name" required minLength={2} maxLength={120} placeholder="Special company holiday" /></label><label className="field"><span>Type</span><select name="holiday_type" defaultValue="company"><option value="company">Company holiday</option><option value="special">Special holiday</option>{canManage && <option value="public">Public holiday</option>}{canManage && <option value="poya">Poya day</option>}</select></label>{canManage && <label className="field"><span>Audience</span><select name="branch_id" defaultValue=""><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}<label className="field"><span>Reason / source</span><textarea name="reason" required minLength={4} maxLength={500} placeholder="Explain why this day or date range should be treated as a holiday" /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : canManage ? "Approve holiday period" : "Send for approval"}</button></div></div></form></div></div>}
  </>;
}

function labelLeaveType(value: LeaveRequest["leave_type"]) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatHolidayRange(start: string, end: string) {
  const first = format(parseISO(`${start}T12:00:00`), "d MMM yyyy");
  return start === end ? first : `${first} – ${format(parseISO(`${end}T12:00:00`), "d MMM yyyy")}`;
}

function CompactRangeCalendar({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const [month, setMonth] = useState(startOfMonth(parseISO(`${start}T12:00:00`)));
  const [choosingEnd, setChoosingEnd] = useState(false);
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index - offset));
  function choose(date: string) {
    if (!choosingEnd) {
      onChange(date, date);
      setChoosingEnd(true);
      return;
    }
    onChange(date < start ? date : start, date < start ? start : date);
    setChoosingEnd(false);
  }
  return <div className="compact-range-calendar">
    <div className="compact-calendar-head"><button type="button" onClick={() => setMonth((current) => addMonths(current, -1))} aria-label="Previous month"><ChevronLeft size={17} /></button><div><small>{choosingEnd ? "NOW CHOOSE THE END" : "CHOOSE THE START"}</small><strong>{format(month, "MMMM yyyy")}</strong></div><button type="button" onClick={() => setMonth((current) => addMonths(current, 1))} aria-label="Next month"><ChevronRight size={17} /></button></div>
    <div className="compact-calendar-weekdays">{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className="compact-calendar-grid">{days.map((day) => { const date = format(day, "yyyy-MM-dd"); const inRange = date >= start && date <= end; return <button type="button" key={date} className={`${!isSameMonth(day, month) ? "outside" : ""} ${date === start ? "range-start" : ""} ${date === end ? "range-end" : ""} ${inRange ? "in-range" : ""}`} onClick={() => choose(date)}><time>{format(day, "d")}</time></button>; })}</div>
    <div className="compact-calendar-hint"><span><i /> Start: {format(parseISO(`${start}T12:00:00`), "d MMM")}</span><span><i /> End: {format(parseISO(`${end}T12:00:00`), "d MMM")}</span><button type="button" onClick={() => { onChange(start, start); setChoosingEnd(false); }}>One day only</button></div>
  </div>;
}
function itemLabel(item: CalendarItem) {
  if (item.kind === "poya") return "FULL MOON POYA";
  if (["public", "company", "special"].includes(item.kind)) return item.branchName ? `${item.branchName.toUpperCase()} HOLIDAY` : "APPROVED HOLIDAY";
  if (item.kind === "pending_holiday") return "PENDING SUPER-ADMIN APPROVAL";
  if (item.kind === "note") return item.branchName?.toUpperCase() || "ALL BRANCHES";
  if (item.kind === "leave") return "APPROVED FULL-DAY LEAVE";
  if (item.kind === "short_leave") return "APPROVED HALF-DAY LEAVE";
  if (item.kind === "schedule_half") return "SCHEDULED HALF DAY";
  if (item.kind === "schedule_off") return "WEEKLY OFF DAY";
  return "ATTENDANCE TIMING";
}
