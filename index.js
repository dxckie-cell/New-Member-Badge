(function (exports) {
  // NewMemberBadge for Revenge (Vendetta/Bunny plugin spec)
  // Port of Ushie's Aliucord plugin: flags chat authors who joined the current
  // server less than N days ago.
  //
  // DIAGNOSTIC BUILD: shows a few toasts explaining which step works, so we can
  // tell why a badge does or doesn't appear. Remove the `diag(...)` calls once
  // it works.
  "use strict";

  const VERSION = "v16";

  // Every diagnostic line is kept here and shown on the plugin's settings page,
  // because toasts fired while Discord is still starting up can be lost.
  const logs = [];

  // Defined first so it works even if a later lookup throws.
  function diag(text) {
    try {
      logs.push(new Date().toLocaleTimeString() + "  " + text);
      console.log("[NewMemberBadge " + VERSION + "] " + text);
    } catch (e) {}
    // Toast now and again after startup settles.
    const toast = () => {
      try {
        vendetta.ui.toasts.showToast("NMB " + VERSION + ": " + text);
      } catch (e) {}
    };
    toast();
    try {
      setTimeout(toast, 8000);
    } catch (e) {}
  }

  diag("file evaluated");

  const { after } = vendetta.patcher;
  const { findByStoreName } = vendetta.metro;
  const { React, ReactNative } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const ICON_URL = "https://dxckie-cell.github.io/New-Member-Badge/badge.png";

  const GuildMemberStore = findByStoreName("GuildMemberStore");
  const SelectedGuildStore = findByStoreName("SelectedGuildStore");

  let unpatch;
  let reported = 0; // how many diagnostic reports we've shown


  // Chat is drawn by JS components on this Discord build, so look for the
  // message-header component. List module exports whose names look relevant.
  function scanComponents() {
    const out = [];
    try {
      const re = /message.*(header|author|user)|author.?name|user.?name|guild.?tag|clan.?tag|primary.?guild|chat.?message|MessageContent/i;
      const mods = vendetta.metro.modules;
      for (const id in mods) {
        if (out.length >= 80) break;
        try {
          const m = mods[id];
          if (!m || !m.isInitialized) continue;
          const e = m.publicModule && m.publicModule.exports;
          if (!e) continue;
          const names = [];
          const d = e.default;
          if (d && (typeof d === "function" || typeof d === "object")) {
            names.push(d.displayName || d.name || "");
          }
          if (typeof e === "function") names.push(e.displayName || e.name || "");
          if (e.name && typeof e.name === "string") names.push(e.name);
          const hit = names.filter((n) => n && re.test(n));
          if (hit.length) out.push(id + ": " + hit.join("/"));
        } catch (err) {}
      }
    } catch (err) {
      out.push("scan error: " + (err && err.message));
    }
    return out;
  }


  // --- Discovery probes ---------------------------------------------------
  // Record the names of components that get rendered, so we can see which one
  // draws a chat message header.
  const seenComponents = new Set();
  function componentName(t) {
    if (!t || typeof t === "string") return "";
    return (
      t.displayName ||
      t.name ||
      (t.type && (t.type.displayName || t.type.name)) ||
      (t.render && (t.render.displayName || t.render.name)) ||
      ""
    );
  }
  function recordElementType(args) {
    try {
      if (seenComponents.size > 4000) return;
      const n = componentName(args[0]);
      if (n) seenComponents.add(n);
    } catch (e) {}
  }
  function startRenderProbe() {
    try {
      const rt = vendetta.metro.findByProps("jsx", "jsxs");
      if (rt) {
        unpatches.push(vendetta.patcher.before("jsx", rt, recordElementType));
        unpatches.push(vendetta.patcher.before("jsxs", rt, recordElementType));
        return "jsx runtime";
      }
    } catch (e) {}
    try {
      unpatches.push(vendetta.patcher.before("createElement", React, recordElementType));
      return "createElement";
    } catch (e) {}
    return "none";
  }
  function renderedMessageish() {
    const re = /message|author|username|header|guildtag|clan|nick|displayname|chat/i;
    return Array.from(seenComponents).filter((n) => re.test(n)).sort().slice(0, 150);
  }

  // Named exports (not just default) whose key looks relevant.
  function scanKeys() {
    const out = [];
    try {
      const re = /^(?!use|get|format|resolve|create)(.*message.*(header|author|user|name)|.*author.*name|chatmessage|messageheader|messageauthor|usernametext)/i;
      const mods = vendetta.metro.modules;
      for (const id in mods) {
        if (out.length >= 60) break;
        try {
          const m = mods[id];
          if (!m || !m.isInitialized) continue;
          const e = m.publicModule && m.publicModule.exports;
          if (!e || typeof e !== "object") continue;
          const keys = Object.keys(e).filter((k) => re.test(k));
          if (keys.length) out.push(id + ": " + keys.slice(0, 4).join(", "));
        } catch (err) {}
      }
    } catch (err) {}
    return out;
  }

  function joinedAtOf(guildId, userId) {
    if (!guildId || !userId) return null;
    const member = GuildMemberStore.getMember(guildId, userId);
    return (member && member.joinedAt) || null;
  }

  function isNew(joinedAt) {
    const joined = Date.parse(joinedAt);
    if (Number.isNaN(joined)) return false;
    return Date.now() - joined < Number(storage.days) * DAY_MS;
  }

  function Settings() {
    useProxy(storage);
    return React.createElement(
      ReactNative.ScrollView,
      null,
      React.createElement(
        ReactNative.Text,
        { style: { color: "#ffffff", padding: 16 }, selectable: true },
        "NewMemberBadge " + VERSION + " diagnostics:\n" +
          (logs.length ? logs.join("\n") : "(no log lines yet)") +
          "\n\nUsernameText renders seen: " + calls +
          "\nGuildMemberStore: " + (GuildMemberStore ? "found" : "MISSING") +
          "\nSelectedGuildStore: " + (SelectedGuildStore ? "found" : "MISSING") +
          "\n\nRender probe: " + probeMode + ", " + seenComponents.size + " component names seen" +
          "\n\nRendered (message-ish):\n" + renderedMessageish().join("\n") +
          "\n\nNamed exports:\n" + scanKeys().join("\n") +
          "\n\nCandidate components:\n" + scanComponents().join("\n")
      ),
      React.createElement(Forms.FormInput, {
        title: "Days a member counts as new",
        value: String(storage.days),
        keyboardType: "numeric",
        onChange: (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n > 0) storage.days = n;
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Mode: tag (icon chip) or text (emoji after name)",
        value: storage.mode,
        onChange: (v) => {
          storage.mode = String(v).trim().toLowerCase() === "text" ? "text" : "tag";
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Label next to the icon, up to 4 letters (empty = icon only)",
        value: storage.label,
        onChange: (v) => {
          storage.label = v;
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Badge text",
        value: storage.badge,
        onChange: (v) => {
          storage.badge = v;
        },
      })
    );
  }

  const unpatches = [];
  let patched = false;
  let stopTimer;
  let propReports = 0;
  let loggedFields = false;
  let probeMode = "not started";
  let calls = 0; // how many times the patched UsernameText has rendered

  // Find the module whose default export is the UsernameText component.
  function findUsernameTextModule() {
    const mods = vendetta.metro.modules;
    for (const id in mods) {
      try {
        const m = mods[id];
        if (!m || !m.isInitialized) continue;
        const e = m.publicModule && m.publicModule.exports;
        const d = e && e.default;
        if (d && (d.displayName === "UsernameText" || d.name === "UsernameText")) return e;
      } catch (err) {}
    }
    return null;
  }

  function badgeFor(props) {
    const userId =
      (props.user && props.user.id) ||
      props.userId ||
      (props.author && props.author.id) ||
      (props.member && props.member.userId);
    const guildId = props.guildId || SelectedGuildStore.getGuildId();
    const joinedAt = guildId && userId ? joinedAtOf(guildId, userId) : null;
    return { userId, guildId, joinedAt, isNew: !!joinedAt && isNew(joinedAt) };
  }

  function patchUsernameText() {
    const mod = findUsernameTextModule();
    if (!mod) return false;

    const target = typeof mod.default === "function" ? "default" : null;
    if (!target) {
      diag("UsernameText default export is " + typeof mod.default + " (needs different patch)");
      patched = true;
      return true;
    }

    unpatches.push(
      after(target, mod, (args, ret) => {
        try {
          calls++;
          const props = args[0] || {};
          const info = badgeFor(props);

          if (propReports < 4) {
            propReports++;
            diag(
              "props=" + Object.keys(props).slice(0, 12).join(",") +
                " userId=" + (info.userId ? "yes" : "no") +
                " guild=" + (info.guildId ? "yes" : "no") +
                " joined=" + (info.joinedAt ? "yes" : "no") +
                " new=" + info.isNew
            );
          }

          if (!info.isNew || !ret) return;
          return React.createElement(
            React.Fragment,
            null,
            ret,
            React.createElement(ReactNative.Text, null, " " + storage.badge)
          );
        } catch (e) {
          if (propReports < 6) {
            propReports++;
            diag("error: " + (e && e.message));
          }
        }
      })
    );

    patched = true;
    diag("patched UsernameText");
    return true;
  }

  // --- Native chat rows ----------------------------------------------------
  // Messages are drawn by the native DCDChatList from JSON rows. Try several
  // ways of reaching the manager object that receives those rows.
  function findChatManager() {
    const tries = [
      ["findByProps(updateRows)", () => vendetta.metro.findByProps("updateRows")],
      ["NativeModules.DCDChatManager", () => ReactNative.NativeModules && ReactNative.NativeModules.DCDChatManager],
      ["nativeModuleProxy.DCDChatManager", () => globalThis.nativeModuleProxy && globalThis.nativeModuleProxy.DCDChatManager],
      ["TurboModuleRegistry.get", () => ReactNative.TurboModuleRegistry && ReactNative.TurboModuleRegistry.get("DCDChatManager")],
    ];
    const report = [];
    for (const [label, fn] of tries) {
      try {
        const m = fn();
        const has = !!m && typeof m.updateRows === "function";
        report.push(label + ": " + (m ? (has ? "HAS updateRows" : "object, no updateRows") : "undefined"));
        if (has) return { manager: m, label, report };
      } catch (e) {
        report.push(label + ": error " + (e && e.message));
      }
    }
    return { manager: null, label: null, report };
  }

  function patchChatRows() {
    const found = findChatManager();
    if (!found.manager) return found;

    try {
      diag("manager via " + found.label + "; keys=" + Object.keys(found.manager).slice(0, 14).join(","));
    } catch (e) {}

    unpatches.push(
      vendetta.patcher.before("updateRows", found.manager, (args) => {
        try {
          const raw = args[1];
          const isString = typeof raw === "string";
          let rows = isString ? JSON.parse(raw) : raw;
          let wrapper = null;
          if (rows && !Array.isArray(rows) && Array.isArray(rows.rows)) {
            wrapper = rows;
            rows = rows.rows;
          }
          if (!Array.isArray(rows)) {
            if (propReports < 3) {
              propReports++;
              diag("updateRows arg[1] is " + (rows === null ? "null" : typeof rows) +
                (rows && typeof rows === "object" ? " keys=" + Object.keys(rows).slice(0, 8).join(",") : ""));
            }
            return;
          }

          const guildId = SelectedGuildStore.getGuildId();
          let messages = 0, withId = 0, withJoin = 0, badged = 0;
          let sampleKeys = "";

          const newRows = rows.map((row) => {
            const msg = row && row.message;
            if (!msg || typeof msg.username !== "string") return row;
            messages++;
            if (!sampleKeys) sampleKeys = Object.keys(msg).slice(0, 30).join(",");
            if (!loggedFields) {
              loggedFields = true;
              try {
                const parts = [];
                for (const k of Object.keys(msg)) {
                  if (/icon|tag|role|badge|decor|avatar|name|color/i.test(k)) {
                    let v;
                    try { v = JSON.stringify(msg[k]); } catch (e) { v = String(msg[k]); }
                    parts.push(k + "=" + String(v).slice(0, 70));
                  }
                }
                diag("fields: " + parts.join(" ; "));
                diag("all keys: " + Object.keys(msg).join(","));
              } catch (e) {}
            }

            const userId = msg.authorId ?? msg.userId ?? (msg.author && msg.author.id);
            if (userId) withId++;
            const joinedAt = guildId ? joinedAtOf(guildId, userId) : null;
            if (joinedAt) withJoin++;

            if (joinedAt && isNew(joinedAt)) {
              badged++;
              const changes = {};
              // Preferred: render it like a guild tag, which shows a full-colour
              // badge image next to the name. Skip it when the author already
              // has a guild tag, and fall back to the emoji text.
              const hasGuildTag = !!(msg.clanTag || msg.clanBadgeUrl);
              if (storage.mode !== "text" && !hasGuildTag) {
                // Empty label = icon only. A zero-width space keeps the chip alive.
                changes.clanTag = storage.label ? String(storage.label).slice(0, 4) : "\u200B";
                changes.clanBadgeUrl = ICON_URL;
                changes.clanTagGuildId = msg.guildId || guildId;
              } else if (!msg.username.endsWith(" " + storage.badge)) {
                changes.username = msg.username + " " + storage.badge;
              }
              // Copy instead of mutating, in case the row objects are frozen.
              return Object.assign({}, row, { message: Object.assign({}, msg, changes) });
            }
            return row;
          });

          if (badged > 0) {
            if (isString) args[1] = JSON.stringify(wrapper ? Object.assign({}, wrapper, { rows: newRows }) : newRows);
            else args[1] = wrapper ? Object.assign({}, wrapper, { rows: newRows }) : newRows;
          }

          if (propReports < 5) {
            propReports++;
            const first = rows[0];
            diag(
              "arg1=" + (isString ? "string" : "object") + " rows=" + rows.length +
                " firstRowKeys=" + (first && typeof first === "object" ? Object.keys(first).slice(0, 8).join(",") : typeof first) +
                " | guild=" + (guildId ? "yes" : "none") + " msgs=" + messages +
                " authorId=" + withId + " joinDate=" + withJoin + " badged=" + badged
            );
            if (messages > 0 && (withId === 0 || withJoin === 0)) diag("message keys: " + sampleKeys);
          }
        } catch (e) {
          if (propReports < 6) {
            propReports++;
            diag("rows error: " + (e && e.message));
          }
        }
      })
    );
    return found;
  }

  exports.default = {
    onLoad() {
      diag("onLoad called");
      storage.days ??= 7;
      storage.badge ??= "\uD83C\uDF31"; // seedling
      storage.mode ??= "tag"; // "tag" = chip with icon, "text" = emoji after the name
      storage.label ??= ""; // empty = icon only
      probeMode = "off";

      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const found = patchChatRows();
        if (found.manager) {
          clearInterval(timer);
          patched = true;
          diag("hooked updateRows");
        } else if (attempts >= 15) {
          clearInterval(timer);
          diag("chat manager not found: " + found.report.join(" | "));
        }
      }, 1500);
      stopTimer = () => clearInterval(timer);
    },

    onUnload() {
      if (stopTimer) stopTimer();
      for (const u of unpatches) {
        try {
          u();
        } catch (e) {}
      }
      unpatches.length = 0;
    },

    settings: Settings,
  };

  return exports;
})({});
