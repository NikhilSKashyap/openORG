import { createOpenorgClient } from "@openorg/sdk";
import { mountWorkbench } from "@openorg/workbench-kit";
import "@openorg/workbench-kit/styles.css";
import { manifest } from "./manifest";

type RecordValue = {
  id: string;
  version?: string;
  title?: string;
  payload?: Record<string, unknown>;
};

const client = createOpenorgClient(location.origin);
mountWorkbench(document.querySelector("#app")!, { manifest, client });

const host = document.querySelector<HTMLElement>("#role")!;
host.innerHTML = `
  <section class="pm-tools">
    <aside aria-labelledby="signals-title">
      <p class="role-eyebrow">Evidence from openGTM</p>
      <h2 id="signals-title">Customer signals</h2>
      <div id="signals" aria-live="polite">Loading…</div>
    </aside>

    <main>
      <p class="role-eyebrow">New product decision</p>
      <h2>Frame an initiative</h2>
      <form id="initiative-form">
        <label>Title<input name="title" required></label>
        <label>Problem<textarea name="problem" required></textarea></label>
        <label>Rationale<textarea name="rationale" required></textarea></label>
        <label>Alternatives considered (one per line)<textarea name="alternatives"></textarea></label>
        <label>Scope (one item per line)<textarea name="scope"></textarea></label>
        <label>Non-goals (one per line)<textarea name="nonGoals"></textarea></label>
        <label>Success metric<input name="metric" required></label>
        <label>Target<input name="target" type="number" step="any" required></label>
        <fieldset style="grid-column: 1 / -1; border: 0; margin: 0; padding: 0">
          <legend style="color: #625e6c; font-size: 12px; margin-bottom: 5px">Supporting signals</legend>
          <div id="signal-options">Loading…</div>
        </fieldset>
        <button style="grid-column: 1 / -1" type="submit">Create proposed decision</button>
        <output aria-live="polite"></output>
      </form>
    </main>

    <aside aria-labelledby="approval-title">
      <p class="role-eyebrow">Human gate</p>
      <h2 id="approval-title">Needs approval</h2>
      <div id="approvals" aria-live="polite">Loading…</div>
    </aside>
  </section>`;

const signalsNode = host.querySelector<HTMLElement>("#signals")!;
const signalOptions = host.querySelector<HTMLElement>("#signal-options")!;
const approvalsNode = host.querySelector<HTMLElement>("#approvals")!;
const form = host.querySelector<HTMLFormElement>("#initiative-form")!;
const output = form.querySelector<HTMLOutputElement>("output")!;

const text = (record: RecordValue) =>
  String(record.payload?.title ?? record.title ?? record.id);
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]!
  );
const lines = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function refresh() {
  try {
    const [signals, decisions] = await Promise.all([
      json<RecordValue[]>("/api/records?workspace=gtm&kind=signal"),
      json<RecordValue[]>("/api/records?workspace=pm&kind=decision")
    ]);
    const traces = await Promise.all(
      signals.map((signal) =>
        json<{ outgoing: Array<{ state: string }> }>(
          `/api/lineage/trace/${encodeURIComponent(signal.id)}`
        )
      )
    );
    const untriaged = signals.filter(
      (_, index) =>
        !traces[index]?.outgoing.some((edge) => edge.state !== "rejected")
    );
    const selected = new Set(
      [
        ...signalOptions.querySelectorAll<HTMLInputElement>(
          'input[name="signalRefs"]:checked'
        )
      ].map((input) => input.value)
    );

    signalsNode.innerHTML = untriaged.length
      ? untriaged
          .map(
            (signal) =>
              `<article><strong>${escapeHtml(text(signal))}</strong></article>`
          )
          .join("")
      : "<p>No untriaged customer signals.</p>";
    signalOptions.innerHTML = untriaged.length
      ? untriaged
          .map(
            (signal) =>
              `<label><input type="checkbox" name="signalRefs" value="${escapeHtml(signal.id)}" ${selected.has(signal.id) ? "checked" : ""}> ${escapeHtml(text(signal))}</label>`
          )
          .join("")
      : "<p>No untriaged customer signals available.</p>";

    const proposed = decisions.filter(
      (decision) => decision.payload?.status === "proposed"
    );
    approvalsNode.innerHTML = proposed.length
      ? proposed
          .map(
            (decision) =>
              `<article><strong>${escapeHtml(text(decision))}</strong><p>Proposed · Product owner</p><button type="button" data-approve="${escapeHtml(decision.id)}">Approve with receipt</button></article>`
          )
          .join("")
      : "<p>No proposed decisions need approval.</p>";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    signalsNode.textContent = `Could not load customer signals: ${message}`;
    approvalsNode.textContent = `Could not load approvals: ${message}`;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const body = {
    title: data.get("title"),
    problem: data.get("problem"),
    rationale: data.get("rationale"),
    alternatives: lines(data.get("alternatives")),
    scope: lines(data.get("scope")),
    nonGoals: lines(data.get("nonGoals")),
    metric: data.get("metric"),
    target: data.get("target"),
    signalRefs: data.getAll("signalRefs")
  };
  output.textContent = "Recording proposed decision…";
  const response = await fetch("/api/initiatives", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  output.textContent = response.ok
    ? "Proposed decision and lineage recorded."
    : await response.text();
  if (response.ok) {
    form.reset();
    await refresh();
  }
});

approvalsNode.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-approve]"
  );
  if (!button) return;
  button.disabled = true;
  button.textContent = "Recording approval…";
  const response = await fetch(
    `/api/initiatives/${encodeURIComponent(button.dataset.approve!)}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approverId: "pm-user" })
    }
  );
  output.textContent = response.ok
    ? "Approval and verification receipt recorded."
    : await response.text();
  await refresh();
});

void refresh();
new EventSource("/api/events/stream").onmessage = () => void refresh();
