import { createOpenorgClient } from "@openorg/sdk";
import { mountWorkbench } from "@openorg/workbench-kit";
import "@openorg/workbench-kit/styles.css";
import { manifest } from "./manifest";

mountWorkbench(document.querySelector("#app")!, {
  manifest,
  client: createOpenorgClient(location.origin)
});

type RecordSummary = {
  id: string;
  title?: string;
  status?: string;
  payload?: { title?: string; status?: string };
};

const host = document.querySelector("#tools")!;
host.innerHTML = `
  <section>
    <p class="role-eyebrow">Approved product direction</p>
    <h2>Open delivery work</h2>
    <form id="create-work">
      <label>Station
        <select name="station">
          <option value="fde" selected>FDE Customer Mission</option>
          <option value="swe">SWE Change</option>
          <option value="mle">MLE Experiment</option>
        </select>
      </label>
      <label>Title<input name="title" required></label>
      <label>Intent<textarea name="intent" required></textarea></label>
      <label>Constraints (one per line)<textarea name="constraints"></textarea></label>
      <label>Tools/models/harnesses<input name="components"></label>
      <label>Approved decision<select name="decisionRef" required></select></label>
      <button>Create linked work</button>
      <output aria-live="polite"></output>
    </form>
  </section>
  <section>
    <p class="role-eyebrow">Execution and evidence</p>
    <h2>Record delivery</h2>
    <form id="record-delivery">
      <label>Work<select name="workId" required></select></label>
      <label>Action<input name="action" placeholder="What was done"></label>
      <label>Artifact title<input name="artifactTitle"></label>
      <label>Artifact content<textarea name="text"></textarea></label>
      <label>Outcome<input name="outcome" placeholder="Measured result"></label>
      <label>Metric value<input name="metricValue" type="number" step="any"></label>
      <div class="button-row">
        <button name="operation" value="actions">Record action</button>
        <button name="operation" value="artifacts">Attach artifact</button>
        <button name="operation" value="verify">Run verification</button>
        <button name="operation" value="outcomes">Record outcome</button>
      </div>
      <output aria-live="polite"></output>
    </form>
  </section>`;

const createForm = host.querySelector<HTMLFormElement>("#create-work")!;
const deliveryForm = host.querySelector<HTMLFormElement>("#record-delivery")!;
const decisionSelect = createForm.elements.namedItem(
  "decisionRef"
) as HTMLSelectElement;
const workSelect = deliveryForm.elements.namedItem(
  "workId"
) as HTMLSelectElement;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]!
  );

const titleOf = (record: RecordSummary) =>
  record.title || record.payload?.title || record.id;
const statusOf = (record: RecordSummary) =>
  record.status || record.payload?.status;

async function records(path: string): Promise<RecordSummary[]> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<RecordSummary[]>;
}

async function refreshDecisions() {
  const selected = decisionSelect.value;
  const rows = await records("/api/records?workspace=pm&kind=decision");
  const approved = rows.filter((record) => statusOf(record) === "approved");
  decisionSelect.innerHTML = approved.length
    ? approved
        .map(
          (record) =>
            `<option value="${escapeHtml(record.id)}">${escapeHtml(titleOf(record))}</option>`
        )
        .join("")
    : '<option value="" disabled>No approved decisions</option>';
  if (approved.some((record) => record.id === selected))
    decisionSelect.value = selected;
}

async function refreshWork(preferred?: string) {
  const selected = preferred || workSelect.value;
  const rows = (
    await Promise.all(
      ["fde", "swe", "mle"].map((workspace) =>
        records(`/api/records?workspace=${workspace}&kind=work`)
      )
    )
  ).flat();
  const work = rows.filter(
    (record, index) => rows.findIndex((item) => item.id === record.id) === index
  );
  workSelect.innerHTML = work.length
    ? work
        .map(
          (record) =>
            `<option value="${escapeHtml(record.id)}">${escapeHtml(titleOf(record))}</option>`
        )
        .join("")
    : '<option value="" disabled>No delivery work</option>';
  if (work.some((record) => record.id === selected))
    workSelect.value = selected;
}

async function refresh() {
  await Promise.all([refreshDecisions(), refreshWork()]);
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = createForm.querySelector("output")!;
  const data = new FormData(createForm);
  const body = {
    station: data.get("station"),
    title: data.get("title"),
    intent: data.get("intent"),
    decisionRef: data.get("decisionRef"),
    constraints: String(data.get("constraints") || "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    components: String(data.get("components") || "")
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
  };
  const response = await fetch("/api/work", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    output.textContent = `Creation failed: ${await response.text()}`;
    return;
  }
  const work = (await response.json()) as { id: string };
  output.textContent = `Created ${work.id} from approved direction.`;
  createForm.reset();
  await refreshWork(work.id);
});

deliveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent)
    .submitter as HTMLButtonElement | null;
  if (!submitter) return;
  const operation = submitter.value;
  const data = new FormData(deliveryForm);
  const workId = String(data.get("workId"));
  const metric = String(data.get("metricValue") || "");
  const body = {
    action: data.get("action"),
    artifactTitle: data.get("artifactTitle"),
    text: data.get("text"),
    outcome: data.get("outcome"),
    ...(metric ? { metricValue: Number(metric) } : {})
  };
  const output = deliveryForm.querySelector("output")!;
  output.textContent =
    operation === "verify" ? "Running pnpm test…" : "Recording…";
  const response = await fetch(
    `/api/work/${encodeURIComponent(workId)}/${operation}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  output.textContent = response.ok
    ? `${operation === "verify" ? "Verification" : operation.slice(0, -1)} recorded.`
    : `Recording failed: ${await response.text()}`;
  if (response.ok) await refreshWork(workId);
});

refresh().catch((error: Error) => {
  createForm.querySelector("output")!.textContent =
    `Unable to load delivery context: ${error.message}`;
});
new EventSource("/api/events/stream").onmessage = () => void refresh();
