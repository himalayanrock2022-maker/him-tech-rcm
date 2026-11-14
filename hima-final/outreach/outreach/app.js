
"use strict";

const DAILY_LIMIT = 30;

let leads = [];
let selectedLeadIds = new Set();
let sentToday = 0;

const elements = {
  csvFile: document.getElementById("csvFile"),
  leadTable: document.getElementById("leadTable"),
  leadSearch: document.getElementById("leadSearch"),
  importMessage: document.getElementById("importMessage"),
  totalLeads: document.getElementById("totalLeads"),
  readyLeads: document.getElementById("readyLeads"),
  sentLeads: document.getElementById("sentLeads"),
  remainingLeads: document.getElementById("remainingLeads"),
  previewButton: document.getElementById("previewButton"),
  emailPreview: document.getElementById("emailPreview"),
  emailSubject: document.getElementById("emailSubject"),
  emailTemplate: document.getElementById("emailTemplate"),
  selectAllLeads: document.getElementById("selectAllLeads"),
  selectedLeadCount: document.getElementById("selectedLeadCount"),
  sendSelectedButton: document.getElementById("sendSelectedButton"),
  sendMessage: document.getElementById("sendMessage")
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function parseCSVLine(line) {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim() !== "");

  if (lines.length < 2) {
    throw new Error("CSV file does not contain any lead records.");
  }

  const headers = parseCSVLine(lines[0]).map(normalize);

  if (!headers.includes("email")) {
    throw new Error("CSV must contain an email column.");
  }

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);

    const get = key => {
      const index = headers.indexOf(key);
      return index >= 0 ? (values[index] || "").trim() : "";
    };

    return {
      name: get("name") || get("clinic") || get("practice"),
      email: get("email"),
      city: get("city"),
      state: get("state"),
      website: get("website"),
      specialty: get("specialty"),
      status: "Ready"
    };
  }).filter(lead => lead.email);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isEligible(lead) {
  return lead.id !== undefined &&
    lead.id !== null &&
    isValidEmail(lead.email) &&
    String(lead.status || "").toLowerCase() === "ready";
}

function updateStats() {
  const ready = leads.filter(lead =>
    isValidEmail(lead.email) &&
    String(lead.status || "").toLowerCase() === "ready"
  ).length;

  sentToday = leads.filter(lead =>
    String(lead.status || "").toLowerCase() === "sent"
  ).length;

  elements.totalLeads.textContent = leads.length;
  elements.readyLeads.textContent = ready;
  elements.sentLeads.textContent = sentToday;
  elements.remainingLeads.textContent =
    Math.max(0, DAILY_LIMIT - sentToday);

  updateSelectionCount();
}

function updateSelectionCount() {
  const validSelected = leads.filter(lead =>
    selectedLeadIds.has(String(lead.id)) && isEligible(lead)
  );

  selectedLeadIds = new Set(
    validSelected.map(lead => String(lead.id))
  );

  if (elements.selectedLeadCount) {
    elements.selectedLeadCount.textContent =
      validSelected.length + " leads selected";
  }

  if (elements.selectAllLeads) {
    const search = normalize(elements.leadSearch.value);

    const visibleEligible = leads.filter(lead => {
      const searchable = [
        lead.name,
        lead.email,
        lead.city,
        lead.state,
        lead.specialty
      ].join(" ");

      return isEligible(lead) &&
        normalize(searchable).includes(search);
    });

    const selectedVisible = visibleEligible.filter(lead =>
      selectedLeadIds.has(String(lead.id))
    ).length;

    elements.selectAllLeads.checked =
      visibleEligible.length > 0 &&
      selectedVisible === visibleEligible.length;

    elements.selectAllLeads.indeterminate =
      selectedVisible > 0 &&
      selectedVisible < visibleEligible.length;
  }
}

