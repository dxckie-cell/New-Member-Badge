(function (exports) {
  // NewMemberBadge for Revenge (Vendetta/Bunny plugin spec)
  // Port of Ushie's Aliucord plugin: marks chat authors who joined the current
  // server less than N days ago with a badge next to their name.
  "use strict";

  const { findByStoreName } = vendetta.metro;
  const { React, ReactNative } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BASE_URL = "https://dxckie-cell.github.io/New-Member-Badge/";
  // "centered" is smaller but centred in the chip; "big" is larger but sits slightly left.
  const ICON_FILES = { big: "badge2.png", centered: "badge3.png" };

  const GuildMemberStore = findByStoreName("GuildMemberStore");
  const SelectedGuildStore = findByStoreName("SelectedGuildStore");

  const unpatches = [];
  let stopTimer;

  function iconUrl() {
    return BASE_URL + (ICON_FILES[storage.icon] || ICON_FILES.centered);
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

  // Messages are drawn by the native chat list, which receives rows through the
  // chat manager's updateRows. Find that manager.
  function findChatManager() {
    const tries = [
      () => vendetta.metro.findByProps("updateRows"),
      () => ReactNative.NativeModules && ReactNative.NativeModules.DCDChatManager,
      () => globalThis.nativeModuleProxy && globalThis.nativeModuleProxy.DCDChatManager,
      () => ReactNative.TurboModuleRegistry && ReactNative.TurboModuleRegistry.get("DCDChatManager"),
    ];
    for (const get of tries) {
      try {
        const m = get();
        if (m && typeof m.updateRows === "function") return m;
      } catch (e) {}
    }
    return null;
  }

  // Returns a copy of the row with the badge applied, or the row untouched.
  function badgeRow(row, guildId) {
    const msg = row && row.message;
    if (!msg || typeof msg.username !== "string") return row;

    const userId = msg.authorId ?? msg.userId ?? (msg.author && msg.author.id);
    const joinedAt = guildId ? joinedAtOf(guildId, userId) : null;
    if (!joinedAt || !isNew(joinedAt)) return row;

    const changes = {};
    // Preferred: render it like a guild tag, which shows a full-colour badge image
    // next to the name. Skip people who already have a guild tag (unless the
    // override is on) and fall back to an emoji after the name.
    const hasGuildTag = !!(msg.clanTag || msg.clanBadgeUrl);
    if (storage.mode !== "text" && (!hasGuildTag || storage.override === "yes")) {
      // Empty label = icon only. A zero-width space keeps the chip alive.
      changes.clanTag =
        storage.label === "none" ? "" : storage.label ? String(storage.label).slice(0, 4) : "\u200B";
      changes.clanBadgeUrl = iconUrl();
      changes.clanTagGuildId = msg.guildId || guildId;
    } else if (!msg.username.endsWith(" " + storage.badge)) {
      changes.username = msg.username + " " + storage.badge;
    } else {
      return row;
    }

    // Copy instead of mutating, in case the row objects are frozen.
    return Object.assign({}, row, { message: Object.assign({}, msg, changes) });
  }

  function patchChatRows(manager) {
    unpatches.push(
      vendetta.patcher.before("updateRows", manager, (args) => {
        try {
          const raw = args[1];
          const isString = typeof raw === "string";
          let rows = isString ? JSON.parse(raw) : raw;
          let wrapper = null;
          if (rows && !Array.isArray(rows) && Array.isArray(rows.rows)) {
            wrapper = rows;
            rows = rows.rows;
          }
          if (!Array.isArray(rows)) return;

          const guildId = SelectedGuildStore.getGuildId();
          if (!guildId) return; // DMs have no join date

          let changed = false;
          const newRows = rows.map((row) => {
            const out = badgeRow(row, guildId);
            if (out !== row) changed = true;
            return out;
          });
          if (!changed) return;

          const result = wrapper ? Object.assign({}, wrapper, { rows: newRows }) : newRows;
          args[1] = isString ? JSON.stringify(result) : result;
        } catch (e) {
          // Never break chat rendering because of this plugin.
          console.error("[NewMemberBadge]", e);
        }
      })
    );
  }

  function Settings() {
    useProxy(storage);
    return React.createElement(
      ReactNative.ScrollView,
      null,
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
        title: "Icon style: centered (smaller, centred) or big (larger, slightly left)",
        value: storage.icon,
        onChange: (v) => {
          storage.icon = String(v).trim().toLowerCase() === "big" ? "big" : "centered";
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Replace members' own server tag with the badge? (yes / no)",
        value: storage.override,
        onChange: (v) => {
          storage.override = String(v).trim().toLowerCase() === "yes" ? "yes" : "no";
        },
      }),
      React.createElement(Forms.FormInput, {
        title: 'Label next to the icon, up to 4 letters (empty = icon only; "none" = no text at all)',
        value: storage.label,
        onChange: (v) => {
          storage.label = v;
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Emoji used in text mode, or for members who keep their own server tag",
        value: storage.badge,
        onChange: (v) => {
          storage.badge = v;
        },
      })
    );
  }

  exports.default = {
    onLoad() {
      storage.days ??= 7;
      storage.badge ??= "\uD83C\uDF31"; // seedling
      storage.mode ??= "tag"; // "tag" = icon chip, "text" = emoji after the name
      storage.label ??= ""; // empty = icon only
      storage.icon ??= "centered"; // "centered" or "big"
      storage.override ??= "no"; // "yes" = replace members' own server tag with the badge

      // The chat manager may not exist yet while Discord is still starting.
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const manager = findChatManager();
        if (manager) {
          clearInterval(timer);
          patchChatRows(manager);
        } else if (attempts >= 15) {
          clearInterval(timer);
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
