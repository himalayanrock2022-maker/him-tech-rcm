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

  const emailIndex = headers.indexOf("email");

  if (emailIndex === -1) {
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
  elements.importMessage.style.color = success ? "#16845b" : "#b42318";
}

elements.csvFile.addEventListener("change", async event => {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    showMessage("Please select a CSV file.");
    return;
  }

  try {
    const content = await file.text();
    const imported = parseCSV(content);

    let added = 0;
    let duplicates = 0;
    let invalid = 0;

    const existingEmails = new Set(
      leads.map(lead => normalize(lead.email))
    );

    imported.forEach(lead => {
      const email = normalize(lead.email);

      if (!isValidEmail(email)) {
        invalid++;
        return;
      }

      if (existingEmails.has(email)) {
        duplicates++;
        return;
      }

      leads.push({
        ...lead,
        email,
        status: "Ready"
      });

      existingEmails.add(email);
      added++;
    });

    updateStats();
    renderLeads();

    showMessage(
      `Imported: ${added} | Duplicates skipped: ${duplicates} | Invalid: ${invalid}`,
      true
    );

  } catch (error) {
    showMessage(error.message || "Unable to read CSV file.");
  }

  event.target.value = "";
});

elements.leadSearch.addEventListener("input", renderLeads);

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

updateStats();
renderLeads();