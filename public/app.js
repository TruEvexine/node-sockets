const socket = io({
    path: "/api/socket-io/socket.io",
    addTrailingSlash: false,
    transports: ["websocket"]
});
const groupNames = new Set(["general"]);
const displayedMessages = new Set();
const themes = {
    lavender: ["#7357d5", "#543cb4", "#eeeaff", "#f5f3fc", "#ffffff"],
    ocean: ["#168aad", "#126782", "#e1f4fa", "#eef8fb", "#ffffff"],
    sunset: ["#e16b58", "#b74757", "#fff0e9", "#fff7f3", "#ffffff"],
    forest: ["#43805f", "#2f6248", "#e5f3e9", "#f1f8f2", "#ffffff"],
    berry: ["#c04478", "#922b5c", "#fbe3ef", "#fff2f8", "#fffafd"],
    sky: ["#5079cc", "#3857a0", "#e5edff", "#f3f6ff", "#ffffff"],
    citrus: ["#bd861d", "#89600e", "#fff1c9", "#fff9e9", "#fffefa"],
    mint: ["#258b78", "#176856", "#d9f4e9", "#eefaf5", "#ffffff"]
};
function readStoredValue(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch (error) {
        console.warn(`No se pudo leer ${key} del almacenamiento local.`, error);
        return fallback;
    }
}

function saveStoredValue(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`No se pudo guardar ${key} en el almacenamiento local.`, error);
    }
}

let currentGroup = "general";
let connectedUsers = [];
let pendingGroupName = "";
let joinedProfile = null;
let profileReceived = false;
let avatarSeed = crypto.randomUUID();
let clientId = readStoredValue("chat-client-id", "") || crypto.randomUUID();
let allowDirectMessages = readStoredValue("chat-allow-dms", true) !== false;
let blockedUsers = readStoredValue("chat-blocked-users", []);
if (!Array.isArray(blockedUsers)) blockedUsers = [];
let mutedUsers = readStoredValue("chat-muted-users", []);
if (!Array.isArray(mutedUsers)) mutedUsers = [];
let browserNotificationsEnabled = readStoredValue("chat-browser-notifications", false) === true;
let messageSoundEnabled = readStoredValue("chat-message-sound", false) === true;
let historyReady = false;
let pendingMessages = [];
let currentDirectContact = null;
let currentGroupCanInvite = false;
let currentGroupIsOwner = false;
let currentGroupIsModerator = false;
let pendingInvitations = [];
const displayedDirectMessages = new Set();
const directContacts = new Map();
const unreadDirectMessages = new Map();
let toastTimeout;

const loginModal = document.getElementById("login-modal");
const joinForm = document.getElementById("join-form");
const usernameInput = document.getElementById("username-input");
const avatarInput = document.getElementById("avatar-input");
const loginStatus = document.getElementById("login-status");
const joinButton = document.getElementById("join-button");
const profilePreview = document.getElementById("profile-preview");
const headerAvatar = document.getElementById("header-avatar");
const userList = document.getElementById("user-list");
const groupSelector = document.getElementById("group-selector");
const filterToggle = document.getElementById("filter-toggle");
const currentGroupIndicator = document.getElementById("current-group");
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const settingsDialog = document.getElementById("settings-dialog");
const directDialog = document.getElementById("direct-dialog");
const invitationDialog = document.getElementById("invitation-dialog");
const directMessages = document.getElementById("direct-messages");
const directInput = document.getElementById("direct-input");
const blockedUsersList = document.getElementById("blocked-users-list");
const mutedUsersList = document.getElementById("muted-users-list");
const allowDmsToggle = document.getElementById("allow-dms-toggle");
const browserNotificationsToggle = document.getElementById("browser-notifications-toggle");
const messageSoundToggle = document.getElementById("message-sound-toggle");
const privateGroupToggle = document.getElementById("private-group-toggle");
const groupInvitesToggle = document.getElementById("group-invites-toggle");
const groupRetentionSelect = document.getElementById("group-retention-select");
const groupSettingsPanel = document.getElementById("group-settings-panel");
const moderatorControls = document.getElementById("moderator-controls");
const moderatorSelect = document.getElementById("moderator-select");
const moderatorToggle = document.getElementById("moderator-toggle");
const reportsPanel = document.getElementById("reports-panel");
const reportsList = document.getElementById("reports-list");
const directDock = document.getElementById("direct-dock");
const toast = document.getElementById("chat-toast");

