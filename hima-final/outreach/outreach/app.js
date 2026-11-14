
"use strict";

const DAILY_LIMIT = 30;

let leads = [];
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
  emailTemplate: document.getElementById("emailTemplate")
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

function updateStats() {
  const ready = leads.filter(lead =>
    isValidEmail(lead.email) &&
    lead.status === "Ready"
  ).length;

  elements.totalLeads.textContent = leads.length;
  elements.readyLeads.textContent = ready;
  elements.sentLeads.textContent = sentToday;
  elements.remainingLeads.textContent =
    Math.max(0, DAILY_LIMIT - sentToday);
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
        <td colspan="5" class="empty-state">
          No matching leads found.
        </td>
      </tr>
    `;
    return;
  }

  elements.leadTable.innerHTML = filtered.map(lead => `
    <tr>
      <td>${escapeHTML(lead.name || "Not provided")}</td>
      <td>${escapeHTML(lead.email)}</td>
      <td>${escapeHTML([lead.city, lead.state].filter(Boolean).join(", ") || "Not provided")}</td>
      <td>${escapeHTML(lead.specialty || "Not provided")}</td>
      <td>${escapeHTML(lead.status)}</td>
    </tr>
  `).join("");
}

function showMessage(message, success = false) {
  elements.importMessage.textContent = message;
  elements.importMessage.style.color =
    success ? "#16845b" : "#b42318";
}

// LOAD LEADS FROM NEON DATABASE
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

// IMPORT CSV AND SAVE TO NEON
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
      body: JSON.stringify({
        leads: newLeads
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to save leads.");
    }

    await loadLeadsFromDatabase();

    const added = Number(result.added || 0);
    const databaseDuplicates = Number(result.duplicates || 0);
    const totalDuplicates = localDuplicates + databaseDuplicates;

    showMessage(
      `Saved: ${added} | Duplicates skipped: ${totalDuplicates} | Invalid: ${invalid}`,
      true
    );

  } catch (error) {
    showMessage(error.message || "Unable to import CSV.");
  }

  event.target.value = "";
});

elements.leadSearch.addEventListener("input", renderLeads);

const findButton = document.getElementById("findLeadsButton");

if (findButton) {
  findButton.addEventListener("click", async () => {
    const message = document.getElementById("findLeadsMessage");

    findButton.disabled = true;
    findButton.textContent = "Searching...";
    message.textContent = "Google is searching for clinics and public emails...";

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

      message.textContent =
        "Clinics found: " + result.clinicsFound +
        " | Websites checked: " + result.websitesChecked +
        " | Emails found: " + result.publicEmailsFound +
        " | New leads saved: " + result.added;

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

  const personalizedSubject = replaceVariables(subject, sampleLead);
  const personalizedMessage = replaceVariables(template, sampleLead);

  elements.emailPreview.hidden = false;
  elements.emailPreview.textContent =
    `SUBJECT: ${personalizedSubject}\n\n${personalizedMessage}`;
});

function replaceVariables(text, lead) {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, lead.name || "Healthcare Provider")
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || "")
    .replace(/\{\{\s*state\s*\}\}/gi, lead.state || "")
    .replace(/\{\{\s*specialty\s*\}\}/gi, lead.specialty || "");
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
        showMessage(
          error.message || "Unable to load database leads."
        );
      }

      return;
    }

  } catch (error) {
    console.error("Session check failed:", error);
  }

  showLoginScreen();
}

checkAdminSession();
