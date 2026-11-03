import "../../lib/Ice.min.js";
import "./ChessService.js";
import { ChessRealtimeObserver } from "./chessRealtimeObserver.js";

/**
 * Servicio de comunicación RPC con ZeroC Ice sobre WebSockets.
 * Encapsula el ciclo de vida del Communicator, el proxy de ChessService
 * y la suscripción en tiempo real mediante ChessRealtimeObserver.
 */

export class ChessClientService {
    constructor() {
        this.Ice = typeof window !== "undefined" ? window.Ice : null;
        this.ChessApp = typeof window !== "undefined" ? window.ChessApp : null;

        this.communicator = null;
        this.service = null;
        this.realtimeObserver = null;
        this.isConnected = false;
        this.nickname = null;
        this.currentRoomCode = null;
        this.role = null;
        this.assignedColor = null;
    }

    validateRuntime() {
        if (!this.Ice) {
            throw new Error(
                "No se encontró el runtime de ZeroC Ice. Verifica la carga de lib/Ice.min.js."
            );
        }

        if (!this.ChessApp?.ChessServicePrx || !this.ChessApp?.Position) {
            throw new Error(
                "No se encontró el contrato ChessApp generado. Verifica la carga de ChessService.js."
            );
        }
    }

    async connect(host, port, nickname) {
        this.validateRuntime();

        if (typeof host !== "string" || host.trim() === "") {
            throw new Error("Debes indicar el host del servidor Ice.");
        }

        const targetPort = Number(port);
        if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
            throw new Error("El puerto debe ser un número entre 1 y 65535.");
        }

        if (this.realtimeObserver) {
            await this.realtimeObserver.cleanupAdapter();
        }
        if (this.communicator) {
            await this.communicator.destroy();
        }

        this.communicator = null;
        this.service = null;
        this.realtimeObserver = null;
        this.isConnected = false;
        this.nickname = null;

        const targetHost = host.trim();
        const initData = new this.Ice.InitializationData();
        initData.properties = this.Ice.createProperties();
        initData.properties.setProperty("Ice.MessageSizeMax", "2048");
        initData.properties.setProperty("Ice.ACM.Client.Timeout", "0");
        initData.properties.setProperty("Ice.ACM.Client.Heartbeat", "3");

        this.communicator = this.Ice.initialize(initData);

        try {
            const proxyString = `ChessService:ws -h ${targetHost} -p ${targetPort}`;
            const base = this.communicator.stringToProxy(proxyString);
            this.service = await this.ChessApp.ChessServicePrx.checkedCast(base);

            if (!this.service) {
                throw new Error(
                    "El servidor respondió, pero el proxy no corresponde a ChessService."
                );
            }

            this.nickname = nickname;
            this.realtimeObserver = new ChessRealtimeObserver(this.Ice, this.ChessApp);
            this.isConnected = true;
        } catch (error) {
            const communicator = this.communicator;
            this.communicator = null;
            this.service = null;
            this.nickname = null;
            this.isConnected = false;
            await communicator.destroy();
            throw error;
        }
    }

    async getLobbyData() {
        if (!this.isConnected || !this.service) {
            throw new Error("Debes conectarte al servidor antes de consultar el lobby.");
        }

        const [rooms, leaderboard] = await Promise.all([
            this.service.getActiveRooms(),
            this.service.getLeaderboard()
        ]);

        return { rooms, leaderboard };
    }

    async createRoom(nickname) {
        this.ensureConnected();
        if (typeof nickname !== "string" || nickname.trim() === "") {
            throw new Error("Debes indicar un nickname para crear la sala.");
        }

        this.nickname = nickname;
        return await this.service.createRoom(this.nickname);
    }

    async joinRoom(roomCode, nickname) {
        this.ensureConnected();

        if (typeof roomCode !== "string" || roomCode.trim() === "") {
            throw new Error("Debes indicar un código de sala.");
        }
        if (typeof nickname !== "string" || nickname.trim() === "") {
            throw new Error("Debes indicar un nickname para unirte a la sala.");
        }

        const normalizedCode = roomCode.trim().toUpperCase();
        this.nickname = nickname;

        const result = await this.service.joinRoom(normalizedCode, this.nickname);
        this.currentRoomCode = normalizedCode;
        this.role = result.role;
        this.assignedColor = result.assignedColor;

        return result;
    }

    async subscribeToRoom(listeners = {}) {
        this.ensureConnected();
        if (!this.currentRoomCode || !this.realtimeObserver) {
            throw new Error("Debes unirte a una sala antes de suscribirte a sus actualizaciones.");
        }

        await this.realtimeObserver.subscribe(
            this.communicator,
            this.service,
            this.currentRoomCode,
            this.nickname,
            listeners
        );
    }

    async makeMove(fromRow, fromCol, toRow, toCol) {
        this.ensureRoomJoined();

        const coordinates = [fromRow, fromCol, toRow, toCol];
        if (!coordinates.every((value) => Number.isInteger(value) && value >= 0 && value <= 7)) {
            throw new Error("Las coordenadas de la jugada deben ser enteros entre 0 y 7.");
        }

        const fromPos = new this.ChessApp.Position(fromRow, fromCol);
        const toPos = new this.ChessApp.Position(toRow, toCol);

        return await this.service.makeMove(
            this.currentRoomCode,
            this.nickname,
            fromPos,
            toPos
        );
    }

    async resign() {
        this.ensureRoomJoined();
        await this.service.resign(this.currentRoomCode, this.nickname);
    }

    async leaveRoom() {
        this.ensureRoomJoined();

        if (this.realtimeObserver) {
            await this.realtimeObserver.unsubscribe(
                this.service,
                this.currentRoomCode,
                this.nickname
            );
        }

        await this.service.leaveRoom(this.currentRoomCode, this.nickname);
        this.currentRoomCode = null;
        this.role = null;
        this.assignedColor = null;
    }

    ensureRoomJoined() {
        this.ensureConnected();
        if (!this.currentRoomCode || !this.nickname) {
            throw new Error("Debes unirte a una sala antes de realizar esta acción.");
        }
    }

    ensureConnected() {
        if (!this.isConnected || !this.service) {
            throw new Error("Debes conectarte al servidor Ice antes de realizar esta acción.");
        }
    }
}