saveStoredValue("chat-client-id", clientId);
allowDmsToggle.checked = allowDirectMessages;
browserNotificationsToggle.checked = browserNotificationsEnabled;
messageSoundToggle.checked = messageSoundEnabled;

function isMuted(id) {
    return mutedUsers.some((user) => user.id === id);
}

function useAvatar(image, source, username, seed = avatarSeed) {
    image.alt = username;
    image.onerror = () => {
        image.onerror = null;
        image.src = createChatAvatar(seed);
    };
    image.src = source || createChatAvatar(seed);
}

function updateAvatarPreview(url) {
    profilePreview.replaceChildren();
    const image = document.createElement("img");
    useAvatar(image, url, usernameInput.value.trim() || "gatito", avatarSeed);
    profilePreview.append(image);
}

function addMessage(message) {
    if (displayedMessages.has(message.messageId) || isMuted(message.senderClientId)) return;
    displayedMessages.add(message.messageId);
    const item = document.createElement("li");
    item.classList.add("message-item");
    item.dataset.senderId = message.senderClientId || "";
    item.dataset.messageId = message.messageId;
    const avatar = document.createElement("img");
    avatar.className = "message-avatar";
    useAvatar(avatar, message.avatar, message.username, message.avatarSeed);

    const content = document.createElement("div");
    content.className = "message-content";
    const sender = document.createElement("div");
    sender.className = "message-sender";
    sender.textContent = message.senderClientId === clientId || message.id === socket.id
        ? "Tú"
        : message.username;
    if (message.editedAt) sender.textContent += " · (editado)";

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.texto;
    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (message.senderClientId === clientId || currentGroupIsModerator) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Eliminar";
        remove.addEventListener("click", () => socket.emit("delete-message", message.messageId));
        actions.append(remove);
    }
    if (message.senderClientId === clientId) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => {
            const updated = window.prompt("Edita tu mensaje:", message.texto);
            if (updated?.trim()) socket.emit("edit-message", { messageId: message.messageId, texto: updated });
        });
        actions.append(edit);
    } else {
        const report = document.createElement("button");
        report.type = "button";
        report.textContent = "Reportar";
        report.addEventListener("click", () => {
            const reason = window.prompt("Motivo del reporte (opcional):") || "";
            socket.emit("report-message", { messageId: message.messageId, reason });
        });
        actions.append(report);
    }
    content.append(sender, text);
    if (actions.childElementCount) content.append(actions);
    item.append(avatar, content);

    if (message.senderClientId === clientId || message.id === socket.id) item.classList.add("me");
    if (message.timestamp) {
        item.title = new Date(message.timestamp).toLocaleString();
    }
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
    const item = document.createElement("li");
    item.className = "system-message";
    item.textContent = text;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
}

function addGroup(group) {
    if (groupNames.has(group.name)) return;
    groupNames.add(group.name);
    const option = document.createElement("option");
    option.value = group.name;
    option.textContent = group.displayName || group.name;
    groupSelector.append(option);

    if (group.name === pendingGroupName) {
        groupSelector.value = group.name;
        groupSelector.dispatchEvent(new Event("change"));
        pendingGroupName = "";
    }
}