function renderLeads() {
  const search = normalize(elements.leadSearch.value);

  const filtered = leads.filter(lead => {
    const searchable = [
      lead.name,
      lead.email,
      lead.city,
      lead.state,
      lead.specialty
    ].join(" ");

    return normalize(searchable).includes(search);
  });

  if (!filtered.length) {
    elements.leadTable.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          No matching leads found.
        </td>
      </tr>
    `;
    updateSelectionCount();
    return;
  }

  elements.leadTable.innerHTML = filtered.map(lead => {
    const eligible = isEligible(lead);
    const checked = selectedLeadIds.has(String(lead.id));

    return `
      <tr>
        <td>
          <input
            type="checkbox"
            class="lead-select"
            data-id="${escapeHTML(lead.id)}"
            ${checked ? "checked" : ""}
            ${eligible ? "" : "disabled"}
            aria-label="Select ${escapeHTML(lead.name || lead.email)}"
            style="width:auto"
          >
        </td>
        <td>${escapeHTML(lead.name || "Not provided")}</td>
        <td>${escapeHTML(lead.email)}</td>
        <td>${escapeHTML(
          [lead.city, lead.state].filter(Boolean).join(", ") || "Not provided"
        )}</td>
        <td>${escapeHTML(lead.specialty || "Not provided")}</td>
        <td>${escapeHTML(lead.status || "Unknown")}</td>
      </tr>
    `;
  }).join("");

  updateSelectionCount();
}

function showMessage(message, success = false) {
  elements.importMessage.textContent = message;
  elements.importMessage.style.color =
    success ? "#16845b" : "#b42318";
}

// LOAD LEADS FROM DATABASE
async function loadLeadsFromDatabase() {
  const response = await fetch("/api/outreach-leads", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store"
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || "Unable to load saved leads.");
  }

  leads = Array.isArray(result.leads) ? result.leads : [];

  updateStats();
  renderLeads();

  return leads;
}

// IMPORT CSV AND SAVE TO DATABASE
elements.csvFile.addEventListener("change", async event => {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    showMessage("Please select a CSV file.");
    event.target.value = "";
    return;
  }

  try {
    showMessage("Reading CSV file...", true);

    const content = await file.text();
    const imported = parseCSV(content);

    let invalid = 0;
    let localDuplicates = 0;

    const existingEmails = new Set(
      leads.map(lead => normalize(lead.email))
    );

    const newLeads = [];

    imported.forEach(lead => {
      const email = normalize(lead.email);

      if (!isValidEmail(email)) {
        invalid++;
        return;
      }

      if (existingEmails.has(email)) {
        localDuplicates++;
        return;
      }

      existingEmails.add(email);

      newLeads.push({
        ...lead,
        email,
        status: "Ready"
      });
    });

    if (newLeads.length === 0) {
      showMessage(
        `No new leads to save. Duplicates: ${localDuplicates} | Invalid: ${invalid}`
      );
      return;
    }

    showMessage("Saving leads to database...", true);

    const response = await fetch("/api/outreach-leads", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ leads: newLeads })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to save leads.");
    }

    await loadLeadsFromDatabase();

    const added = Number(result.added || 0);
    const databaseDuplicates = Number(result.duplicates || 0);

    showMessage(
      `Saved: ${added} | Duplicates skipped: ${localDuplicates + databaseDuplicates} | Invalid: ${invalid}`,
      true
    );

  } catch (error) {
    showMessage(error.message || "Unable to import CSV.");
  }

  event.target.value = "";
});

elements.leadSearch.addEventListener("input", renderLeads);

// SELECT INDIVIDUAL LEADS
elements.leadTable.addEventListener("change", event => {
  if (!event.target.classList.contains("lead-select")) return;

  const id = event.target.dataset.id;

  if (event.target.checked) {
    selectedLeadIds.add(String(id));
  } else {
    selectedLeadIds.delete(String(id));
  }

  updateSelectionCount();
});

// SELECT ALL VISIBLE ELIGIBLE LEADS
if (elements.selectAllLeads) {
  elements.selectAllLeads.addEventListener("change", event => {
    const search = normalize(elements.leadSearch.value);

    const visibleEligible = leads.filter(lead => {
      const searchable = [
        lead.name,
        lead.email,
        lead.city,
        lead.state,
        lead.specialty
      ].join(" ");

      return isEligible(lead) &&
        normalize(searchable).includes(search);
    });

    visibleEligible.forEach(lead => {
      const id = String(lead.id);

      if (event.target.checked) {
        selectedLeadIds.add(id);
      } else {
        selectedLeadIds.delete(id);
      }
    });

    renderLeads();
  });
}

// AUTOMATIC LEAD GENERATOR
const findButton = document.getElementById("findLeadsButton");

if (findButton) {
  findButton.addEventListener("click", async () => {
    const message = document.getElementById("findLeadsMessage");

    findButton.disabled = true;
    findButton.textContent = "Searching...";
    message.textContent =
      "Searching for clinics and publicly listed business emails...";

    try {
      const response = await fetch("/api/outreach-generate-leads", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          state: document.getElementById("leadState").value,
          specialty: document.getElementById("leadSpecialty").value,
          limit: 30
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Lead search failed.");
      }

      await loadLeadsFromDatabase();

      const clinicsFound = Number(result.clinicsFound || 0);
      const websitesChecked = Number(result.websitesChecked || 0);

      const emailsFound = Number(
        result.publicBusinessEmailsFound ??
        result.publicEmailsFound ??
        0
      );

      const added = Number(result.added || 0);

      message.textContent =
        "Clinics found: " + clinicsFound +
        " | Websites checked: " + websitesChecked +
        " | Public emails found: " + emailsFound +
        " | New leads saved: " + added;

    } catch (error) {
      message.textContent = error.message || "Search failed.";
    } finally {
      findButton.disabled = false;
      findButton.textContent = "Find Leads";
    }
  });
}

// EMAIL PREVIEW
elements.previewButton.addEventListener("click", () => {
  const subject = elements.emailSubject.value.trim();
  const template = elements.emailTemplate.value.trim();

  if (!subject || !template) {
    elements.emailPreview.hidden = false;
    elements.emailPreview.textContent =
      "Please enter an email subject and message first.";
    return;
  }

  const sampleLead = leads[0] || {
    name: "Sample Clinic",
    city: "Dallas",
    state: "Texas",
    specialty: "Family Medicine"
  };

  elements.emailPreview.hidden = false;
  elements.emailPreview.textContent =
    `SUBJECT: ${replaceVariables(subject, sampleLead)}\n\n` +
    replaceVariables(template, sampleLead);
});

function replaceVariables(text, lead) {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, lead.name || "Healthcare Provider")
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || "")
    .replace(/\{\{\s*state\s*\}\}/gi, lead.state || "")
    .replace(/\{\{\s*specialty\s*\}\}/gi, lead.specialty || "");
}

// SEND SELECTED EMAILS
if (elements.sendSelectedButton) {
  elements.sendSelectedButton.addEventListener("click", async () => {
    const selected = leads.filter(lead =>
      selectedLeadIds.has(String(lead.id)) && isEligible(lead)
    );

    const subject = elements.emailSubject.value.trim();
    const message = elements.emailTemplate.value.trim();

    if (!selected.length) {
      elements.sendMessage.textContent =
        "Please select at least one eligible lead.";
      return;
    }

    if (!subject || !message) {
      elements.sendMessage.textContent =
        "Please enter an email subject and message.";
      return;
    }

    if (selected.length > DAILY_LIMIT) {
      elements.sendMessage.textContent =
        "You can select a maximum of 30 leads per campaign.";
      return;
    }

    const remaining = Math.max(0, DAILY_LIMIT - sentToday);

    if (selected.length > remaining) {
      elements.sendMessage.textContent =
        `Only ${remaining} daily sending slots remain. Please select fewer leads.`;
      return;
    }

    const confirmed = window.confirm(
      `You are about to send ${selected.length} emails from info@himatechrcm.com. Continue?`
    );

    if (!confirmed) return;

    elements.sendSelectedButton.disabled = true;
    elements.sendSelectedButton.textContent = "Sending...";
    elements.sendMessage.textContent =
      "Submitting selected emails. Please wait...";

    try {
      const ids = selected.map(lead => Number(lead.id));

      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("One or more lead IDs are invalid. Refresh the dashboard.");
      }

      const response = await fetch("/api/outreach-send", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ids,
          subject,
          message
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Email sending failed.");
      }

      const accepted = Number(result.accepted || 0);
      const failed = Number(result.failed || 0);

      elements.sendMessage.textContent =
        `SMTP accepted: ${accepted} | Failed: ${failed}. Acceptance does not guarantee inbox delivery.`;

      selectedLeadIds.clear();

      await loadLeadsFromDatabase();

    } catch (error) {
      elements.sendMessage.textContent =
        error.message || "Unable to send selected emails.";
    } finally {
      elements.sendSelectedButton.disabled = false;
      elements.sendSelectedButton.textContent = "Send Selected Emails";
      updateSelectionCount();
    }
  });
}

// INITIAL DISPLAY
updateStats();
renderLeads();

// ADMIN LOGIN
document.body.style.visibility = "hidden";

function showLoginScreen() {
  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f6f5f7;font-family:Arial;padding:20px">
      <form id="adminLoginForm" style="background:white;padding:30px;border-radius:14px;width:100%;max-width:380px;box-shadow:0 5px 25px #0001">
        <h2 style="color:#7d1a36;margin-bottom:8px">HIMA TECH RCM</h2>
        <p style="color:#777;margin-bottom:22px">Outreach Admin Login</p>
        <label for="adminPassword">Admin Password</label>
        <input id="adminPassword" type="password" required autocomplete="current-password"
          style="width:100%;padding:13px;margin:10px 0;border:1px solid #ddd;border-radius:7px">
        <button type="submit" style="width:100%;padding:13px;background:#7d1a36;color:white;border:0;border-radius:7px;font-weight:bold">
          Login
        </button>
        <p id="loginMessage" style="color:#b42318;margin-top:14px"></p>
      </form>
    </main>
  `;

  document.body.style.visibility = "visible";

  document.getElementById("adminLoginForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button");
    const message = document.getElementById("loginMessage");

    button.disabled = true;
    message.textContent = "Checking password...";

    try {
      const response = await fetch("/api/outreach-auth", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password: document.getElementById("adminPassword").value
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        message.textContent = result.message || "Login failed.";
        button.disabled = false;
        return;
      }

      location.reload();

    } catch {
      message.textContent = "Connection error. Please try again.";
      button.disabled = false;
    }
  });
}

// CHECK SESSION AND LOAD DATABASE
async function checkAdminSession() {
  try {
    const response = await fetch("/api/outreach-auth", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });

    if (response.ok) {
      document.body.style.visibility = "visible";

      const logout = document.createElement("button");
      logout.textContent = "Logout";
      logout.style.cssText =
        "position:fixed;top:18px;right:20px;z-index:9999;padding:9px 15px;background:#7d1a36;color:white;border:0;border-radius:6px;cursor:pointer";

      logout.onclick = async () => {
        await fetch("/api/outreach-auth", {
          method: "DELETE",
          credentials: "same-origin"
        });

        location.reload();
      };

      document.body.appendChild(logout);

      try {
        await loadLeadsFromDatabase();
      } catch (error) {
        showMessage(error.message || "Unable to load database leads.");
      }

      return;
    }

  } catch (error) {
    console.error("Session check failed:", error);
  }

  showLoginScreen();
}

checkAdminSession();
