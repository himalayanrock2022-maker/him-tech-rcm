
// Secure dashboard access gate
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
        headers: { "Content-Type": "application/json" },
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

async function checkAdminSession() {
  try {
    const response = await fetch("/api/outreach-auth", {
      cache: "no-store"
    });

    if (response.ok) {
      document.body.style.visibility = "visible";

      const logout = document.createElement("button");
      logout.textContent = "Logout";
      logout.style.cssText = "position:fixed;top:18px;right:20px;z-index:9999;padding:9px 15px;background:#7d1a36;color:white;border:0;border-radius:6px;cursor:pointer";

      logout.onclick = async () => {
        await fetch("/api/outreach-auth", { method: "DELETE" });
        location.reload();
      };

      document.body.appendChild(logout);
      return;
    }
  } catch {}

  showLoginScreen();
}