function syncGroups(groups) {
    const allowedGroups = new Set(groups.map((group) => group.name));
    for (const option of [...groupSelector.options]) {
        if (option.value === "general" || allowedGroups.has(option.value)) continue;
        groupNames.delete(option.value);
        option.remove();
    }
    groups.forEach(addGroup);
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function isBlocked(id) {
    return blockedUsers.some((user) => user.id === id);
}

function syncProfileSettings() {
    saveStoredValue("chat-allow-dms", allowDirectMessages);
    saveStoredValue("chat-blocked-users", blockedUsers);
    saveStoredValue("chat-muted-users", mutedUsers);
    if (joinedProfile) {
        joinedProfile.allowDirectMessages = allowDirectMessages;
        joinedProfile.blockedUsers = blockedUsers.map((user) => user.id);
        socket.emit("set-profile-settings", {
            allowDirectMessages,
            blockedUsers: blockedUsers.map((user) => user.id)
        });
    }

    function toggleMutedUser(user) {
        if (isMuted(user.clientId)) {
            mutedUsers = mutedUsers.filter((entry) => entry.id !== user.clientId);
            showToast(`${user.username} ya no está silenciado.`);
            socket.emit("join-group", currentGroup);
        } else {
            mutedUsers.push({ id: user.clientId, username: user.username });
            messages.querySelectorAll(".message-item").forEach((item) => {
                if (item.dataset.senderId === user.clientId) item.remove();
            });
            showToast(`${user.username} quedó silenciado solo para ti.`);
        }
        syncProfileSettings();
        renderMutedUsers();
        renderUsers();
    }

    function renderMutedUsers() {
        mutedUsersList.replaceChildren();
        if (!mutedUsers.length) {
            const empty = document.createElement("li");
            empty.className = "empty-list";
            empty.textContent = "No has silenciado a nadie.";
            mutedUsersList.append(empty);
            return;
        }
        mutedUsers.forEach((user) => {
            const item = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = user.username;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "user-action";
            button.textContent = "Activar";
            button.addEventListener("click", () => toggleMutedUser({ clientId: user.id, username: user.username }));
            item.append(name, button);
            mutedUsersList.append(item);
        });
    }
}

function renderBlockedUsers() {
    blockedUsersList.replaceChildren();
    if (!blockedUsers.length) {
        const empty = document.createElement("li");
        empty.className = "empty-list";
        empty.textContent = "No has bloqueado a nadie.";
        blockedUsersList.append(empty);
        return;
    }
    blockedUsers.forEach((user) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = user.username;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "user-action";
        button.textContent = "Desbloquear";
        button.addEventListener("click", () => unblockUser(user.id));
        item.append(name, button);
        blockedUsersList.append(item);
    });
}

function blockUser(user) {
    if (isBlocked(user.clientId)) return;
    blockedUsers.push({ id: user.clientId, username: user.username });
    messages.querySelectorAll(".message-item").forEach((item) => {
        if (item.dataset.senderId === user.clientId) item.remove();
    });
    syncProfileSettings();
    renderBlockedUsers();
    renderMutedUsers();
    renderUsers();
    if (currentDirectContact?.clientId === user.clientId) directDialog.close();
    renderDirectDock();
    showToast(`${user.username} quedó bloqueado en este navegador.`);
}

function unblockUser(userId) {
    blockedUsers = blockedUsers.filter((user) => user.id !== userId);
    syncProfileSettings();
    renderBlockedUsers();
    renderUsers();
    renderDirectDock();
}

