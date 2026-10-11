(function (exports) {
  // NewMemberBadge for Revenge (Vendetta/Bunny plugin spec)
  // Port of Ushie's Aliucord plugin: flags chat authors who joined the current
  // server less than N days ago.
  //
  // DIAGNOSTIC BUILD: shows a few toasts explaining which step works, so we can
  // tell why a badge does or doesn't appear. Remove the `diag(...)` calls once
  // it works.
  "use strict";

  const VERSION = "v4";

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

  const { before } = vendetta.patcher;
  const { findByStoreName } = vendetta.metro;
  const { React, ReactNative } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;

  const DAY_MS = 24 * 60 * 60 * 1000;

  const GuildMemberStore = findByStoreName("GuildMemberStore");
  const SelectedGuildStore = findByStoreName("SelectedGuildStore");
  const ChatManager = ReactNative.NativeModules.DCDChatManager;

  let unpatch;
  let reported = 0; // how many diagnostic reports we've shown

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
          (logs.length ? logs.join("\n") : "(no log lines yet)")
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

  exports.default = {
    onLoad() {
      diag("onLoad called");
      storage.days ??= 7;
      storage.badge ??= "🌱"; // seedling

      if (!ChatManager || typeof ChatManager.updateRows !== "function") {
        diag("DCDChatManager.updateRows not found - this Discord build renders chat differently");
        return;
      }
      diag("loaded, hooked updateRows");

      // Chat rows are handed to the native renderer as a JSON string.
      unpatch = before("updateRows", ChatManager, (args) => {
        try {
          const raw = args[1];
          if (typeof raw !== "string") {
            if (reported < 2) {
              reported++;
              diag("updateRows arg[1] is " + typeof raw + ", not a JSON string");
            }
            return;
          }

          const guildId = SelectedGuildStore.getGuildId();
          const rows = JSON.parse(raw);

          let messages = 0;
          let withId = 0;
          let withJoin = 0;
          let badged = 0;
          let sampleKeys = "";

          for (const row of rows) {
            const msg = row && row.message;
            if (!msg || typeof msg.username !== "string") continue;
            messages++;
            if (!sampleKeys) sampleKeys = Object.keys(msg).slice(0, 25).join(",");

            const userId = msg.authorId ?? msg.userId ?? (msg.author && msg.author.id);
            if (userId) withId++;

            const joinedAt = guildId ? joinedAtOf(guildId, userId) : null;
            if (joinedAt) withJoin++;

            if (joinedAt && isNew(joinedAt) && !msg.username.endsWith(" " + storage.badge)) {
              msg.username = msg.username + " " + storage.badge;
              badged++;
            }
          }

          if (messages > 0) args[1] = JSON.stringify(rows);

          // Report the first couple of batches that contain messages.
          if (messages > 0 && reported < 2) {
            reported++;
            diag(
              "guild=" + (guildId ? "yes" : "none") +
                " msgs=" + messages +
                " authorId=" + withId +
                " joinDate=" + withJoin +
                " badged=" + badged
            );
            if (withId === 0) diag("message keys: " + sampleKeys);
          }
        } catch (e) {
          // Never break chat rendering because of this plugin.
          console.error("[NewMemberBadge]", e);
          if (reported < 3) {
            reported++;
            diag("error: " + (e && e.message));
          }
        }
      });
    },

    onUnload() {
      if (unpatch) unpatch();
    },

    settings: Settings,
  };

  return exports;
})({});
