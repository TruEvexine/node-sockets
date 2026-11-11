const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");
const createChatAvatar = require("./public/avatars");

const bannedTerms = [
    "asshole", "bastard", "bitch", "bullshit", "chinga", "chingada", "chingado",
    "chingar", "chink", "coño", "cabrón", "cabron", "culero", "cunt", "damn",
    "faggot", "fuck", "fucking", "idiota", "imbécil", "mierda", "nigger", "pendeja",
    "pendejo", "puta", "puto", "retard", "shit", "slut", "verga", "whore"
];
const bannedTermsPattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${bannedTerms
        .sort((a, b) => b.length - a.length)
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")})(?![\\p{L}\\p{N}_])`,
    "giu"
);
function censorMessage(text) {
    return text.replace(bannedTermsPattern, (term) => "*".repeat([...term].length));
}

function safeAvatar(value) {
    if (typeof value !== "string" || value.length > 500) return "";
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function createWebApp({ serveStatic = true } = {}) {
    const app = express();
    const socketClientPath = path.join(
        path.dirname(require.resolve("socket.io")),
        "../client-dist/socket.io.js"
    );
    app.get("/socket.io.js", (request, response, next) => {
        response.sendFile(socketClientPath, (error) => {
            if (error) next(error);
        });
    });
    app.get("/", (request, response, next) => {
        response.sendFile(path.join(__dirname, "public", "index.html"), (error) => {
            if (error) next(error);
        });
    });
    if (serveStatic) app.use(express.static(path.join(__dirname, "public")));
    return app;
}

function createChatServer({
    serveStatic = true,
    socketPath = "/api/socket-io/socket.io"
} = {}) {
    const app = createWebApp({ serveStatic });
    const server = http.createServer(app);
    const io = new Server(server, { path: socketPath });
    const users = new Map();
    const groups = new Map([
        ["general", {
            name: "general",
            displayName: "General",
            filterProfanity: true,
            isPrivate: false,
            allowInvites: true,
            ownerId: null,
            members: new Set(),
            moderators: new Set(),
            reports: [],
            historyLimit: 200
        }]
    ]);
    const history = new Map([["general", []]]);
    const directMessages = new Map();
    const invitations = new Map();
    const messageActivity = new Map();

    function publicGroup(group, user) {
        return {
            name: group.name,
            displayName: group.displayName,
            filterProfanity: group.filterProfanity,
            isPrivate: group.isPrivate,
            allowInvites: group.allowInvites,
            isOwner: group.ownerId === user.clientId,
            isModerator: group.moderators.has(user.clientId),
            canModerate: isModerator(group, user),
            historyLimit: group.historyLimit
        };
    }

    function groupList(user) {
        return [...groups.values()]
            .filter((group) => !group.isPrivate || group.members.has(user.clientId))
            .map((group) => publicGroup(group, user));
    }

    function findUserSocket(clientId) {
        for (const candidate of io.sockets.sockets.values()) {
            const user = users.get(candidate.id);
            if (user?.clientId === clientId) return { socket: candidate, user };
        }
        return null;
    }

    function blocked(user, clientId) {
        return user.blockedUsers.has(clientId);
    }

    function directMessageKey(firstId, secondId) {
        return JSON.stringify([firstId, secondId].sort());
    }

    function canDirectMessage(sender, recipient) {
        return sender.clientId !== recipient.clientId &&
            recipient.allowDirectMessages &&
            !blocked(sender, recipient.clientId) &&
            !blocked(recipient, sender.clientId);
    }

    function isModerator(group, user) {
        return group.ownerId === user.clientId || group.moderators.has(user.clientId);
    }

    function checkMessageRate(socket, eventName, maximum, interval) {
        const key = `${socket.id}:${eventName}`;
        const now = Date.now();
        const recent = (messageActivity.get(key) || []).filter((timestamp) => now - timestamp < interval);
        if (recent.length >= maximum) {
            socket.emit("chat-error", "Vas muy rápido. Espera un momento antes de enviar otro mensaje.");
            messageActivity.set(key, recent);
            return false;
        }
        recent.push(now);
        messageActivity.set(key, recent);
        return true;
    }

    function notifyGroupSettings(group) {
        for (const memberSocket of io.sockets.sockets.values()) {
            if (memberSocket.data.group !== group.name) continue;
            const member = users.get(memberSocket.id);
            if (member) memberSocket.emit("group-settings", publicGroup(group, member));
        }
    }

    function joinGroup(socket, groupName) {
        const group = groups.get(groupName);
        const user = users.get(socket.id);
        if (!group || !user || (group.isPrivate && !group.members.has(user.clientId))) return false;
        group.members.add(user.clientId);
        const previousGroup = socket.data.group;
        if (previousGroup) socket.leave(previousGroup);
        socket.join(groupName);
        socket.data.group = groupName;
        socket.emit("message-history", {
            group: groupName,
            messages: (history.get(groupName) || []).filter(
                (message) => !blocked(user, message.senderClientId)
            )
        });
        socket.emit("group-settings", publicGroup(group, user));
        return true;
    }

    io.on("connection", (socket) => {
        socket.on("user-join", (profile = {}) => {
            if (!profile || typeof profile !== "object") {
                socket.emit("chat-error", "No se pudo leer tu perfil.");
                return;
            }
            const username = typeof profile.username === "string"
                ? profile.username.trim().slice(0, 20)
                : "";
            if (!username) {
                socket.emit("chat-error", "Escribe un nickname para unirte.");
                return;
            }

            const clientId = typeof profile.clientId === "string" && profile.clientId.length <= 100
                ? profile.clientId
                : crypto.randomUUID();
            const avatarSeed = typeof profile.avatarSeed === "string" && profile.avatarSeed.length <= 100
                ? profile.avatarSeed
                : crypto.randomUUID();
            const avatar = safeAvatar(profile.avatar) || createChatAvatar(avatarSeed);
            const blockedIds = Array.isArray(profile.blockedUsers)
                ? profile.blockedUsers
                    .filter((id) => typeof id === "string" && id.length <= 100 && id !== clientId)
                    .slice(0, 200)
                : [];
            const user = {
                username,
                avatar,
                avatarSeed,
                clientId,
                allowDirectMessages: profile.allowDirectMessages !== false,
                blockedUsers: new Set(blockedIds)
            };
            users.set(socket.id, user);
            groups.get("general").members.add(clientId);
            joinGroup(socket, "general");
            socket.emit("profile", {
                username,
                avatar,
                avatarSeed,
                clientId,
                allowDirectMessages: user.allowDirectMessages
            });
            socket.emit("groups-list", groupList(user));
            io.emit("users-list", [...users.entries()].map(([id, connectedUser]) => ({
                id,
                clientId: connectedUser.clientId,
                username: connectedUser.username,
                avatar: connectedUser.avatar,
                avatarSeed: connectedUser.avatarSeed,
                allowDirectMessages: connectedUser.allowDirectMessages,
                group: io.sockets.sockets.get(id)?.data.group || "general",
                isModerator: groups.get(io.sockets.sockets.get(id)?.data.group)?.moderators
                    .has(connectedUser.clientId) || false
            })));
            socket.to("general").emit("user-joined", { username, group: "general" });
        });

        socket.on("join-group", (groupName) => {
            if (typeof groupName !== "string" || !joinGroup(socket, groupName)) {
                socket.emit("group-join-error", {
                    group: socket.data.group || "general",
                    message: "No tienes acceso a ese grupo o todavía no te has unido al chat."
                });
            }
        });

        socket.on("mensaje", (payload = {}) => {
            if (!payload || typeof payload !== "object") {
                socket.emit("chat-error", "No se pudo leer el mensaje.");
                return;
            }
            const user = users.get(socket.id);
            const groupName = socket.data.group;
            const group = groups.get(groupName);
            if (!user || !group || typeof payload.texto !== "string") {
                socket.emit("chat-error", "Únete al chat antes de enviar mensajes.");
                return;
            }

            const text = payload.texto.trim().slice(0, 1000);
            if (!text) return;
            if (!checkMessageRate(socket, "mensaje", 6, 5000)) return;
            const message = {
                messageId: crypto.randomUUID(),
                id: socket.id,
                senderClientId: user.clientId,
                username: user.username,
                avatar: user.avatar,
                avatarSeed: user.avatarSeed,
                texto: group.filterProfanity ? censorMessage(text) : text,
                group: groupName,
                timestamp: Date.now()
            };
            const messages = history.get(groupName) || [];
            messages.push(message);
            while (messages.length > group.historyLimit) messages.shift();
            history.set(groupName, messages);
            for (const recipientSocket of io.sockets.sockets.values()) {
                if (recipientSocket.data.group !== groupName) continue;
                const recipient = users.get(recipientSocket.id);
                if (recipient && !blocked(recipient, user.clientId)) {
                    recipientSocket.emit("mensaje", message);
                }
            }
        });

        socket.on("create-group", (payload = {}) => {
            const user = users.get(socket.id);
            if (!user || !payload || typeof payload !== "object" || typeof payload.name !== "string") {
                socket.emit("chat-error", "Únete al chat para crear un grupo.");
                return;
            }
            const name = payload.name.trim().toLowerCase();
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 30 || groups.has(name)) {
                socket.emit("chat-error", "El nombre del grupo no es válido o ya existe.");
                return;
            }
            const displayName = typeof payload.displayName === "string"
                ? payload.displayName.trim().slice(0, 30)
                : name;
            const group = {
                name,
                displayName: displayName || name,
                filterProfanity: true,
                isPrivate: true,
                allowInvites: true,
                ownerId: user.clientId,
                members: new Set([user.clientId]),
                moderators: new Set(),
                reports: [],
                historyLimit: 200
            };
            groups.set(name, group);
            history.set(name, []);
            socket.emit("group-created", publicGroup(group, user));
        });

        socket.on("set-profile-settings", (settings = {}) => {
            const user = users.get(socket.id);
            if (!user || !settings || typeof settings !== "object") return;
            if (typeof settings.allowDirectMessages === "boolean") {
                user.allowDirectMessages = settings.allowDirectMessages;
            }
            if (Array.isArray(settings.blockedUsers)) {
                user.blockedUsers = new Set(
                    settings.blockedUsers
                        .filter((id) => typeof id === "string" && id.length <= 100 && id !== user.clientId)
                        .slice(0, 200)
                );
            }
            io.emit("users-list", [...users.entries()].map(([id, connectedUser]) => ({
                id,
                clientId: connectedUser.clientId,
                username: connectedUser.username,
                avatar: connectedUser.avatar,
                avatarSeed: connectedUser.avatarSeed,
                allowDirectMessages: connectedUser.allowDirectMessages,
                group: io.sockets.sockets.get(id)?.data.group || "general",
                isModerator: groups.get(io.sockets.sockets.get(id)?.data.group)?.moderators
                    .has(connectedUser.clientId) || false
            })));
        });

        socket.on("group-invite", (payload = {}) => {
            if (!payload || typeof payload !== "object") return;
            const { targetClientId, groupName } = payload;
            const user = users.get(socket.id);
            const group = groups.get(groupName);
            const target = findUserSocket(targetClientId);
            if (!user || !group || groupName === "general" || socket.data.group !== groupName ||
                !target || targetClientId === user.clientId ||
                !group.allowInvites || !group.members.has(user.clientId)) {
                socket.emit("group-invite-result", { ok: false, message: "No se pudo enviar la invitación." });
                return;
            }
            if (blocked(user, targetClientId) || blocked(target.user, user.clientId)) {
                socket.emit("group-invite-result", { ok: false, message: "No puedes invitar a ese usuario." });
                return;
            }
            if (group.members.has(targetClientId)) {
                socket.emit("group-invite-result", { ok: false, message: "Esa persona ya pertenece al grupo." });
                return;
            }
            for (const [inviteId, invitation] of invitations) {
                if (invitation.createdAt < Date.now() - 30 * 60 * 1000) {
                    invitations.delete(inviteId);
                } else if (invitation.targetClientId === targetClientId && invitation.groupName === groupName) {
                    socket.emit("group-invite-result", {
                        ok: false,
                        message: "Esa persona ya tiene una invitación pendiente."
                    });
                    return;
                }
            }
            const inviteId = crypto.randomUUID();
            invitations.set(inviteId, {
                targetClientId,
                inviterId: user.clientId,
                groupName,
                createdAt: Date.now()
            });
            target.socket.emit("group-invitation", {
                inviteId,
                groupName,
                groupDisplayName: group.displayName,
                inviterId: user.clientId,
                inviterName: user.username
            });
            socket.emit("group-invite-result", {
                ok: true,
                message: `Invitación enviada a ${target.user.username}.`
            });
        });

        socket.on("group-invite-response", (payload = {}) => {
            if (!payload || typeof payload !== "object") return;
            const { inviteId, accept } = payload;
            const user = users.get(socket.id);
            const invitation = invitations.get(inviteId);
            if (!user || !invitation || invitation.targetClientId !== user.clientId) return;
            invitations.delete(inviteId);
            if (Date.now() - invitation.createdAt > 30 * 60 * 1000) {
                socket.emit("chat-error", "La invitación expiró. Pide una nueva invitación.");
                return;
            }
            const group = groups.get(invitation.groupName);
            const inviter = findUserSocket(invitation.inviterId);
            if (!group) {
                socket.emit("chat-error", "Ese grupo ya no está disponible.");
                return;
            }
            if (accept === true) {
                if (blocked(user, invitation.inviterId) ||
                    (inviter && blocked(inviter.user, user.clientId))) {
                    socket.emit("chat-error", "No puedes aceptar la invitación por la configuración de bloqueo.");
                    return;
                }
                group.members.add(user.clientId);
                socket.emit("group-created", publicGroup(group, user));
                socket.emit("group-invite-accepted", { groupName: group.name });
                if (inviter) {
                    inviter.socket.emit("group-invite-result", {
                        ok: true,
                        message: `${user.username} aceptó la invitación.`
                    });
                }
            } else if (inviter) {
                inviter.socket.emit("group-invite-result", {
                    ok: true,
                    message: `${user.username} rechazó la invitación.`
                });
            }
        });

        socket.on("set-group-privacy", (isPrivate) => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            if (!user || !group || group.name === "general" || group.ownerId !== user.clientId ||
                typeof isPrivate !== "boolean") return;
            if (isPrivate) {
                for (const memberSocket of io.sockets.sockets.values()) {
                    if (memberSocket.data.group === group.name) {
                        const member = users.get(memberSocket.id);
                        if (member) group.members.add(member.clientId);
                    }
                }
            }
            group.isPrivate = isPrivate;
            for (const memberSocket of io.sockets.sockets.values()) {
                if (memberSocket.data.group === group.name) {
                    const member = users.get(memberSocket.id);
                    if (member) memberSocket.emit("group-settings", publicGroup(group, member));
                }
                const member = users.get(memberSocket.id);
                if (member) memberSocket.emit("groups-list", groupList(member));
            }
        });

        socket.on("set-group-invites", (allowInvites) => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            if (!user || !group || group.name === "general" || group.ownerId !== user.clientId ||
                typeof allowInvites !== "boolean") return;
            group.allowInvites = allowInvites;
            for (const memberSocket of io.sockets.sockets.values()) {
                if (memberSocket.data.group === group.name) {
                    const member = users.get(memberSocket.id);
                    if (member) memberSocket.emit("group-settings", publicGroup(group, member));
                }
            }
        });

        socket.on("get-direct-history", (targetClientId) => {
            const user = users.get(socket.id);
            const target = findUserSocket(targetClientId);
            if (!user || !target || !canDirectMessage(user, target.user)) {
                socket.emit("direct-message-error", "No puedes abrir un mensaje directo con esa persona.");
                return;
            }
            socket.emit("direct-history", {
                targetClientId,
                messages: directMessages.get(directMessageKey(user.clientId, targetClientId)) || []
            });
        });

        socket.on("direct-message", (payload = {}) => {
            if (!payload || typeof payload !== "object") return;
            const { targetClientId, texto } = payload;
            const user = users.get(socket.id);
            const target = findUserSocket(targetClientId);
            if (!user || !target || typeof texto !== "string" || !canDirectMessage(user, target.user)) {
                socket.emit("direct-message-error", "No se pudo enviar el mensaje. Revisa los permisos de privacidad.");
                return;
            }
            const text = texto.trim().slice(0, 1000);
            if (!text) return;
            if (!checkMessageRate(socket, "direct-message", 8, 5000)) return;
            const key = directMessageKey(user.clientId, targetClientId);
            const messages = directMessages.get(key) || [];
            const message = {
                messageId: crypto.randomUUID(),
                fromClientId: user.clientId,
                fromUsername: user.username,
                fromAvatar: user.avatar,
                fromAvatarSeed: user.avatarSeed,
                toClientId: targetClientId,
                toUsername: target.user.username,
                texto: text,
                timestamp: Date.now()
            };
            messages.push(message);
            if (messages.length > 200) messages.shift();
            directMessages.set(key, messages);
            socket.emit("direct-message", message);
            if (target.socket.id !== socket.id) target.socket.emit("direct-message", message);
        });

        socket.on("set-group-retention", (limit) => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            if (!user || !group || group.name === "general" || group.ownerId !== user.clientId ||
                ![50, 200, 500].includes(limit)) return;
            group.historyLimit = limit;
            const messages = history.get(group.name) || [];
            if (messages.length > limit) messages.splice(0, messages.length - limit);
            notifyGroupSettings(group);
        });

        socket.on("set-group-moderator", (payload = {}) => {
            if (!payload || typeof payload !== "object") return;
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            const targetId = payload.targetClientId;
            if (!user || !group || group.name === "general" || group.ownerId !== user.clientId ||
                typeof targetId !== "string" || targetId === user.clientId || !group.members.has(targetId) ||
                typeof payload.enabled !== "boolean") {
                socket.emit("chat-error", "No se pudo actualizar el rol de moderación.");
                return;
            }
            if (payload.enabled) group.moderators.add(targetId);
            else group.moderators.delete(targetId);
            notifyGroupSettings(group);
            io.emit("users-list", [...users.entries()].map(([id, connectedUser]) => ({
                id,
                clientId: connectedUser.clientId,
                username: connectedUser.username,
                avatar: connectedUser.avatar,
                avatarSeed: connectedUser.avatarSeed,
                allowDirectMessages: connectedUser.allowDirectMessages,
                group: io.sockets.sockets.get(id)?.data.group || "general",
                isModerator: groups.get(io.sockets.sockets.get(id)?.data.group)?.moderators
                    .has(connectedUser.clientId) || false
            })));
        });

        socket.on("report-message", (payload = {}) => {
            if (!payload || typeof payload !== "object") return;
            if (!checkMessageRate(socket, "report-message", 4, 60000)) return;
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            const groupHistory = history.get(socket.data.group) || [];
            const message = groupHistory.find((entry) => entry.messageId === payload.messageId);
            if (!user || !group || !message || message.senderClientId === user.clientId) {
                socket.emit("moderation-result", { ok: false, message: "No se pudo reportar ese mensaje." });
                return;
            }
            if (group.reports.some((report) => report.messageId === message.messageId &&
                report.reporterId === user.clientId)) {
                socket.emit("moderation-result", { ok: false, message: "Ya reportaste ese mensaje." });
                return;
            }
            const report = {
                reportId: crypto.randomUUID(),
                messageId: message.messageId,
                reporterId: user.clientId,
                reporterName: user.username,
                senderName: message.username,
                text: message.texto,
                reason: typeof payload.reason === "string" ? payload.reason.trim().slice(0, 200) : "",
                timestamp: Date.now()
            };
            group.reports.push(report);
            if (group.reports.length > 200) group.reports.shift();
            if (group.name === "general") {
                console.warn("Reporte de moderación en general:", report);
            } else {
                for (const memberSocket of io.sockets.sockets.values()) {
                    const member = users.get(memberSocket.id);
                    if (memberSocket.data.group === group.name && member && isModerator(group, member)) {
                        memberSocket.emit("moderation-reports", group.reports);
                    }
                }
            }
            socket.emit("moderation-result", { ok: true, message: "Reporte enviado a moderación." });
        });

        socket.on("get-moderation-reports", () => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            if (user && group && isModerator(group, user)) {
                socket.emit("moderation-reports", group.reports);
            }
        });

        socket.on("resolve-moderation-report", (reportId) => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            if (!user || !group || !isModerator(group, user) || typeof reportId !== "string") return;
            group.reports = group.reports.filter((report) => report.reportId !== reportId);
            for (const memberSocket of io.sockets.sockets.values()) {
                const member = users.get(memberSocket.id);
                if (memberSocket.data.group === group.name && member && isModerator(group, member)) {
                    memberSocket.emit("moderation-reports", group.reports);
                }
            }
        });

        socket.on("edit-message", (payload = {}) => {
            if (!payload || typeof payload !== "object" || typeof payload.messageId !== "string" ||
                typeof payload.texto !== "string") return;
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            const messages = history.get(socket.data.group) || [];
            const message = messages.find((entry) => entry.messageId === payload.messageId);
            const text = payload.texto.trim().slice(0, 1000);
            if (!user || !group || !message || message.senderClientId !== user.clientId || !text) {
                socket.emit("chat-error", "Solo puedes editar tus propios mensajes.");
                return;
            }
            message.texto = group.filterProfanity ? censorMessage(text) : text;
            message.editedAt = Date.now();
            io.to(group.name).emit("message-edited", { messageId: message.messageId, texto: message.texto });
        });

        socket.on("delete-message", (messageId) => {
            const user = users.get(socket.id);
            const group = groups.get(socket.data.group);
            const messages = history.get(socket.data.group) || [];
            const index = messages.findIndex((entry) => entry.messageId === messageId);
            const message = messages[index];
            if (!user || !group || !message ||
                (message.senderClientId !== user.clientId && !isModerator(group, user))) {
                socket.emit("chat-error", "No tienes permiso para retirar ese mensaje.");
                return;
            }
            messages.splice(index, 1);
            io.to(group.name).emit("message-removed", messageId);
        });

        socket.on("set-group-filter", (enabled) => {
            const groupName = socket.data.group;
            const group = groups.get(groupName);
            const user = users.get(socket.id);
            if (!group || !user) return;
            if (groupName === "general") {
                socket.emit("group-settings", publicGroup(group, user));
                return;
            }
            if (typeof enabled !== "boolean") {
                socket.emit("chat-error", "La configuración del filtro no es válida.");
                return;
            }
            if (!isModerator(group, user)) {
                socket.emit("chat-error", "Solo el propietario o un moderador puede cambiar el filtro.");
                return;
            }
            group.filterProfanity = enabled;
            notifyGroupSettings(group);
        });

        socket.on("disconnect", () => {
            const user = users.get(socket.id);
            if (!user) return;
            socket.to(socket.data.group).emit("user-left", { username: user.username, group: socket.data.group });
            users.delete(socket.id);
            for (const key of messageActivity.keys()) {
                if (key.startsWith(`${socket.id}:`)) messageActivity.delete(key);
            }
            io.emit("users-list", [...users.entries()].map(([id, currentUser]) => ({
                id,
                clientId: currentUser.clientId,
                username: currentUser.username,
                avatar: currentUser.avatar,
                avatarSeed: currentUser.avatarSeed,
                allowDirectMessages: currentUser.allowDirectMessages,
                group: io.sockets.sockets.get(id)?.data.group || "general",
                isModerator: groups.get(io.sockets.sockets.get(id)?.data.group)?.moderators
                    .has(currentUser.clientId) || false
            })));
        });
    });

    return { app, server, io, users, groups, history };
}

if (require.main === module) {
    const { server } = createChatServer();
    const port = Number(process.env.PORT) || 3000;
    server.listen(port, () => {
        console.log(`Servidor activo en http://localhost:${port}`);
    });
}

module.exports = createWebApp({ serveStatic: false });
module.exports.createChatServer = createChatServer;
module.exports.censorMessage = censorMessage;
module.exports.safeAvatar = safeAvatar;