function renderUsers() {
    userList.replaceChildren();
    const label = document.createElement("span");
    label.className = "online-label";
    label.textContent = `En línea · ${connectedUsers.length}`;
    userList.append(label);
    connectedUsers.forEach((user) => {
        if (user.clientId === clientId) return;
        const card = document.createElement("div");
        card.className = "user-card";
        const avatar = document.createElement("img");
        avatar.className = "user-avatar";
        useAvatar(avatar, user.avatar, user.username, user.avatarSeed);
        avatar.loading = "lazy";
        const name = document.createElement("span");
        name.className = "user-card-name";
        name.textContent = user.username;
        name.title = user.username;
        const actions = document.createElement("span");
        actions.className = "user-card-actions";

        if (isBlocked(user.clientId)) {
            const unblock = document.createElement("button");
            unblock.type = "button";
            unblock.className = "user-action";
            unblock.textContent = "Desbloquear";
            unblock.addEventListener("click", () => unblockUser(user.clientId));
            actions.append(unblock);
        } else {
            const direct = document.createElement("button");
            direct.type = "button";
            direct.className = "user-action";
            direct.textContent = "Mensaje";
            direct.disabled = !allowDirectMessages || !user.allowDirectMessages;
            direct.title = direct.disabled ? "Mensajes directos desactivados" : `Escribir a ${user.username}`;
            direct.addEventListener("click", () => openDirectMessage(user));

            const invite = document.createElement("button");
            invite.type = "button";
            invite.className = "user-action";
            invite.textContent = "Invitar";
            invite.disabled = currentGroup === "general" || !currentGroupCanInvite ||
                !groupNames.has(currentGroup);
            invite.title = invite.disabled
                ? "Selecciona un grupo que permita invitaciones"
                : `Invitar a ${user.username} al grupo`;
            invite.addEventListener("click", () => {
                socket.emit("group-invite", { targetClientId: user.clientId, groupName: currentGroup });
            });

            const block = document.createElement("button");
            block.type = "button";
            block.className = "user-action";
            block.textContent = "Bloquear";
            block.addEventListener("click", () => blockUser(user));
            const mute = document.createElement("button");
            mute.type = "button";
            mute.className = "user-action";
            mute.textContent = isMuted(user.clientId) ? "Activar" : "Silenciar";
            mute.addEventListener("click", () => toggleMutedUser(user));
            actions.append(direct, invite, mute, block);
        }
        card.append(avatar, name, actions);
        userList.append(card);
    });
}

function renderModeratorChoices() {
    moderatorSelect.replaceChildren();
    connectedUsers
        .filter((user) => user.group === currentGroup && user.clientId !== clientId)
        .forEach((user) => {
            const option = document.createElement("option");
            option.value = user.clientId;
            option.textContent = `${user.username}${user.isModerator ? " · moderador" : ""}`;
            moderatorSelect.append(option);
        });
    moderatorToggle.disabled = moderatorSelect.options.length === 0;
    const selected = connectedUsers.find((user) => user.clientId === moderatorSelect.value);
    moderatorToggle.textContent = selected?.isModerator ? "Quitar moderador" : "Hacer moderador";
}

function directMessagePartner(message) {
    return message.fromClientId === clientId ? message.toClientId : message.fromClientId;
}

function ensureDirectContact(user) {
    const contact = {
        clientId: user.clientId,
        username: user.username,
        avatar: user.avatar || "",
        avatarSeed: user.avatarSeed || user.clientId,
        allowDirectMessages: user.allowDirectMessages
    };
    directContacts.set(contact.clientId, { ...directContacts.get(contact.clientId), ...contact });
    renderDirectDock();
    return directContacts.get(contact.clientId);
}

