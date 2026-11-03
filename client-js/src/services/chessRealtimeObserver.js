/**
 * Gestor de actualizaciones en tiempo real para el cliente Web mediante
 * Conexiones Bidireccionales (BiDir) sobre WebSockets en ZeroC Ice.
 * Implementa el servant ChessObserver en el navegador sin usar polling.
 */

export class ChessRealtimeObserver {
    constructor(Ice, ChessApp) {
        this.Ice = Ice;
        this.ChessApp = ChessApp;
        this.adapter = null;
        this.identity = null;
        this.servant = null;
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;
    }

    /**
     * Crea el servant de ChessObserver, configura el ObjectAdapter bidireccional
     * sobre la conexión WebSocket activa y registra el observador en la sala.
     */
    async subscribe(communicator, servicePrx, roomCode, nickname, { onStateChanged, onGameFinished } = {}) {
        await this.cleanupAdapter();
        this.onStateChangedCallback = typeof onStateChanged === "function" ? onStateChanged : null;
        this.onGameFinishedCallback = typeof onGameFinished === "function" ? onGameFinished : null;

        const ObserverBase = this.ChessApp.ChessObserver;
        const onStateChangedCallback = this.onStateChangedCallback;
        const onGameFinishedCallback = this.onGameFinishedCallback;

        class WebChessObserverServant extends ObserverBase {
            onGameStateChanged(newState, _current) {
                if (onStateChangedCallback) {
                    onStateChangedCallback(newState);
                }
            }

            onGameFinished(finalState, winnerNickname, pointsDelta, _current) {
                if (onGameFinishedCallback) {
                    onGameFinishedCallback(finalState, winnerNickname, pointsDelta);
                }
            }
        }

        this.servant = new WebChessObserverServant();

        try {
            this.adapter = await communicator.createObjectAdapter("");
            this.identity = new this.Ice.Identity(this.Ice.generateUUID(), "ChessObserver");
            const observerProxy = this.adapter.add(this.servant, this.identity);
            await this.adapter.activate();

            const connection = await servicePrx.ice_getConnection();
            connection.setAdapter(this.adapter);

            const observerPrx = this.ChessApp.ChessObserverPrx.uncheckedCast(observerProxy);
            await servicePrx.registerObserver(roomCode, nickname, observerPrx);
        } catch (error) {
            this.onStateChangedCallback = null;
            this.onGameFinishedCallback = null;
            await this.cleanupAdapter();
            throw error;
        }
    }

    /**
     * Desvincula el observador de la sala en el servidor y limpia el adaptador local.
     */
    async unsubscribe(servicePrx, roomCode, nickname) {
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;

        try {
            await servicePrx.unregisterObserver(roomCode, nickname);
        } finally {
            await this.cleanupAdapter();
        }
    }

    async cleanupAdapter() {
        if (!this.adapter) {
            this.identity = null;
            this.servant = null;
            return;
        }

        const adapter = this.adapter;
        const identity = this.identity;
        this.adapter = null;
        this.identity = null;
        this.servant = null;

        try {
            if (identity) {
                adapter.remove(identity);
            }
        } finally {
            await adapter.destroy();
        }
    }
}
