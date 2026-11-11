import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/api/animaApi", () => ({ animaApi: {} }));
import AgeGateDialog from "./AgeGateDialog";

function fill() {
  fireEvent.change(screen.getByTestId("age-gate-dob"), { target: { value: "1990-05-17" } });
  fireEvent.click(screen.getByTestId("age-gate-confirm"));
}

describe("AgeGateDialog", () => {
  it("enables adult mode only after the server attests", async () => {
    const api = { safety: { attestAge: vi.fn(async () => ({ status: "attested", adult_eligible: true })) } };
    const onAttested = vi.fn();
    render(<AgeGateDialog api={api} onAttested={onAttested} onCancel={vi.fn()} />);
    expect(screen.getByTestId("age-gate-submit").hasAttribute("disabled")).toBe(true);
    fill();
    fireEvent.click(screen.getByTestId("age-gate-submit"));
    await waitFor(() => expect(onAttested).toHaveBeenCalled());
    expect(api.safety.attestAge).toHaveBeenCalledWith("1990-05-17");
  });
  it("shows the server's refusal and does not enable", async () => {
    const api = {
      safety: { attestAge: vi.fn(async () => { throw Object.assign(new Error("Adult mode is for people 18 and over."), { status: 403 }); }) },
    };
    const onAttested = vi.fn();
    render(<AgeGateDialog api={api} onAttested={onAttested} onCancel={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByTestId("age-gate-submit"));
    expect((await screen.findByRole("alert")).textContent).toContain("18 and over");
    expect(onAttested).not.toHaveBeenCalled();
  });
});