function renderDirectDock() {
    directDock.replaceChildren();
    for (const contact of directContacts.values()) {
        if (isBlocked(contact.clientId)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "direct-bubble";
        button.title = `Abrir conversación con ${contact.username}`;
        button.setAttribute("aria-label", `Abrir conversación con ${contact.username}`);
        const avatar = document.createElement("img");
        useAvatar(avatar, contact.avatar, contact.username, contact.avatarSeed);
        const count = unreadDirectMessages.get(contact.clientId) || 0;
        if (count) {
            const badge = document.createElement("span");
            badge.className = "direct-unread";
            badge.textContent = count > 9 ? "9+" : String(count);
            button.append(avatar, badge);
        } else {
            button.append(avatar);
        }
        button.addEventListener("click", () => openDirectMessage(contact));
        directDock.append(button);
    }
}

function renderDirectMessage(message) {
    if (displayedDirectMessages.has(message.messageId)) return;
    if (directMessagePartner(message) !== currentDirectContact?.clientId) return;
    displayedDirectMessages.add(message.messageId);
    const item = document.createElement("li");
    if (message.fromClientId === clientId) item.classList.add("mine");
    const sender = document.createElement("small");
    sender.textContent = message.fromClientId === clientId ? "Tú" : message.fromUsername;
    const text = document.createElement("span");
    text.textContent = message.texto;
    item.append(sender, text);
    directMessages.append(item);
    directMessages.scrollTop = directMessages.scrollHeight;
}

function openDirectMessage(user) {
    if (!allowDirectMessages || user.allowDirectMessages === false || isBlocked(user.clientId)) {
        showToast("No puedes abrir esa conversación con los ajustes actuales.");
        return;
    }
    currentDirectContact = ensureDirectContact(user);
    unreadDirectMessages.delete(user.clientId);
    renderDirectDock();
    displayedDirectMessages.clear();
    directMessages.replaceChildren();
    document.getElementById("direct-title").textContent = `Mensaje con ${user.username}`;
    directDialog.show();
    socket.emit("get-direct-history", user.clientId);
    directInput.focus();
}

function notifyDirectMessage(message, contact) {
    const isIncoming = message.toClientId === clientId;
    const viewingConversation = directDialog.open && currentDirectContact?.clientId === contact.clientId &&
        document.visibilityState !== "hidden";
    if (isIncoming && !viewingConversation) {
        unreadDirectMessages.set(contact.clientId, (unreadDirectMessages.get(contact.clientId) || 0) + 1);
        showToast(`Mensaje privado de ${contact.username}.`);
        if (browserNotificationsEnabled && "Notification" in window &&
            Notification.permission === "granted" && document.visibilityState === "hidden") {
            const notification = new Notification(`Mensaje de ${contact.username}`, {
                body: message.texto,
                icon: contact.avatar || undefined,
                tag: `direct-${contact.clientId}`
            });
            notification.onclick = () => {
                window.focus();
                openDirectMessage(contact);
                notification.close();
            };
        }
        if (messageSoundEnabled) {
            try {
                const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
                if (AudioContextConstructor) {
                    const context = new AudioContextConstructor();
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    oscillator.frequency.value = 660;
                    gain.gain.value = 0.045;
                    oscillator.connect(gain);
                    gain.connect(context.destination);
                    oscillator.start();
                    oscillator.stop(context.currentTime + 0.12);
                    oscillator.onended = () => context.close();
                }
            } catch (error) {
                console.warn("No se pudo reproducir el aviso de mensaje.", error);
            }
        }
    }
    renderDirectDock();
}

function renderModerationReports(reports = []) {
    reportsList.replaceChildren();
    if (!reports.length) {
        const empty = document.createElement("li");
        empty.className = "empty-list";
        empty.textContent = "No hay reportes pendientes.";
        reportsList.append(empty);
        return;
    }
    reports.forEach((report) => {
        const item = document.createElement("li");
        item.className = "report-item";
        const detail = document.createElement("p");
        detail.textContent = `${report.senderName}: “${report.text}” · Reportó ${report.reporterName}${report.reason ? ` · ${report.reason}` : ""}`;
        const resolve = document.createElement("button");
        resolve.type = "button";
        resolve.className = "user-action";
        resolve.textContent = "Atendido";
        resolve.addEventListener("click", () => socket.emit("resolve-moderation-report", report.reportId));
        item.append(detail, resolve);
        reportsList.append(item);
    });
}

function showNextInvitation() {
    if (invitationDialog.open || !pendingInvitations.length) return;
    const invitation = pendingInvitations.shift();
    invitationDialog.dataset.inviteId = invitation.inviteId;
    document.getElementById("invitation-copy").textContent =
        `${invitation.inviterName} te invita a unirte a «${invitation.groupDisplayName}».`;
    invitationDialog.showModal();
}

updateAvatarPreview("");
avatarInput.addEventListener("input", () => updateAvatarPreview(avatarInput.value.trim()));
usernameInput.addEventListener("input", () => {
    avatarSeed = crypto.randomUUID();
    updateAvatarPreview(avatarInput.value.trim());
});

joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) {
        usernameInput.focus();
        return;
    }
    joinedProfile = {
        username,
        avatar: avatarInput.value.trim(),
        avatarSeed,
        clientId,
        allowDirectMessages,
        blockedUsers: blockedUsers.map((user) => user.id)
    };
    joinButton.disabled = true;
    loginStatus.textContent = "Conectando al chat...";
    loginStatus.classList.remove("hidden");
    if (socket.connected) socket.emit("user-join", joinedProfile);
});

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const texto = input.value.trim();
    if (!texto) return;
    socket.emit("mensaje", { texto });
    input.value = "";
    input.focus();
});

