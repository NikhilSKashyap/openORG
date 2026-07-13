import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineageAssertion } from "@openorg/protocol";
import type { LineageTrace, OpenorgRecord } from "@openorg/sdk";
import { Workbench, type WorkbenchClient } from "./index.js";

const manifest = {
  workspace: "launch",
  title: "Launch room",
  primaryObject: {
    kind: "task",
    label: "Task",
    fields: [{ id: "owner", label: "Owner" }]
  },
  sources: [{ provider: "local", status: "healthy" }],
  council: { architect: "a", builder: "b", verifier: "v" },
  skills: [],
  gates: { "todo->done": "verified_receipt" },
  home: {
    attention: [],
    stages: [
      { id: "todo", label: "To do" },
      { id: "done", label: "Done", policy: "release-policy" }
    ]
  }
};

function client(records: OpenorgRecord[] = [], trace?: LineageTrace) {
  let listener: ((event: unknown) => void) | undefined;
  const value = {
    records: {
      create: vi.fn(async (record: OpenorgRecord) => record),
      list: vi.fn(async (query?: { kind?: string }) =>
        query?.kind === "openorg.verification-receipt" ? [] : records
      ),
      get: vi.fn()
    },
    lineage: {
      create: vi.fn(),
      judge: vi.fn(async () => undefined),
      trace: vi.fn(
        async () => trace ?? { record: null, incoming: [], outgoing: [] }
      )
    },
    subscribe: vi.fn((next: (event: unknown) => void) => {
      listener = next;
      return () => undefined;
    })
  } as unknown as WorkbenchClient;
  return { value, emit: (event: unknown) => listener?.(event) };
}

afterEach(cleanup);

describe("Workbench", () => {
  it("renders an honest manifest validation failure", () => {
    render(
      <Workbench manifest={{ title: "Broken" }} client={client().value} />
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be validated"
    );
    expect(screen.getByText(/Fix the manifest/)).toBeTruthy();
  });

  it("names the policy locking a gate", async () => {
    const record = {
      contract: "task",
      id: "task-1",
      title: "Ship it",
      stage: "todo"
    } as OpenorgRecord;
    render(<Workbench manifest={manifest} client={client([record]).value} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Ship it", exact: true })
    );
    expect(screen.getAllByText(/release-policy/).length).toBeGreaterThan(0);
    expect(screen.getByText(/green verification receipt/)).toBeTruthy();
  });

  it("updates current work from SSE without reloading", async () => {
    const mock = client();
    render(<Workbench manifest={manifest} client={mock.value} />);
    await screen.findByText(/No current tasks/);
    act(() =>
      mock.emit({
        type: "record.accepted",
        value: {
          contract: "task",
          id: "task-live",
          workspace: "launch",
          kind: "task",
          title: "Live task",
          stage: "todo"
        }
      })
    );
    expect(await screen.findByText("Live task")).toBeTruthy();
  });

  it("distinguishes proposed and confirmed trace links", async () => {
    const record = {
      contract: "task",
      id: "task-1",
      title: "Ship it",
      stage: "todo"
    } as OpenorgRecord;
    const edge = (
      id: string,
      state: "proposed" | "confirmed"
    ): LineageAssertion => ({
      contract: "openorg.lineage-assertion",
      contractVersion: "1.0.0",
      id,
      from: { id: "task-1", version: "1" },
      to: { id: `${id}-target`, version: "1" },
      relationship: "supports",
      basis: "observed",
      state,
      ...(state === "confirmed"
        ? { authority: { kind: "human", id: "user" } as const }
        : {}),
      evidenceRefs: [{ algorithm: "sha256", digest: "abc" }],
      assertedAt: "2026-01-01T00:00:00Z"
    });
    const trace: LineageTrace = {
      record,
      incoming: [],
      outgoing: [
        edge("proposal", "proposed"),
        edge("confirmation", "confirmed")
      ]
    };
    render(
      <Workbench manifest={manifest} client={client([record], trace).value} />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Ship it", exact: true })
    );
    fireEvent.click(screen.getByText("Trace"));
    await waitFor(() =>
      expect(document.querySelector(".is-proposed")).toBeTruthy()
    );
    expect(document.querySelector(".is-confirmed")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Reject")).toBeTruthy();
  });
});
