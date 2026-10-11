(function (exports) {
  // NewMemberBadge for Revenge (Vendetta/Bunny plugin spec)
  // Port of Ushie's Aliucord plugin: flags chat authors who joined the current
  // server less than N days ago.
  //
  // DIAGNOSTIC BUILD: shows a few toasts explaining which step works, so we can
  // tell why a badge does or doesn't appear. Remove the `diag(...)` calls once
  // it works.
  "use strict";

  const VERSION = "v8";

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

  exports.default = {
    onLoad() {
      diag("onLoad called");
      storage.days ??= 7;
      storage.badge ??= "\uD83C\uDF31"; // seedling

      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (patchUsernameText() || attempts >= 20) {
          clearInterval(timer);
          if (!patched) diag("UsernameText module not found after " + attempts + " tries");
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