groupSelector.addEventListener("change", () => {
    currentGroup = groupSelector.value;
    const label = groupSelector.selectedOptions[0]?.textContent || currentGroup;
    currentGroupIndicator.textContent = `Chat ${label}`;
    historyReady = false;
    pendingMessages = [];
    displayedMessages.clear();
    messages.replaceChildren();
    socket.emit("join-group", currentGroup);
});

document.getElementById("create-group-btn").addEventListener("click", () => {
    const displayName = window.prompt("¿Cómo se llamará el nuevo grupo?");
    if (!displayName || !displayName.trim()) return;
    const name = displayName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30).replace(/-$/g, "");
    if (!name || groupNames.has(name)) {
        window.alert("Elige un nombre distinto para el grupo.");
        return;
    }
    pendingGroupName = name;
    socket.emit("create-group", { name, displayName: displayName.trim().slice(0, 30) });
});

filterToggle.addEventListener("change", () => {
    socket.emit("set-group-filter", filterToggle.checked);
});

document.getElementById("settings-button").addEventListener("click", () => {
    allowDmsToggle.checked = allowDirectMessages;
    renderBlockedUsers();
    renderMutedUsers();
    reportsPanel.classList.toggle("hidden", !currentGroupIsModerator);
    moderatorControls.classList.toggle("hidden", !currentGroupIsOwner);
    if (currentGroupIsModerator && currentGroup !== "general") socket.emit("get-moderation-reports");
    settingsDialog.showModal();
});

allowDmsToggle.addEventListener("change", () => {
    allowDirectMessages = allowDmsToggle.checked;
    syncProfileSettings();
    renderUsers();
});

browserNotificationsToggle.addEventListener("change", async () => {
    if (browserNotificationsToggle.checked) {
        if (!("Notification" in window)) {
            browserNotificationsToggle.checked = false;
            showToast("Este navegador no permite notificaciones del sistema.");
            return;
        }
        if (Notification.permission === "default") await Notification.requestPermission();
        browserNotificationsEnabled = Notification.permission === "granted";
        browserNotificationsToggle.checked = browserNotificationsEnabled;
        if (!browserNotificationsEnabled) showToast("No se concedió permiso para las notificaciones.");
    } else {
        browserNotificationsEnabled = false;
    }
    saveStoredValue("chat-browser-notifications", browserNotificationsEnabled);
});

messageSoundToggle.addEventListener("change", () => {
    messageSoundEnabled = messageSoundToggle.checked;
    saveStoredValue("chat-message-sound", messageSoundEnabled);
});

privateGroupToggle.addEventListener("change", () => {
    socket.emit("set-group-privacy", privateGroupToggle.checked);
});

groupInvitesToggle.addEventListener("change", () => {
    socket.emit("set-group-invites", groupInvitesToggle.checked);
});

groupRetentionSelect.addEventListener("change", () => {
    socket.emit("set-group-retention", Number(groupRetentionSelect.value));
});

moderatorSelect.addEventListener("change", () => {
    const selected = connectedUsers.find((user) => user.clientId === moderatorSelect.value);
    moderatorToggle.textContent = selected?.isModerator ? "Quitar moderador" : "Hacer moderador";
});

