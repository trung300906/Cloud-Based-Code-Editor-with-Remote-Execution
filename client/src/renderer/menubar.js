 
// MENUBAR — Custom dropdown menu, doSave, handleMenuAction
// setEditorLanguage được import từ monaco-init.js (tránh circular)
 
import { state, LS } from "./state.js";
import { getFocusedPane, splitEditor, removePane } from "./pane.js";
import { openOrActivateTab } from "./tab.js";
import { setEditorLanguage } from "./monaco-init.js";
import {
  DEFAULT_EDITOR_SETTINGS,
  loadEditorSettings,
  saveEditorSettings,
  applyEditorSettingsToAll,
} from "./editor-settings.js";
import { showDiffResolution } from "./diff-editor.js";

// ---- Save file hiện tại ----
export function doSave() {
  const pane = getFocusedPane();
  if (!pane?.editor) return;
  const content = pane.editor.getValue();
  window.electronAPI.sendSaveFile({
    filePath: state.currentFilePath || null,
    content,
  });
  if (state.currentFilePath && pane.activeTabId) {
    const tab = state.tabs.get(pane.activeTabId);
    if (tab) {
      tab.isModified = false;
      refreshTabElImport(pane.activeTabId);
    }
  }
}

// Lazy import để tránh circular (refreshTabEl ở tab.js cũng import pane.js)
async function refreshTabElImport(tabId) {
  const { refreshTabEl } = await import("./tab.js");
  refreshTabEl(tabId);
}

// ---- Dispatch action từ menu entry hoặc keyboard shortcut ----
export function handleMenuAction(action) {
  switch (action) {
    // File
    case "new-file":
      openOrActivateTab(null, "// Enter your code here...");
      break;
    case "open-file":
      window.electronAPI.menuOpenFile();
      break;
    case "open-folder":
      window.electronAPI.menuOpenFolder();
      break;
    case "save":
      doSave();
      break;
    case "quit":
      window.electronAPI.appQuit();
      break;

    // Editor / split
    case "toggle-theme":
      document.getElementById("theme-toggle-btn")?.click();
      break;
    case "split-editor":
      splitEditor("horizontal");
      break;
    case "split-editor-down":
      splitEditor("vertical");
      break;
    case "close-split":
      if (state.panes.length > 1) removePane(getFocusedPane().id);
      break;

    // Edit (Monaco built-in actions)
    case "undo":
      getFocusedPane()?.editor?.trigger("menu", "undo", null);
      break;
    case "redo":
      getFocusedPane()?.editor?.trigger("menu", "redo", null);
      break;
    case "cut":
      document.execCommand("cut");
      break;
    case "copy":
      document.execCommand("copy");
      break;
    case "paste":
      document.execCommand("paste");
      break;
    case "select-all":
      getFocusedPane()?.editor?.trigger(
        "menu",
        "editor.action.selectAll",
        null,
      );
      break;

    // View
    case "toggle-fullscreen":
      window.electronAPI.winToggleFullscreen();
      break;
    case "zoom-in":
      window.electronAPI.winZoomIn();
      break;
    case "zoom-out":
      window.electronAPI.winZoomOut();
      break;
    case "reset-zoom":
      window.electronAPI.winResetZoom();
      break;
    case "toggle-devtools":
      window.electronAPI.winToggleDevtools();
      break;

    // Window
    case "minimize":
      window.electronAPI.winMinimize();
      break;
    case "reload":
      window.electronAPI.winReload();
      break;
    case "close-window":
      window.electronAPI.winClose();
      break;
  }
}

