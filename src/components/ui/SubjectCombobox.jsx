import React, { useEffect, useMemo, useRef, useState } from "react";
import { filterSubjects } from "../../services/customer/ticketFlow";

/**
 * Filterable complaint-subject picker — the web equivalent of the Android
 * customer app's AutoCompleteTextView (setThreshold(1) + ArrayAdapter).
 *
 * Filter semantics live in services/customer/ticketFlow.js (filterSubjects)
 * and are unit-tested there — they reproduce Android's ArrayFilter word-prefix
 * rule, which is neither a substring nor a plain-prefix match.
 *
 * Android also refuses to submit free text: the field's contents must equal a
 * subject that was actually picked from the list ("No complaint
 * selected/Invalid complaint"). We enforce that structurally instead — the
 * parent only ever receives a value via onChange when a real option is
 * chosen, and typing again clears it.
 */
export default function SubjectCombobox({
  subjects = [],
  value = "",
  onChange,
  disabled = false,
  placeholder = "Predefined Complaint",
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);

  // Keep the visible text in step when the PARENT resets the selection
  // (e.g. after a successful submit or a service switch).
  //
  // The ref guard is load-bearing. Typing calls onChange("") to invalidate a
  // previous selection; that comes straight back as a changed `value` prop,
  // and without this the effect would overwrite `query` with "" — wiping the
  // characters mid-keystroke and, because the threshold is then unmet,
  // closing the dropdown. That is the "typing shows no suggestions" bug.
  // Only echo values we did NOT emit ourselves.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setQuery(value);
  }, [value]);

  const emit = (next) => {
    lastEmitted.current = next;
    onChange?.(next);
  };

  const matches = useMemo(() => filterSubjects(subjects, query), [subjects, query]);

  // NATIVE PARITY: completionThreshold = 1. The popup appears once at least
  // one character is typed and never on focus alone. There is no
  // "browse everything" affordance in the native app, so there is none here.
  const THRESHOLD = 1;
  const meetsThreshold = query.length >= THRESHOLD;
  // Native dismisses the popup entirely when the filter yields nothing —
  // it never shows an empty-state row.
  const showList = open && meetsThreshold && matches.length > 0;

  // Close on outside click.
  useEffect(() => {
    const onDocDown = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const select = (subject) => {
    setQuery(subject);
    setOpen(false);
    emit(subject);
  };

  const handleType = (text) => {
    setQuery(text);
    setActive(0);
    setOpen(true);
    // Free text is never a valid selection — drop it until an option is
    // picked, so the submit button stays correctly disabled. Routed through
    // emit() so the echoed prop change does not clobber what was typed.
    if (value) emit("");
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (showList && matches[active]) {
        e.preventDefault();
        select(matches[active].subject);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => handleType(e.target.value)}
          onFocus={() => setOpen(true)}   /* threshold decides visibility */
          onKeyDown={onKeyDown}
          className="w-full border rounded-lg py-2 pl-3 pr-3 text-sm bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
        />
      </div>

      {showList && !disabled && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg text-sm"
        >
          {matches.map((s, i) => (
            <li key={s.id ?? `${s.subject}-${i}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === s.subject}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(s.subject)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    i === active
                      ? "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {s.subject}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