moderatorToggle.addEventListener("click", () => {
    const selected = connectedUsers.find((user) => user.clientId === moderatorSelect.value);
    if (!selected) return;
    socket.emit("set-group-moderator", {
        targetClientId: selected.clientId,
        enabled: !selected.isModerator
    });
});

document.getElementById("direct-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const texto = directInput.value.trim();
    if (!texto || !currentDirectContact) return;
    socket.emit("direct-message", { targetClientId: currentDirectContact.clientId, texto });
    directInput.value = "";
    directInput.focus();
});

document.getElementById("close-direct").addEventListener("click", () => directDialog.close());
directDialog.addEventListener("close", () => { currentDirectContact = null; });

document.getElementById("accept-invitation").addEventListener("click", () => {
    socket.emit("group-invite-response", { inviteId: invitationDialog.dataset.inviteId, accept: true });
    invitationDialog.close();
});

document.getElementById("decline-invitation").addEventListener("click", () => {
    socket.emit("group-invite-response", { inviteId: invitationDialog.dataset.inviteId, accept: false });
    invitationDialog.close();
});

invitationDialog.addEventListener("close", () => setTimeout(showNextInvitation, 0));

document.querySelectorAll(".emoji-button").forEach((button) => {
    button.addEventListener("click", () => {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.setRangeText(button.textContent, start, end, "end");
        input.focus();
    });
});

document.getElementById("theme-select").addEventListener("change", (event) => {
    const [accent, dark, soft, page, surface] = themes[event.target.value] || themes.lavender;
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-dark", dark);
    root.style.setProperty("--accent-soft", soft);
    root.style.setProperty("--page", page);
    root.style.setProperty("--surface", surface);
    try {
        localStorage.setItem("chat-theme", event.target.value);
    } catch (error) {
        console.warn("No se pudo guardar la paleta elegida.", error);
    }
});

try {
    const savedTheme = localStorage.getItem("chat-theme");
    if (savedTheme && themes[savedTheme]) {
        document.getElementById("theme-select").value = savedTheme;
        document.getElementById("theme-select").dispatchEvent(new Event("change"));
    }
} catch (error) {
    console.warn("No se pudo recuperar la paleta guardada.", error);
}

socket.on("profile", (profile) => {
    profileReceived = true;
    clientId = profile.clientId;
    saveStoredValue("chat-client-id", clientId);
    allowDirectMessages = profile.allowDirectMessages;
    allowDmsToggle.checked = allowDirectMessages;
    avatarSeed = profile.avatarSeed;
    useAvatar(headerAvatar, profile.avatar, profile.username, profile.avatarSeed);
    headerAvatar.classList.remove("hidden");
    loginModal.classList.add("hidden");
    joinButton.disabled = false;
    loginStatus.classList.add("hidden");
    input.focus();
});

socket.on("connect", () => {
    if (!joinedProfile) return;
    historyReady = false;
    pendingMessages = [];
    socket.emit("user-join", joinedProfile);
    if (currentGroup !== "general") socket.emit("join-group", currentGroup);
});

socket.on("connect_error", (error) => {
    if (joinedProfile && !profileReceived) {
        loginStatus.textContent = "No se pudo conectar. Reintentando…";
        loginStatus.classList.remove("hidden");
    }
    console.warn("No se pudo conectar al servidor del chat.", error);
});

socket.on("message-history", ({ group, messages: previousMessages }) => {
    if (group !== currentGroup) return;
    messages.replaceChildren();
    displayedMessages.clear();
    previousMessages.forEach(addMessage);
    pendingMessages.forEach(addMessage);
    pendingMessages = [];
    historyReady = true;
});

socket.on("mensaje", (message) => {
    if (message.group !== currentGroup) return;
    if (historyReady) addMessage(message);
    else pendingMessages.push(message);
});

socket.on("groups-list", syncGroups);
socket.on("group-created", addGroup);