// ---- Khởi tạo dropdown logic + theme toggle + lang dropdown ----
export async function initCustomMenubar() {
  const menubar = document.getElementById("custom-menubar");
  if (!menubar) return;

  // Lắng nghe sự kiện xung đột đồng bộ
  if (window.electronAPI && window.electronAPI.onSyncConflict) {
    window.electronAPI.onSyncConflict((data) => {
      showDiffResolution(data.filepath, data.localContent, data.cloudContent, data.cloudVersion);
    });
  }

  const menuItems = menubar.querySelectorAll(".menu-item");

  function closeAllMenus() {
    menuItems.forEach((item) => item.classList.remove("open"));
    state.openMenuItem = null;
  }

  menuItems.forEach((item) => {
    const label = item.querySelector(".menu-label");

    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (item.classList.contains("open")) {
        closeAllMenus();
      } else {
        closeAllMenus();
        item.classList.add("open");
        state.openMenuItem = item;
      }
    });

    // Hover chuyển giữa các menu khi đang có menu mở
    label.addEventListener("mouseenter", () => {
      if (state.openMenuItem && state.openMenuItem !== item) {
        closeAllMenus();
        item.classList.add("open");
        state.openMenuItem = item;
      }
    });
  });

  const userBtn = document.getElementById("user-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const userPopover = document.getElementById("user-popover");
  const settingsPopover = document.getElementById("settings-popover");

  const popoverEntries = [
    { key: "user", btn: userBtn, popover: userPopover },
    { key: "settings", btn: settingsBtn, popover: settingsPopover },
  ].filter((entry) => entry.btn && entry.popover);

  function closePopovers() {
    popoverEntries.forEach((entry) => {
      entry.popover.classList.remove("open");
      entry.popover.setAttribute("aria-hidden", "true");
      entry.btn.classList.remove("is-active");
    });
  }

  function positionPopover(popover, anchor) {
    const barRect = menubar.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const width = popover.getBoundingClientRect().width || 320;
    let left = anchorRect.right - barRect.left - width;
    left = Math.max(8, Math.min(left, barRect.width - width - 8));
    popover.style.left = `${Math.round(left)}px`;
  }

  function openPopover(entry) {
    closeAllMenus();
    closePopovers();
    positionPopover(entry.popover, entry.btn);
    entry.popover.classList.add("open");
    entry.popover.setAttribute("aria-hidden", "false");
    entry.btn.classList.add("is-active");
  }

  function togglePopover(entry) {
    if (entry.popover.classList.contains("open")) {
      closePopovers();
    } else {
      openPopover(entry);
    }
  }

  popoverEntries.forEach((entry) => {
    entry.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover(entry);
    });
    entry.popover.addEventListener("click", (e) => e.stopPropagation());
    entry.popover
      .querySelectorAll("[data-popover-close]")
      .forEach((btn) => btn.addEventListener("click", closePopovers));
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-item")) closeAllMenus();
    if (
      !e.target.closest(".menubar-popover") &&
      !e.target.closest(".menubar-chip")
    ) {
      closePopovers();
    }
  });

  menubar.querySelectorAll(".menu-entry").forEach((entry) => {
    entry.addEventListener("click", () => {
      const action = entry.dataset.action;
      closeAllMenus();
      handleMenuAction(action);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.openMenuItem) closeAllMenus();
      closePopovers();
    }
  });

  // ---- Activity tracking ----
  let lastActivity = Date.now();
  document.addEventListener("mousemove", () => { lastActivity = Date.now(); });
  document.addEventListener("keydown", () => { lastActivity = Date.now(); });

  // ---- Theme toggle ----
  const themeBtn = document.getElementById("theme-toggle-btn");
  let isDarkMode = localStorage.getItem(LS.THEME) !== "light";
  if (!isDarkMode) {
    document.body.classList.add("light-mode");
    if (themeBtn) themeBtn.textContent = "☀️ Light Mode: ON";
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem(LS.THEME, isDarkMode ? "dark" : "light");
      if (isDarkMode) {
        document.body.classList.remove("light-mode");
        themeBtn.textContent = "☀️ Light Mode: OFF";
        if (typeof monaco !== "undefined") monaco.editor.setTheme("vs-dark");
      } else {
        document.body.classList.add("light-mode");
        themeBtn.textContent = "☀️ Light Mode: ON";
        if (typeof monaco !== "undefined") monaco.editor.setTheme("vs");
      }
    });
  }

  // ---- Language dropdown ----
  const langSel = document.getElementById("lang-select");
  if (langSel) {
    langSel.addEventListener("change", (e) =>
      setEditorLanguage(e.target.value),
    );
  }

  const AUTH_URL = "http://100.124.23.95:3000/login";
  const LOGOUT_URL = "http://100.124.23.95:3000/logout";
  const REGISTER_URL = "http://100.124.23.95:3000/register";
  async function loadUserProfile() {
    try {
      const raw = localStorage.getItem(LS.USER_PROFILE);
      if (!raw) return null;
      const profile = JSON.parse(raw);
      // Giải mã token từ OS keychain nếu có
      if (profile?.encryptedToken && window.electronAPI?.decryptToken) {
        profile.token = await window.electronAPI.decryptToken(profile.encryptedToken);
        delete profile.encryptedToken;
      }
      return profile;
    } catch (_) {
      return null;
    }
  }

  async function saveUserProfile(profile) {
    try {
      const toSave = { ...profile };
      // Mã hóa token bằng OS keychain trước khi lưu
      if (toSave.token && window.electronAPI?.encryptToken) {
        toSave.encryptedToken = await window.electronAPI.encryptToken(toSave.token);
        delete toSave.token; // Không lưu plaintext token
      }
      localStorage.setItem(LS.USER_PROFILE, JSON.stringify(toSave));
    } catch (_) {}
  }

  if (userPopover) {
    const userWrapper = userPopover.querySelector("[data-user-wrapper]");
    const usernameInput = userPopover.querySelector("#login-username");
    const passwordInput = userPopover.querySelector("#login-password");
    const loginStatus = userPopover.querySelector("#login-status");
    const loginBtn = userPopover.querySelector("#login-btn");
    const loginClearBtn = userPopover.querySelector("#login-clear-btn");
    const logoutBtn = userPopover.querySelector("#logout-btn");
    const editProfileBtn = userPopover.querySelector("#edit-profile-btn");
    const copyTokenBtn = userPopover.querySelector("#copy-token-btn");
    const userAvatar = userPopover.querySelector("#user-avatar");
    const userName = userPopover.querySelector("#user-name");
    const userSub = userPopover.querySelector("#user-sub");
    const userRoom = userPopover.querySelector("#user-room");
    const userToken = userPopover.querySelector("#user-token");

    const joinRoomInput = userPopover.querySelector("#join-room-input");
    const joinRoomBtn = userPopover.querySelector("#join-room-btn");
    const leaveRoomBtn = userPopover.querySelector("#leave-room-btn");
    const activeRoomRow = userPopover.querySelector("#active-room-row");
    const activeRoomHost = userPopover.querySelector("#active-room-host");

    function renderUserProfile(profile) {
      const safeProfile = profile || {};
      const isAuth = Boolean(safeProfile.loggedIn);
      const displayName = safeProfile.username || "guest";
      const roomId = safeProfile.myRoomId || "---";
      const token = safeProfile.token || "";

      if (userWrapper) userWrapper.classList.toggle("is-auth", isAuth);
      if (usernameInput) usernameInput.value = displayName;
      if (passwordInput) passwordInput.value = "";
      if (userAvatar)
        userAvatar.textContent = displayName.slice(0, 2).toUpperCase();
      if (userName) userName.textContent = displayName;
      if (userSub) userSub.textContent = isAuth ? "signed in" : "guest";
      if (userRoom) userRoom.textContent = roomId;
      if (userToken) {
        userToken.textContent = token;
        userToken.title = token;
      }
      if (loginStatus) {
        loginStatus.textContent = "";
        loginStatus.classList.remove("is-error", "is-ok");
      }
    }

    let currentProfile = await loadUserProfile();
    let isRegisterMode = false;

    const authToggleText = userPopover.querySelector("#auth-toggle-text");
    const authModeToggle = userPopover.querySelector("#auth-mode-toggle");

    function setAuthMode(registerMode) {
      isRegisterMode = registerMode;
      if (loginBtn)
        loginBtn.textContent = isRegisterMode ? "Register" : "Login";
      if (authToggleText) {
        authToggleText.textContent = isRegisterMode
          ? "Already have an account?"
          : "Need an account?";
      }
      if (authModeToggle) {
        authModeToggle.textContent = isRegisterMode ? "Login" : "Register";
      }
      if (loginStatus) {
        loginStatus.textContent = "";
        loginStatus.classList.remove("is-error", "is-ok");
      }
    }

    if (authModeToggle) {
      authModeToggle.addEventListener("click", () => {
        setAuthMode(!isRegisterMode);
      });
    }
    renderUserProfile(currentProfile);

    // Helper: kiểm tra JWT hết hạn chưa (decode payload mà không cần thư viện)
    function isTokenExpired(token) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return true;
        const payload = JSON.parse(atob(parts[1]));
        if (!payload.exp) return false;
        // So sánh với thời gian hiện tại (exp tính bằng giây)
        return payload.exp * 1000 < Date.now();
      } catch (_) {
        return true;
      }
    }

    function isTokenExpiringSoon(token) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1]));
        if (!payload.exp) return false;
        // Expiring in less than 15 minutes?
        return (payload.exp * 1000) - Date.now() < 15 * 60 * 1000;
      } catch (_) {
        return false;
      }
    }

    // Khôi phục session: nếu profile đã lưu có token hợp lệ, gửi lại cho Main Process
    if (currentProfile?.loggedIn && currentProfile?.token) {
      if (isTokenExpired(currentProfile.token)) {
        // Token hết hạn → tự động clear session
        console.warn("[Menubar] Saved token expired, clearing session.");
        currentProfile = {
          username: currentProfile.username || "",
          myRoomId: currentProfile.myRoomId || "---",
          token: "",
          loggedIn: false,
          lastLogin: currentProfile.lastLogin || null,
        };
        await saveUserProfile(currentProfile);
        renderUserProfile(currentProfile);
      } else if (window.electronAPI?.loginSuccess) {
        window.electronAPI.loginSuccess(currentProfile.token);
        console.log("[Menubar] Restored saved session token to Main Process.");
      }
    }

    // Interval to check inactivity & auto-refresh token
    setInterval(async () => {
      if (!currentProfile?.loggedIn || !currentProfile?.token) return;

      const inactiveMs = Date.now() - lastActivity;
      if (inactiveMs > 3600000) { // 1 hour
        console.warn("[Menubar] Inactive for 1 hour, auto logging out...");
        alert("Phiên đăng nhập đã hết hạn do bạn không có hoạt động nào trong 1 giờ. Vui lòng đăng nhập lại.");
        performLogout();
        return;
      }

      if (isTokenExpiringSoon(currentProfile.token)) {
        try {
          const response = await fetch("http://100.124.23.95:3000/refresh", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${currentProfile.token}`
            }
          });
          const payload = await response.json();
          if (response.ok && payload.token) {
            console.log("[Menubar] Token successfully refreshed.");
            currentProfile.token = payload.token;
            await saveUserProfile(currentProfile);
            renderUserProfile(currentProfile);
            if (window.electronAPI?.loginSuccess) {
              window.electronAPI.loginSuccess(payload.token);
            }
          }
        } catch (err) {
          console.error("[Menubar] Failed to refresh token:", err);
        }
      }
    }, 60000); // Check every minute

    if (loginBtn) {
      loginBtn.addEventListener("click", async () => {
        const username = usernameInput?.value.trim();
        const password = passwordInput?.value || "";

        if (!username || !password) {
          if (loginStatus) {
            loginStatus.textContent = "Missing username or password";
            loginStatus.classList.add("is-error");
            loginStatus.classList.remove("is-ok");
          }
          return;
        }

        if (loginStatus) {
          loginStatus.textContent = isRegisterMode
            ? "Registering..."
            : "Logging in...";
          loginStatus.classList.remove("is-error", "is-ok");
        }

        // ─── REGISTER MODE ───
        if (isRegisterMode) {
          try {
            const response = await fetch(REGISTER_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              const message =
                payload?.error || `Registration failed (${response.status})`;
              if (loginStatus) {
                loginStatus.textContent = message;
                loginStatus.classList.add("is-error");
                loginStatus.classList.remove("is-ok");
              }
              return;
            }

            // Success: notify user, clear password, and switch back to Login
            if (passwordInput) passwordInput.value = "";
            if (loginStatus) {
              loginStatus.textContent =
                "Registration successful! Please log in.";
              loginStatus.classList.add("is-ok");
              loginStatus.classList.remove("is-error");
            }
            setAuthMode(false);
          } catch (err) {
            if (loginStatus) {
              loginStatus.textContent = err?.message || "Network error";
              loginStatus.classList.add("is-error");
              loginStatus.classList.remove("is-ok");
            }
          }
          return;
        }

        // ─── LOGIN MODE (original behavior) ───
        try {
          const response = await fetch(AUTH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.token) {
            const message =
              payload?.error || `Login failed (${response.status})`;
            if (loginStatus) {
              loginStatus.textContent = message;
              loginStatus.classList.add("is-error");
              loginStatus.classList.remove("is-ok");
            }
            return;
          }

          currentProfile = {
            username,
            myRoomId: payload.room_id || "---",
            token: payload.token,
            loggedIn: true,
            lastLogin: Date.now(),
          };
          await saveUserProfile(currentProfile);
          renderUserProfile(currentProfile);

          if (loginStatus) {
            loginStatus.textContent = "Login success";
            loginStatus.classList.add("is-ok");
            loginStatus.classList.remove("is-error");
          }

          if (window.electronAPI?.loginSuccess) {
            window.electronAPI.loginSuccess(payload.token);
          }
        } catch (err) {
          if (loginStatus) {
            loginStatus.textContent = err?.message || "Network error";
            loginStatus.classList.add("is-error");
            loginStatus.classList.remove("is-ok");
          }
        }
      });
    }

    if (loginClearBtn) {
      loginClearBtn.addEventListener("click", () => {
        if (usernameInput) usernameInput.value = "";
        if (passwordInput) passwordInput.value = "";
        if (loginStatus) {
          loginStatus.textContent = "";
          loginStatus.classList.remove("is-error", "is-ok");
        }
      });
    }

    async function performLogout() {
      const token = currentProfile?.token || "";
      if (loginStatus) {
        loginStatus.textContent = token ? "Logging out..." : "";
        loginStatus.classList.remove("is-error", "is-ok");
      }

      if (token) {
        try {
          const response = await fetch(LOGOUT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const isExpired = payload?.error === "invalid token" || response.status === 401;
            if (!isExpired) {
              // Lỗi thật sự (không phải expired) → báo lỗi và dừng
              const message = payload?.error || `Logout failed (${response.status})`;
              if (loginStatus) {
                loginStatus.textContent = message;
                loginStatus.classList.add("is-error");
                loginStatus.classList.remove("is-ok");
              }
              return;
            }
            // Token expired → vẫn cho logout local bình thường
            console.warn("[Menubar] Token expired, forcing local logout.");
          }
        } catch (err) {
          if (loginStatus) {
            loginStatus.textContent = err?.message || "Network error";
            loginStatus.classList.add("is-error");
            loginStatus.classList.remove("is-ok");
          }
          return;
        }
      }

      currentProfile = {
        username: currentProfile?.username || "",
        myRoomId: currentProfile?.myRoomId || "---",
        token: "",
        loggedIn: false,
        lastLogin: currentProfile?.lastLogin || null,
      };
      await saveUserProfile(currentProfile);
      renderUserProfile(currentProfile);
      if (loginStatus) {
        loginStatus.textContent = "Logged out";
        loginStatus.classList.add("is-ok");
        loginStatus.classList.remove("is-error");
      }
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        performLogout();
      });
    }

    if (editProfileBtn) {
      editProfileBtn.addEventListener("click", () => {
        performLogout();
      });
    }

    if (copyTokenBtn && userToken) {
      copyTokenBtn.addEventListener("click", async () => {
        const token = userToken.textContent || "";
        if (!token) return;
        try {
          await navigator.clipboard.writeText(token);
        } catch (_) {
          const tmp = document.createElement("textarea");
          tmp.value = token;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand("copy");
          tmp.remove();
        }
      });
    }

    // ─── JOIN / LEAVE ROOM LOGIC ───
    if (joinRoomBtn) {
      joinRoomBtn.addEventListener("click", async () => {
        const token = currentProfile?.token;
        const roomIdToJoin = joinRoomInput?.value.trim();
        if (!token || !roomIdToJoin) return;

        joinRoomBtn.textContent = "Joining...";
        try {
          const response = await fetch("http://100.124.23.95:3000/api/room/join", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ room_id: roomIdToJoin })
          });
          const payload = await response.json();
          if (!response.ok) {
            alert(payload.error || "Failed to join room");
            joinRoomBtn.textContent = "Join Room";
            return;
          }

          // Joined successfully!
          joinRoomBtn.style.display = "none";
          joinRoomInput.style.display = "none";
          leaveRoomBtn.style.display = "block";
          activeRoomRow.style.display = "flex";
          activeRoomHost.textContent = payload.owner_username;

          // Show workspace selection modal
          showWorkspaceModal(payload.projects, payload.owner_username, roomIdToJoin);
        } catch (err) {
          alert("Error: " + err.message);
          joinRoomBtn.textContent = "Join Room";
        }
      });
    }

    if (leaveRoomBtn) {
      leaveRoomBtn.addEventListener("click", async () => {
        const token = currentProfile?.token;
        if (!token) return;
        
        try {
          await fetch("http://100.124.23.95:3000/api/room/leave", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({})
          });
        } catch(e) {} // ignore local errors

        // Reset UI
        joinRoomBtn.style.display = "block";
        joinRoomInput.style.display = "block";
        joinRoomBtn.textContent = "Join Room";
        joinRoomInput.value = "";
        leaveRoomBtn.style.display = "none";
        activeRoomRow.style.display = "none";
        
        // Notify electron to clear guest workspace
        if (window.electronAPI?.leaveRoom) {
          window.electronAPI.leaveRoom();
        }
      });
    }

    function showWorkspaceModal(projects, ownerUsername, roomId) {
      const modal = document.getElementById("room-workspace-modal");
      const listContainer = document.getElementById("room-workspace-list");
      const cancelBtn = document.getElementById("cancel-join-btn");
      if (!modal || !listContainer) return;

      listContainer.innerHTML = "";
      if (projects.length === 0) {
        listContainer.innerHTML = "<div style='color:#ffaa00'>This user has no workspaces!</div>";
      } else {
        projects.forEach(proj => {
          const btn = document.createElement("button");
          btn.className = "primary-btn";
          btn.style.width = "100%";
          btn.style.marginBottom = "8px";
          btn.textContent = proj.name;
          btn.onclick = () => {
            modal.style.display = "none";
            // Tell electron we are a guest working on this project
            if (window.electronAPI?.projectSet) {
               window.electronAPI.projectSet({
                 name: proj.name,
                 workspaceRoot: null, // Let Main process handle it
                 isGuest: true,
                 ownerUsername: ownerUsername,
                 roomId: roomId,
                 projectId: proj.id
               }).then(res => {
                 if (res.success) {
                   // Clone project content for guest
                   window.electronAPI.cloneGuestProject({ projectId: proj.id, token: currentProfile.token });
                 } else {
                   alert("Error setting project context: " + res.error);
                 }
               });
            }
          };
          listContainer.appendChild(btn);
        });
      }

      modal.style.display = "flex";

      cancelBtn.onclick = () => {
        modal.style.display = "none";
        leaveRoomBtn.click(); // revert join
      };
    }
  }

  if (settingsPopover) {
    let settings = loadEditorSettings();

    const fontSizeInput = settingsPopover.querySelector("#setting-font-size");
    const fontSizeValue = settingsPopover.querySelector(
      "#setting-font-size-value",
    );
    const tabSizeInput = settingsPopover.querySelector("#setting-tab-size");
    const insertSpacesInput = settingsPopover.querySelector(
      "#setting-insert-spaces",
    );
    const wordWrapInput = settingsPopover.querySelector("#setting-word-wrap");
    const minimapInput = settingsPopover.querySelector("#setting-minimap");
    const lineNumbersInput = settingsPopover.querySelector(
      "#setting-line-numbers",
    );
    const smoothScrollInput = settingsPopover.querySelector(
      "#setting-smooth-scroll",
    );
    const whitespaceInput = settingsPopover.querySelector(
      "#setting-whitespace",
    );
    const settingsResetBtn = settingsPopover.querySelector(
      "#settings-reset-btn",
    );
    const settingsCloseBtn = settingsPopover.querySelector(
      "#settings-close-btn",
    );

    function syncSettingsForm(next) {
      const current = next || settings;
      if (fontSizeInput) fontSizeInput.value = String(current.fontSize);
      if (fontSizeValue) fontSizeValue.textContent = String(current.fontSize);
      if (tabSizeInput) tabSizeInput.value = String(current.tabSize);
      if (insertSpacesInput) insertSpacesInput.checked = current.insertSpaces;
      if (wordWrapInput) wordWrapInput.checked = current.wordWrap === "on";
      if (minimapInput) minimapInput.checked = current.minimap;
      if (lineNumbersInput)
        lineNumbersInput.checked = current.lineNumbers === "on";
      if (smoothScrollInput)
        smoothScrollInput.checked = current.smoothScrolling;
      if (whitespaceInput) whitespaceInput.value = current.renderWhitespace;
    }

    function updateSettings(next) {
      settings = { ...settings, ...next };
      saveEditorSettings(settings);
      applyEditorSettingsToAll(settings);
    }

    syncSettingsForm(settings);
    applyEditorSettingsToAll(settings);

    if (fontSizeInput) {
      fontSizeInput.addEventListener("input", () => {
        const size = Number(fontSizeInput.value);
        if (fontSizeValue) fontSizeValue.textContent = String(size);
        updateSettings({ fontSize: size });
      });
    }

    if (tabSizeInput) {
      tabSizeInput.addEventListener("change", () => {
        updateSettings({ tabSize: Number(tabSizeInput.value) });
      });
    }

    if (insertSpacesInput) {
      insertSpacesInput.addEventListener("change", () => {
        updateSettings({ insertSpaces: insertSpacesInput.checked });
      });
    }

    if (wordWrapInput) {
      wordWrapInput.addEventListener("change", () => {
        updateSettings({ wordWrap: wordWrapInput.checked ? "on" : "off" });
      });
    }

    if (minimapInput) {
      minimapInput.addEventListener("change", () => {
        updateSettings({ minimap: minimapInput.checked });
      });
    }

    if (lineNumbersInput) {
      lineNumbersInput.addEventListener("change", () => {
        updateSettings({
          lineNumbers: lineNumbersInput.checked ? "on" : "off",
        });
      });
    }

    if (smoothScrollInput) {
      smoothScrollInput.addEventListener("change", () => {
        updateSettings({ smoothScrolling: smoothScrollInput.checked });
      });
    }

    if (whitespaceInput) {
      whitespaceInput.addEventListener("change", () => {
        updateSettings({ renderWhitespace: whitespaceInput.value });
      });
    }

    if (settingsResetBtn) {
      settingsResetBtn.addEventListener("click", () => {
        settings = { ...DEFAULT_EDITOR_SETTINGS };
        saveEditorSettings(settings);
        syncSettingsForm(settings);
        applyEditorSettingsToAll(settings);
      });
    }

    if (settingsCloseBtn) {
      settingsCloseBtn.addEventListener("click", () => closePopovers());
    }
  }
}
