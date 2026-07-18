/** @vitest-environment jsdom */
/**
 * SubjectCombobox — the complaint typeahead on Raise Ticket.
 *
 * THE FIRST COMPONENT TEST IN THIS REPO. It exists because a broken dropdown
 * shipped to production twice while the build stayed green and 197 tests
 * passed: every test here was service-layer, node-environment, so no
 * component had ever actually been rendered.
 *
 * These tests render the real thing and drive it the way a customer does.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SubjectCombobox from "./SubjectCombobox";

afterEach(cleanup);

// Shaped like the real payload: getSubjects returns [{id, subject}].
const SUBJECTS = [
  { id: "1", subject: "internet access" },
  { id: "2", subject: "internet issue" },
  { id: "3", subject: "change the router user name" },
  { id: "4", subject: "olt fw upgradation" },
  { id: "5", subject: "no internet" },
];

function typeInto(input, text) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

describe("SubjectCombobox", () => {
  test("typing shows matching complaints", () => {
    render(<SubjectCombobox subjects={SUBJECTS} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox");

    typeInto(input, "inter");

    // "internet access" / "internet issue" start with the query; "no internet"
    // matches on its second WORD. "olt fw upgradation" must not appear.
    expect(screen.getByRole("listbox")).toBeTruthy();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("internet access");
    expect(options).toContain("no internet");
    expect(options).not.toContain("olt fw upgradation");
  });

  test("the list is NOT shown before a character is typed (threshold = 1)", () => {
    render(<SubjectCombobox subjects={SUBJECTS} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    // Android's completionThreshold is 1; with a 4000-row catalogue, dumping
    // everything on focus would bury the form.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("the chevron opens the full catalogue on demand", () => {
    render(<SubjectCombobox subjects={SUBJECTS} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Show subjects"));
    expect(screen.getAllByRole("option")).toHaveLength(SUBJECTS.length);
  });

  test("picking an option reports it to the parent", () => {
    const onChange = vi.fn();
    render(<SubjectCombobox subjects={SUBJECTS} value="" onChange={onChange} />);
    typeInto(screen.getByRole("combobox"), "olt");
    fireEvent.click(screen.getByText("olt fw upgradation"));
    expect(onChange).toHaveBeenCalledWith("olt fw upgradation");
  });

  test("a query with no matches says so rather than rendering nothing", () => {
    render(<SubjectCombobox subjects={SUBJECTS} value="" onChange={() => {}} />);
    typeInto(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText("No matching complaint")).toBeTruthy();
  });

  test("editing after a selection keeps the typed text", () => {
    // REGRESSION: handleType calls onChange("") to invalidate the selection.
    // In the real page that flows back as a changed `value` prop, and the
    // sync effect then overwrote `query` with "" — wiping the field mid-type
    // and closing the dropdown. Re-render with the new value to reproduce.
    const { rerender } = render(
      <SubjectCombobox subjects={SUBJECTS} value="internet access" onChange={() => {}} />
    );
    const input = screen.getByRole("combobox");
    expect(input.value).toBe("internet access");

    fireEvent.change(input, { target: { value: "internet acces" } });
    rerender(<SubjectCombobox subjects={SUBJECTS} value="" onChange={() => {}} />);

    expect(input.value).toBe("internet acces");
    expect(screen.queryByRole("listbox")).toBeTruthy();
  });

  test("renders a large catalogue without dropping options", () => {
    // Staging returns 4414 rows; production 389. The filtered list must still
    // render.
    const many = Array.from({ length: 4414 }, (_, i) => ({
      id: String(i),
      subject: i % 100 === 0 ? `internet fault ${i}` : `unrelated subject ${i}`,
    }));
    render(<SubjectCombobox subjects={many} value="" onChange={() => {}} />);
    typeInto(screen.getByRole("combobox"), "internet");
    expect(screen.getAllByRole("option").length).toBe(45);
  });
});
