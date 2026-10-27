"use client";

import { useMemo, useState } from "react";
import { addDays, addMonths, format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Moon, Plus, StickyNote, Trash2, X } from "lucide-react";
import { sriLankaHolidaysForYear, type SriLankaHoliday } from "@/lib/sri-lanka-holidays";
import type { Branch, CalendarNote } from "@/lib/types";

type CalendarItem =
  | { id: string; date: string; title: string; description: string | null; kind: "note"; branchName: string | null; note: CalendarNote }
  | { id: string; date: string; title: string; description: null; kind: SriLankaHoliday["kind"]; branchName: null };

export function WorkCalendar({
  today,
  initialNotes,
  canManage = false,
  branches = [],
  title = "Calendar & schedule",
}: {
  today: string;
  initialNotes: CalendarNote[];
  canManage?: boolean;
  branches?: Branch[];
  title?: string;
}) {
  const todayDate = parseISO(`${today}T12:00:00`);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(todayDate));
  const [selectedDate, setSelectedDate] = useState(today);
  const [notes, setNotes] = useState(initialNotes);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const monthItems = useMemo<CalendarItem[]>(() => {
    const holidays: CalendarItem[] = sriLankaHolidaysForYear(visibleMonth.getFullYear()).map((holiday, index) => ({
      id: `holiday-${holiday.date}-${index}`,
      date: holiday.date,
      title: holiday.name,
      description: null,
      kind: holiday.kind,
      branchName: null,
    }));
    const noteItems: CalendarItem[] = notes.map((note) => ({
      id: note.id,
      date: note.note_date,
      title: note.title,
      description: note.note,
      kind: "note",
      branchName: note.branch?.name ?? null,
      note,
    }));
    return [...holidays, ...noteItems];
  }, [notes, visibleMonth]);

  const calendarDays = useMemo(() => {
    const first = startOfMonth(visibleMonth);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -mondayOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const selectedItems = monthItems.filter((item) => item.date === selectedDate);
  const monthHolidayCount = monthItems.filter((item) => item.date.startsWith(format(visibleMonth, "yyyy-MM")) && item.kind !== "note").length;
  const monthNoteCount = monthItems.filter((item) => item.date.startsWith(format(visibleMonth, "yyyy-MM")) && item.kind === "note").length;

  function moveMonth(amount: number) {
    const next = addMonths(visibleMonth, amount);
    setVisibleMonth(next);
    setSelectedDate(format(startOfMonth(next), "yyyy-MM-dd"));
  }

  async function createNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/admin/calendar-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The calendar note could not be saved.");
      setNotes((current) => [...current, result.note as CalendarNote]);
      setSelectedDate((result.note as CalendarNote).note_date);
      setEditorOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The calendar note could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(note: CalendarNote) {
    if (!window.confirm(`Remove “${note.title}” from the calendar?`)) return;
    const response = await fetch("/api/admin/calendar-notes", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: note.id }),
    });
    if (response.ok) setNotes((current) => current.filter((item) => item.id !== note.id));
  }

  return <>
    <section className="work-calendar">
      <div className="calendar-title-row">
        <div><span className="eyebrow">WORKDAY PLANNER</span><h2>{title}</h2><p>Official Sri Lankan holidays, Poya days and team notes in one place.</p></div>
        {canManage && <button className="button button-primary" onClick={() => setEditorOpen(true)}><Plus size={17} /> Add calendar note</button>}
      </div>

      <div className="calendar-overview">
        <div><small>Viewing</small><strong>{format(visibleMonth, "MMMM yyyy")}</strong></div>
        <div className="lavender"><small>Public holidays</small><strong>{monthHolidayCount}</strong></div>
        <div className="lime"><small>Team notes</small><strong>{monthNoteCount}</strong></div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <div><button onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19} /></button><button onClick={() => { setVisibleMonth(startOfMonth(todayDate)); setSelectedDate(today); }}>Today</button></div>
            <strong>{format(visibleMonth, "MMMM yyyy")}</strong>
            <button onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19} /></button>
          </div>
          <div className="calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">
            {calendarDays.map((day) => {
              const date = format(day, "yyyy-MM-dd");
              const items = monthItems.filter((item) => item.date === date);
              const hasPoya = items.some((item) => item.kind === "poya");
              const hasHoliday = items.some((item) => item.kind === "public");
              const hasNote = items.some((item) => item.kind === "note");
              return <button
                key={date}
                className={`${!isSameMonth(day, visibleMonth) ? "outside" : ""} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""} ${hasPoya ? "has-poya" : ""} ${hasHoliday ? "has-holiday" : ""} ${hasNote ? "has-note" : ""}`}
                onClick={() => setSelectedDate(date)}
                aria-label={`${format(day, "d MMMM yyyy")}${items.length ? `, ${items.map((item) => item.title).join(", ")}` : ""}`}
              >
                <time>{format(day, "d")}</time>
                <span className="calendar-cell-label">{items[0]?.title}</span>
                <span className="calendar-dots" aria-hidden="true">{hasPoya && <i className="poya" />}{hasHoliday && <i className="holiday" />}{hasNote && <i className="note" />}</span>
              </button>;
            })}
          </div>
          <div className="calendar-legend"><span><i className="poya" /> Poya day</span><span><i className="holiday" /> Public holiday</span><span><i className="note" /> Team note</span><span><i className="today" /> Today</span></div>
        </div>

        <aside className="calendar-agenda">
          <div className="agenda-date"><span>{format(parseISO(`${selectedDate}T12:00:00`), "dd")}</span><div><small>{format(parseISO(`${selectedDate}T12:00:00`), "EEEE")}</small><strong>{format(parseISO(`${selectedDate}T12:00:00`), "MMMM yyyy")}</strong></div></div>
          <div className="agenda-list">
            {selectedItems.length === 0 && <div className="agenda-empty"><CalendarDays size={23} /><strong>A clear day</strong><span>No holiday or team note is scheduled.</span>{canManage && <button onClick={() => setEditorOpen(true)}>Add a note</button>}</div>}
            {selectedItems.map((item) => <article className={`agenda-item ${item.kind}`} key={item.id}>
              <span>{item.kind === "poya" ? <Moon size={18} /> : item.kind === "note" ? <StickyNote size={18} /> : <CalendarDays size={18} />}</span>
              <div><small>{item.kind === "poya" ? "FULL MOON POYA" : item.kind === "note" ? item.branchName ? item.branchName : "ALL BRANCHES" : "PUBLIC HOLIDAY"}</small><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div>
              {canManage && item.kind === "note" && <button onClick={() => deleteNote(item.note)} aria-label={`Delete ${item.title}`}><Trash2 size={16} /></button>}
            </article>)}
          </div>
        </aside>
      </div>
    </section>

    {editorOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditorOpen(false)}><div className="modal calendar-note-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-note-title"><div className="modal-head"><div><span className="eyebrow">TEAM CALENDAR</span><h2 id="calendar-note-title">Add a calendar note</h2><p>Share an office reminder with everyone or one branch.</p></div><button className="icon-button bordered" onClick={() => setEditorOpen(false)} aria-label="Close"><X size={20} /></button></div><form className="stack-lg" onSubmit={createNote}>
      <label className="field"><span>Date</span><input name="note_date" type="date" required defaultValue={selectedDate} /></label>
      <label className="field"><span>Title</span><input name="title" required minLength={2} maxLength={100} placeholder="Quarterly team meeting" /></label>
      <label className="field"><span>Audience</span><span className="input-shell"><MapPin size={17} /><select name="branch_id" defaultValue=""><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></span></label>
      <label className="field"><span>Message (optional)</span><textarea name="note" maxLength={500} placeholder="Add time, location or a helpful reminder" /></label>
      {error && <div className="form-alert error">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setEditorOpen(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Publish note"}</button></div>
    </form></div></div>}
  </>;
}
