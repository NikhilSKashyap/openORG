import { createOpenorgClient } from "@openorg/sdk";
import { mountWorkbench } from "@openorg/workbench-kit";
import "@openorg/workbench-kit/styles.css";
import { manifest } from "./manifest";

mountWorkbench(document.querySelector("#app")!, {
  manifest,
  client: createOpenorgClient(location.origin)
});

const host = document.querySelector("#create")!;
host.innerHTML = `
  <form class="role-form">
    <div>
      <p class="role-eyebrow">New customer evidence</p>
      <h2>Capture a signal</h2>
    </div>
    <label>Account<input name="account" required></label>
    <label>Source system<input name="source" placeholder="salesforce, zoom, email" required></label>
    <label>Source ID<input name="sourceId" placeholder="call or message ID" required></label>
    <label>Summary<textarea name="summary" required></textarea></label>
    <label>Exact customer words<textarea name="exactQuote"></textarea></label>
    <label>Desired outcome<input name="desiredOutcome"></label>
    <label>Urgency<input name="urgency"></label>
    <label>Severity<select name="severity"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select></label>
    <label>Classification<select name="classification"><option>internal</option><option selected>confidential</option><option>restricted</option><option>public</option></select></label>
    <button>Capture with provenance</button>
    <output aria-live="polite"></output>
  </form>`;

host.querySelector("form")!.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const response = await fetch("/api/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
  const output = form.querySelector("output")!;
  if (!response.ok) {
    output.textContent = `Capture failed: ${await response.text()}`;
    return;
  }
  const signal = (await response.json()) as { id: string };
  output.textContent = `Captured ${signal.id} with signed provenance.`;
  form.reset();
});