socket.on("group-settings", (group) => {
    if (group.name !== currentGroup) return;
    filterToggle.checked = group.filterProfanity;
    filterToggle.disabled = group.name === "general" || !group.canModerate;
    currentGroupCanInvite = group.name !== "general" && group.allowInvites;
    groupSettingsPanel.classList.toggle("hidden", group.name === "general");
    privateGroupToggle.checked = group.isPrivate;
    privateGroupToggle.disabled = !group.isOwner;
    groupInvitesToggle.checked = group.allowInvites;
    groupInvitesToggle.disabled = !group.isOwner;
    groupRetentionSelect.value = String(group.historyLimit || 200);
    groupRetentionSelect.disabled = !group.isOwner;
    currentGroupIsOwner = group.isOwner;
    currentGroupIsModerator = group.isModerator || group.isOwner;
    moderatorControls.classList.toggle("hidden", !currentGroupIsOwner);
    reportsPanel.classList.toggle("hidden", !currentGroupIsModerator);
    renderModeratorChoices();
    if (currentGroupIsModerator) socket.emit("get-moderation-reports");
    renderUsers();
});

socket.on("users-list", (users) => {
    connectedUsers = users;
    connectedUsers.forEach((user) => {
        if (directContacts.has(user.clientId)) ensureDirectContact(user);
    });
    if (currentGroupIsOwner) renderModeratorChoices();
    renderUsers();
});

socket.on("user-joined", (user) => {
    if (currentGroup === user.group) addSystemMessage(`${user.username} se unió al chat`);
});

socket.on("user-left", (user) => {
    if (currentGroup === user.group) addSystemMessage(`${user.username} salió del chat`);
});

socket.on("group-invite-result", (result) => showToast(result.message));

socket.on("group-join-error", ({ group, message }) => {
    showToast(message);
    groupSelector.value = group;
    groupSelector.dispatchEvent(new Event("change"));
});

socket.on("group-invitation", (invitation) => {
    if (isBlocked(invitation.inviterId)) return;
    pendingInvitations.push(invitation);
    showNextInvitation();
});

socket.on("group-invite-accepted", ({ groupName }) => {
    groupSelector.value = groupName;
    groupSelector.dispatchEvent(new Event("change"));
});

socket.on("direct-history", ({ targetClientId, messages: history }) => {
    if (currentDirectContact?.clientId !== targetClientId) return;
    directMessages.replaceChildren();
    displayedDirectMessages.clear();
    history.forEach(renderDirectMessage);
});

socket.on("direct-message", (message) => {
    const partnerId = directMessagePartner(message);
    if (isBlocked(partnerId)) return;
    const contact = ensureDirectContact(message.fromClientId === clientId
        ? connectedUsers.find((user) => user.clientId === partnerId) || { clientId: partnerId, username: message.toUsername || "Usuario" }
        : {
            clientId: message.fromClientId,
            username: message.fromUsername,
            avatar: message.fromAvatar,
            avatarSeed: message.fromAvatarSeed
        });
    if (currentDirectContact?.clientId === partnerId && directDialog.open) {
        renderDirectMessage(message);
    } else if (message.toClientId === clientId) {
        notifyDirectMessage(message, contact);
    }
});

socket.on("direct-message-error", showToast);
socket.on("moderation-result", (result) => showToast(result.message));
socket.on("moderation-reports", renderModerationReports);

socket.on("message-edited", ({ messageId, texto }) => {
    const item = messages.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    const text = item?.querySelector(".message-text");
    if (text) text.textContent = texto;
    const sender = item?.querySelector(".message-sender");
    if (sender && !sender.textContent.includes("(editado)")) sender.textContent += " · (editado)";
});

socket.on("message-removed", (messageId) => {
    messages.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.remove();
    displayedMessages.delete(messageId);
});

socket.on("chat-error", (message) => {
    showToast(message);
    if (joinedProfile && !profileReceived) {
        loginModal.classList.remove("hidden");
        loginStatus.textContent = message;
        loginStatus.classList.remove("hidden");
        joinButton.disabled = false;
    }
});
